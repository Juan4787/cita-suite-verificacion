import { env } from '$env/dynamic/private';
import { processWhatsAppWebhookPayload, verifyWebhookSignature } from '$lib/server/messaging';
import { createSupabaseAdminClient } from '$lib/server/supabase';
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

export const POST: RequestHandler = async ({ request, fetch }) => {
	const body = await request.text();
	if (!verifyWebhookSignature(body, request.headers.get('x-hub-signature-256'))) {
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
