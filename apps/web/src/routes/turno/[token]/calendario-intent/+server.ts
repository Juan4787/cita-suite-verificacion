// Registro best-effort del INTENTO de abrir el calendario nativo Android vía
// intent:// (FASE 12). Audit-only POR DISEÑO: acá NO se toca calendar_action_status,
// porque el beacon dispara en el click, antes de saber si se abrió algo; si un
// intent fallido marcara cobertura, el paciente desaparecería de Recordatorios sin
// tener ningún aviso. La cobertura real la registran ir/google (fallback) o el push.

import { env } from '$env/dynamic/private';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import { canRegisterCalendarAction } from '$lib/server/calendar-tracking';
import { isAndroidCalendarIntentVariant } from '$lib/server/android-calendar-intent';
import { writeAuditLog } from '$lib/server/audit';
import type { RequestHandler } from './$types';

const noContent = () =>
	new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export const POST: RequestHandler = async ({ params, request, fetch }) => {
	if (env.DEMO_MODE === 'true') return noContent();

	try {
		const { appointment, supabase } = await loadAppointmentForToken(fetch, params.token);
		if (!appointment || !supabase || !canRegisterCalendarAction(appointment)) {
			// Token inválido o turno cerrado: sin audit, pero siempre 204 (el beacon
			// no lee la respuesta y un error acá no le aporta nada a nadie).
			return noContent();
		}

		let variant: string | null = null;
		try {
			const body = (await request.json()) as { variant?: unknown };
			const candidate = typeof body?.variant === 'string' ? body.variant : '';
			variant = isAndroidCalendarIntentVariant(candidate) ? candidate : null;
		} catch {
			variant = null;
		}

		await writeAuditLog(supabase, {
			businessId: appointment.business.id,
			userId: null,
			action: 'appointment.calendar_intent_attempt',
			entityType: 'appointment',
			entityId: appointment.id,
			metadata: {
				method: 'android_intent',
				variant,
				calendar_status_at_attempt: appointment.calendar_action_status
			}
		});
	} catch (error) {
		console.error('Error registrando intento de calendario nativo', error);
	}

	return noContent();
};
