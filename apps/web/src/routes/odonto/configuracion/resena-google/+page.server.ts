import { env } from '$env/dynamic/private';
import {
	GOOGLE_REVIEW_ACTION_MAX_LENGTH,
	GOOGLE_REVIEW_BODY_MAX_LENGTH,
	GOOGLE_REVIEW_DEFAULT_ACTION_LABEL,
	GOOGLE_REVIEW_DEFAULT_BODY,
	GOOGLE_REVIEW_DEFAULT_TITLE,
	GOOGLE_REVIEW_TITLE_MAX_LENGTH,
	isValidGoogleReviewUrl,
	trimGoogleReviewMessage
} from '$lib/google-reviews';
import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/business';
import { createSupabaseAdminClient, createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const defaultSettings = () => ({
	enabled: false,
	reviewUrl: '',
	title: GOOGLE_REVIEW_DEFAULT_TITLE,
	body: GOOGLE_REVIEW_DEFAULT_BODY,
	actionLabel: GOOGLE_REVIEW_DEFAULT_ACTION_LABEL
});

const valuesFromForm = (form: FormData) => ({
	enabled: form.get('enabled') === 'true',
	reviewUrl: String(form.get('review_url') ?? '').trim(),
	title: String(form.get('notification_title') ?? ''),
	body: String(form.get('notification_body') ?? ''),
	actionLabel: String(form.get('notification_action_label') ?? '')
});

const validatedAssistanceClient = async (
	supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
	businessId: string,
	fetch: typeof globalThis.fetch
) => {
	const { data, error } = await supabase.rpc('user_has_active_account_assistance', {
		target_business_id: businessId
	});
	if (error || data !== true) return null;
	return createSupabaseAdminClient('odonto', fetch);
};

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			demo: true,
			context: demoBusinessContext(),
			settings: defaultSettings()
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (!context.canManage) throw redirect(303, '/odonto/agenda');

	let readClient = supabase;
	if (context.assistance) {
		const admin = await validatedAssistanceClient(supabase, context.business.id, fetch);
		if (!admin) throw redirect(303, '/odonto/maestro');
		readClient = admin;
	}

	const { data, error } = await readClient
		.from('google_review_settings')
		.select(
			'enabled, review_url, notification_title, notification_body, notification_action_label'
		)
		.eq('business_id', context.business.id)
		.maybeSingle();
	if (error) {
		console.error('Error cargando configuración de reseñas', error);
		throw kitError(500, 'No pudimos cargar esta configuración. Volvé a intentarlo.');
	}

	return {
		demo: false,
		context,
		settings: data
			? {
					enabled: data.enabled,
					reviewUrl: data.review_url ?? '',
					title: data.notification_title,
					body: data.notification_body,
					actionLabel: data.notification_action_label
				}
			: defaultSettings()
	};
};

export const actions: Actions = {
	default: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const form = await request.formData();
		const rawValues = valuesFromForm(form);
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.', values: rawValues });
		}

		const message = trimGoogleReviewMessage({
			title: rawValues.title,
			body: rawValues.body,
			actionLabel: rawValues.actionLabel
		});
		const values = { ...rawValues, ...message };

		if (!message.title || message.title.length > GOOGLE_REVIEW_TITLE_MAX_LENGTH) {
			return fail(400, {
				message: `El título debe tener entre 1 y ${GOOGLE_REVIEW_TITLE_MAX_LENGTH} caracteres.`,
				values
			});
		}
		if (!message.body || message.body.length > GOOGLE_REVIEW_BODY_MAX_LENGTH) {
			return fail(400, {
				message: `El mensaje debe tener entre 1 y ${GOOGLE_REVIEW_BODY_MAX_LENGTH} caracteres.`,
				values
			});
		}
		if (!message.actionLabel || message.actionLabel.length > GOOGLE_REVIEW_ACTION_MAX_LENGTH) {
			return fail(400, {
				message: `El texto del botón debe tener entre 1 y ${GOOGLE_REVIEW_ACTION_MAX_LENGTH} caracteres.`,
				values
			});
		}
		if (rawValues.reviewUrl && !isValidGoogleReviewUrl(rawValues.reviewUrl)) {
			return fail(400, {
				message:
					'El enlace no parece ser el enlace directo de reseñas de Google. Copialo desde Leer reseñas → Conseguir más reseñas.',
				values
			});
		}
		if (rawValues.enabled && !rawValues.reviewUrl) {
			return fail(400, {
				message: 'Pegá el enlace de Google antes de activar las solicitudes automáticas.',
				values
			});
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies
		});
		if (!context) {
			return fail(500, {
				message: 'No pudimos identificar el consultorio activo. Volvé a abrirlo e intentá nuevamente.',
				values
			});
		}
		if (!context.canManage) {
			return fail(403, {
				message: 'Tu permiso actual no permite editar esta configuración.',
				values
			});
		}

		let updateClient = supabase;
		if (context.assistance) {
			const admin = await validatedAssistanceClient(supabase, context.business.id, fetch);
			if (!admin) {
				return fail(403, {
					message:
						'La autorización para configurar este consultorio ya no está activa. Volvé al panel maestro y abrilo nuevamente.',
					values
				});
			}
			updateClient = admin;
		}

		const now = new Date().toISOString();
		const { error } = await updateClient.from('google_review_settings').upsert(
			{
				business_id: context.business.id,
				enabled: rawValues.enabled,
				review_url: rawValues.reviewUrl || null,
				notification_title: message.title,
				notification_body: message.body,
				notification_action_label: message.actionLabel,
				updated_at: now
			},
			{ onConflict: 'business_id' }
		);
		if (error) {
			console.error('Error guardando configuración de reseñas', error);
			return fail(500, {
				message: 'No pudimos guardar la configuración. Volvé a intentarlo.',
				values
			});
		}

		return { success: true, values };
	}
};
