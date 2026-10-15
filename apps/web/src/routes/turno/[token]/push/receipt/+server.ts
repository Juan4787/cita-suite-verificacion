// Acuse técnico enviado por el service worker. El secreto de recibo viaja solamente
// dentro del payload Web Push cifrado y se compara contra su SHA-256 almacenado.

import { env } from '$env/dynamic/private';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import { isValidPushDeliveryId, recordPushDeliveryReceipt } from '$lib/server/push';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (env.DEMO_MODE === 'true') return new Response(null, { status: 204 });

	let raw: unknown;
	try {
		const body = await request.text();
		if (body.length > 4096) return new Response(null, { status: 413 });
		raw = JSON.parse(body);
	} catch {
		return new Response(null, { status: 204 });
	}
	const input = raw as {
		deliveryId?: unknown;
		receiptToken?: unknown;
		stage?: unknown;
	} | null;
	const deliveryId = typeof input?.deliveryId === 'string' ? input.deliveryId.trim() : '';
	const receiptToken =
		typeof input?.receiptToken === 'string' ? input.receiptToken.trim() : '';
	const stage =
		input?.stage === 'received' || input?.stage === 'displayed' || input?.stage === 'clicked'
			? input.stage
			: null;
	if (
		!stage ||
		!isValidPushDeliveryId(deliveryId) ||
		!/^[A-Za-z0-9_-]{32,256}$/.test(receiptToken)
	) {
		return new Response(null, { status: 204 });
	}

	try {
		const { appointment, supabase } = await loadAppointmentForToken(fetch, params.token);
		if (!appointment || !supabase) return new Response(null, { status: 204 });
		await recordPushDeliveryReceipt(supabase, {
			appointmentId: appointment.id,
			deliveryId,
			receiptToken,
			stage
		});
	} catch (error) {
		// El acuse es best-effort y nunca debe provocar un reintento visible o filtrar
		// detalles técnicos al navegador del paciente.
		console.error('Error registrando recepción de push', error);
	}
	return new Response(null, { status: 204 });
};
