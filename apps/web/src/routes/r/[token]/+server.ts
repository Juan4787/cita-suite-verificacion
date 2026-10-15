import crypto from 'node:crypto';
import { isValidGoogleReviewUrl } from '$lib/google-reviews';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import type { RequestHandler } from './$types';

const responseHeaders = {
	'cache-control': 'no-store, max-age=0',
	'referrer-policy': 'no-referrer',
	'x-content-type-options': 'nosniff',
	'x-robots-tag': 'noindex, nofollow'
};

const unavailable = () =>
	new Response('Este enlace para compartir tu opinión ya no está disponible.', {
		status: 404,
		headers: { ...responseHeaders, 'content-type': 'text/plain; charset=utf-8' }
	});

export const GET: RequestHandler = async ({ params, fetch }) => {
	const token = params.token.trim();
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return unavailable();

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
		const { data, error } = await supabase
			.rpc('record_google_review_click', {
				target_click_token_hash: tokenHash,
				click_time: new Date().toISOString()
			})
			.maybeSingle();
		if (error) throw error;

		const result = data as { review_url: string } | null;
		const reviewUrl = String(result?.review_url ?? '').trim();
		if (!isValidGoogleReviewUrl(reviewUrl)) return unavailable();

		return new Response(null, {
			status: 303,
			headers: { ...responseHeaders, location: reviewUrl }
		});
	} catch (error) {
		console.error('Error abriendo enlace de reseña', {
			code: error instanceof Error ? error.message.slice(0, 120) : 'unknown'
		});
		return unavailable();
	}
};
