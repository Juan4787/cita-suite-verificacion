import { env } from '$env/dynamic/private';
import {
	processWhatsAppWebhookPayload,
	verifyWebhookSignature,
	webhookSignatureCheckable
} from '$lib/server/integrations/public/messaging';
import { readBoundedBytes } from '$lib/server/platform/form-data';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { json, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const mode = url.searchParams.get('hub.mode');
	const token = url.searchParams.get('hub.verify_token');
	const challenge = url.searchParams.get('hub.challenge');
	const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim();

	if (mode === 'subscribe' && verifyToken && token === verifyToken && challenge) {
		return text(challenge);
	}

	return json({ message: 'No autorizado.' }, { status: 403 });
};

// The signature covers the body, so it is read, up to a bound, only when it can be checked.
const WHATSAPP_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const POST: RequestHandler = async ({ request, fetch }) => {
	const signature = request.headers.get('x-hub-signature-256');
	if (!webhookSignatureCheckable(signature)) return json({ message: 'Firma inválida.' }, { status: 401 });
	const bytes = await readBoundedBytes(request, WHATSAPP_WEBHOOK_MAX_BODY_BYTES);
	if (!bytes) return json({ message: 'Cuerpo demasiado grande.' }, { status: 413 });
	const body = new TextDecoder().decode(bytes);
	if (!verifyWebhookSignature(body, signature)) {
		return json({ message: 'Firma inválida.' }, { status: 401 });
	}

	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		return json({ message: 'Cuerpo inválido.' }, { status: 400 });
	}

	const supabase = await createSupabaseAdminClient('odonto', fetch);
	const result = await processWhatsAppWebhookPayload(supabase, payload);
	return json(result);
};
