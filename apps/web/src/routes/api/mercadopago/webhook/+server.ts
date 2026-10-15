import {
	logMpWebhookEvent,
	processMpWebhookEvent,
	verifyMpWebhookSignature
} from '$lib/server/mercadopago';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Webhook de Mercado Pago. Nunca decide acceso por sí mismo: verifica la firma
// (HMAC + frescura del ts), consulta a la API de MP el estado real del recurso
// y acredita vía grant_business_access con clave idempotente. Todo evento con
// firma válida queda registrado en mp_webhook_events.
export const POST: RequestHandler = async ({ request, url, fetch }) => {
	const body = await request.text();
	// MP manda data.id y type en la query; el body es informativo (nunca se
	// confía en él para acreditar).
	const dataId = url.searchParams.get('data.id') ?? url.searchParams.get('id');
	const topic = url.searchParams.get('type') ?? url.searchParams.get('topic');
	const requestId = request.headers.get('x-request-id');
	const signatureHeader = request.headers.get('x-signature');

	// El cliente admin se crea perezosamente: el spam sin forma de notificación
	// de MP se corta en 401 sin tocar Supabase.
	let adminPromise: ReturnType<typeof createSupabaseAdminClient> | null = null;
	const admin = () => (adminPromise ??= createSupabaseAdminClient('odonto', fetch));

	const signatureValid = verifyMpWebhookSignature({
		signatureHeader,
		requestId,
		dataId
	});

	let payload: Record<string, unknown> | null = null;
	try {
		payload = body ? (JSON.parse(body) as Record<string, unknown>) : null;
	} catch {
		payload = null;
	}

	// Los campos que vienen del body (no verificado) se truncan; el raw de
	// eventos rechazados no se guarda. Nadie puede inflar la tabla sin firma.
	const trunc = (value: string | null, max = 200) => (value ? value.slice(0, max) : null);
	const eventBase = {
		topic: trunc(topic),
		action: trunc(typeof payload?.action === 'string' ? payload.action : null),
		resource_id: trunc(dataId),
		request_id: trunc(requestId),
		live_mode: typeof payload?.live_mode === 'boolean' ? payload.live_mode : null,
		signature_valid: signatureValid
	};

	if (!signatureValid) {
		// Los rechazos NO se persisten: la firma inválida es lo único que un
		// anónimo puede forzar (parseSignatureHeader valida el formato, no el
		// HMAC), así que escribir en la tabla sería un INSERT gratis por
		// request. Un secret mal configurado se diagnostica por los logs de la
		// función (esta línea) y por el panel de notificaciones de MP, que
		// muestra los reintentos fallidos con 401. Nada de cliente admin acá.
		console.warn('Webhook MP rechazado por firma inválida', {
			resource_id: eventBase.resource_id,
			topic: eventBase.topic,
			request_id: eventBase.request_id,
			hadSignatureHeader: Boolean(signatureHeader)
		});
		return json({ message: 'Firma inválida.' }, { status: 401 });
	}

	const result = await processMpWebhookEvent(await admin(), fetch, {
		topic,
		resourceId: dataId,
		origin: 'webhook'
	});

	await logMpWebhookEvent(await admin(), {
		...eventBase,
		raw: payload,
		processing_status: result.status,
		processing_detail: result.detail,
		business_id: result.businessId,
		credited_grant_id: result.grantId,
		requires_attention: result.requiresAttention
	});

	if (result.status === 'error') {
		console.error('Error procesando webhook MP', result.detail);
		// 500 para que MP reintente: la acreditación es idempotente, así que el
		// reintento es inofensivo.
		return json({ message: 'Error procesando la notificación.' }, { status: 500 });
	}

	return json({ ok: true });
};
