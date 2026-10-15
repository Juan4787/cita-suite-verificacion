// Redirect-through de "Enviar WhatsApp": registra quién abrió el recordatorio y
// recién después redirige a wa.me con el mensaje prearmado. La app solo prepara el
// mensaje: el envío real lo hace recepción dentro de WhatsApp (sin API de Meta).

import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import { createSupabaseServerClient, getAuthUserId } from '$lib/server/supabase';
import { resolveActiveBusiness } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import { resolveMapsUrl } from '$lib/server/location';
import { normalizeArgentineWhatsAppPhone } from '$lib/server/phone';
import {
	buildReminderWhatsAppMessage,
	buildWaMeUrl,
	buildWhatsAppWebUrl
} from '$lib/server/reminders';
import { classifyUserAgent, type DeviceClass, whatsappHrefFor } from '$lib/device';
import type { RequestHandler } from './$types';

const backTo = (day: string | null) =>
	`/odonto/recordatorios${day === 'hoy' ? '?dia=hoy' : ''}`;

const requestedDevice = (value: string | null): DeviceClass | null =>
	value === 'android' || value === 'ios' || value === 'desktop' || value === 'unknown'
		? value
		: null;

export const GET: RequestHandler = async ({ params, locals, fetch, cookies, url, request }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const day = url.searchParams.get('dia');
	if (env.DEMO_MODE === 'true') throw redirect(303, backTo(day));

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context?.canOperate) throw redirect(303, backTo(day));

	const { data: appointment } = await supabase
		.from('appointments')
		.select(
			'id, starts_at, status, confirmation_token, whatsapp_reminder_opened_at, patients!inner(full_name, phone_e164, blocked)'
		)
		.eq('business_id', context.business.id)
		.eq('id', params.appointmentId)
		.maybeSingle();

	const patient = (appointment as any)?.patients;
	const phone = normalizeArgentineWhatsAppPhone(patient?.phone_e164);
	if (
		!appointment ||
		!phone ||
		patient.blocked ||
		!['reserved', 'confirmed'].includes(String(appointment.status))
	) {
		throw redirect(303, backTo(day));
	}

	// Anti-duplicado: si otra persona ya lo abrió, hace falta ?confirmar=1 (la UI lo
	// pide explícitamente con el aviso de §51).
	if (appointment.whatsapp_reminder_opened_at && url.searchParams.get('confirmar') !== '1') {
		throw redirect(303, backTo(day));
	}

	const userId = await getAuthUserId(supabase, locals.auth.access_token);
	const now = new Date().toISOString();
	const { error: updateError } = await supabase
		.from('appointments')
		.update({
			whatsapp_reminder_opened_at: now,
			whatsapp_reminder_opened_by: userId,
			updated_at: now
		})
		.eq('id', appointment.id)
		.eq('business_id', context.business.id);
	if (updateError) console.error('Error registrando apertura de WhatsApp', updateError);

	await writeAuditLog(supabase, {
		businessId: context.business.id,
		userId,
		action: 'reminder.whatsapp_opened',
		entityType: 'appointment',
		entityId: String(appointment.id),
		metadata: { reopened: Boolean(appointment.whatsapp_reminder_opened_at) }
	});

	const message = buildReminderWhatsAppMessage({
		patientName: String(patient.full_name ?? 'Paciente'),
		startsAt: String(appointment.starts_at),
		timezone: context.business.timezone,
		businessName: context.business.name,
		address: context.business.address,
		mapsLink: resolveMapsUrl({
			address: context.business.address,
			maps_url: context.business.maps_url
		}),
		token: String(appointment.confirmation_token)
	});

	const device = requestedDevice(url.searchParams.get('dispositivo')) ?? classifyUserAgent(request.headers.get('user-agent'));
	const whatsAppUrl = buildWaMeUrl(phone, message);
	const whatsAppWebUrl = buildWhatsAppWebUrl(phone, message);

	return new Response(null, {
		status: 302,
		headers: {
			location: whatsappHrefFor(device, whatsAppUrl, whatsAppWebUrl) ?? whatsAppUrl,
			'cache-control': 'no-store'
		}
	});
};
