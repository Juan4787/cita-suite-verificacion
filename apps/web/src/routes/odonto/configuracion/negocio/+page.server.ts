import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import {
	BUSINESS_INDUSTRIES,
	isBusinessIndustry,
	normalizeSlug,
	resolveActiveBusiness
} from '$lib/server/access/public/business';
import { createSupabaseServerClient } from '$lib/server/platform/supabase';
import { isValidMapsUrl } from '$lib/sites/location';
import { isAllowedPublicImageUrl } from '$lib/server/sites/public/public-image';
import { env } from '$env/dynamic/private';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		const { demoBusinessContext } = await import('$lib/server/access/public/business');
		return {
			context: demoBusinessContext(),
			industries: BUSINESS_INDUSTRIES,
			demo: true
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});

	if (!context) {
		throw kitError(500, 'No se pudo resolver el negocio activo');
	}
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role !== 'owner' && context.role !== 'admin') throw redirect(303, '/odonto/agenda');

	return {
		context,
		industries: BUSINESS_INDUSTRIES,
		demo: false
	};
};

export const actions: Actions = {
	update_business: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies
		});

		if (!context) {
			return fail(500, { message: 'No se pudo resolver el negocio activo.' });
		}
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para editar el negocio.' });
		}

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const slug = normalizeSlug(String(form.get('slug') ?? ''));
		const industry = String(form.get('industry') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const address = String(form.get('address') ?? '').trim();
		const address_instructions = String(form.get('address_instructions') ?? '').trim();
		const maps_url = String(form.get('maps_url') ?? '').trim();
		const logo_url = String(form.get('logo_url') ?? '').trim();
		const timezone = String(form.get('timezone') ?? '').trim() || 'America/Argentina/Cordoba';

		if (!name) {
			return fail(400, { message: 'El nombre del consultorio es obligatorio.', values: Object.fromEntries(form) });
		}
		if (!slug) {
			return fail(400, { message: 'El nombre del enlace público es obligatorio.', values: Object.fromEntries(form) });
		}
		// The booking link reads an identifier-shaped value as the practice id.
		if (isUuid(slug)) {
			return fail(400, {
				message: 'El nombre del enlace público no puede tener forma de código. Usá palabras, como el nombre del consultorio.',
				values: Object.fromEntries(form)
			});
		}
		if (!isBusinessIndustry(industry)) {
			return fail(400, { message: 'La industria seleccionada no es válida.', values: Object.fromEntries(form) });
		}
		try {
			new Intl.DateTimeFormat('es-AR', { timeZone: timezone }).format(new Date());
		} catch {
			return fail(400, {
				message: 'La zona horaria no es válida.',
				values: Object.fromEntries(form)
			});
		}
		if (logo_url) {
			try {
				const logo = new URL(logo_url);
				if (logo.protocol !== 'https:' || !isAllowedPublicImageUrl(logo_url)) {
					throw new Error('INVALID_ORIGIN');
				}
			} catch {
				return fail(400, {
					message:
						'El logo debe ser una URL HTTPS del dominio público configurado o del proyecto de datos del consultorio.',
					values: Object.fromEntries(form)
				});
			}
		}
		if (maps_url && !isValidMapsUrl(maps_url)) {
			return fail(400, {
				message:
					'El link de Google Maps no parece válido. Pegá el link que te da el botón Compartir de Google Maps (empieza con https://maps.app.goo.gl o https://www.google.com/maps).',
				values: Object.fromEntries(form)
			});
		}
		// Sin dirección los pacientes no saben dónde asistir: no se puede habilitar la
		// reserva pública. No es retroactivo: a quien ya la tiene activa no se lo apaga,
		// solo se le muestra la advertencia en la página.
		const wantsPublicBooking = context.business.public_booking_enabled;
		if (wantsPublicBooking && !address) {
			return fail(400, {
				message:
					'Falta la dirección del consultorio. Los pacientes no van a saber dónde asistir al turno. Cargala antes de habilitar la reserva pública.',
				values: Object.fromEntries(form)
			});
		}

		// The assistance saves under its own rules, as an administrator of the practice;
		// checking the grant first only gives it a clear message when it expired.
		if (context.assistance) {
			const { data: assistanceIsActive, error: assistanceError } = await supabase.rpc(
				'user_has_active_account_assistance',
				{ target_business_id: context.business.id }
			);
			if (assistanceError || assistanceIsActive !== true) {
				if (assistanceError) {
					logServerFailure('Error revalidando ayuda para guardar el consultorio', assistanceError);
				}
				return fail(403, {
					message: 'La autorización para configurar este consultorio ya no está activa. Volvé al panel maestro y abrilo nuevamente.',
					values: Object.fromEntries(form)
				});
			}
		}

		const { data: updatedBusiness, error } = await supabase
			.from('businesses')
			.update({
				name,
				slug,
				industry,
				phone: phone || null,
				email: email || null,
				address: address || null,
				address_instructions: address_instructions || null,
				maps_url: maps_url || null,
				logo_url: logo_url || null,
				timezone,
				whatsapp_enabled: form.get('whatsapp_enabled') === 'true',
				is_active: form.get('is_active') === 'true',
				updated_at: new Date().toISOString()
			})
			.eq('id', context.business.id)
			.select('id')
			.maybeSingle();

		if (error || !updatedBusiness) {
			logServerFailure('Error actualizando negocio', error);
			const message =
				error?.code === '23505'
					? 'Ese nombre de enlace público ya está en uso. Elegí otro y volvé a guardar.'
					: 'No pudimos guardar los datos del consultorio. Volvé a abrirlo desde el panel maestro e intentá nuevamente.';
			return fail(500, { message, values: Object.fromEntries(form) });
		}

		return { success: true };
	}
};
