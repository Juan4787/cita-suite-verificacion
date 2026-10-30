// Redirect-through de «Pedir seña por WhatsApp» (plan, sección 4.8): la base registra quién lo
// abrió y recién después se abre wa.me con el mensaje armado. Abrirlo otra vez exige
// `confirmar=1`, y la base lo decide con el turno bloqueado: dos personas que tocan a la vez no
// mandan dos mensajes sin saberlo. El envío lo hace la persona dentro de WhatsApp.
import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import { isUuid } from '@cita-suite/shared/uuid';
import { createSupabaseServerClient } from '$lib/server/platform/supabase';
import { resolveActiveBusiness } from '$lib/server/access/public/business';
import { logServerFailure } from '$lib/server/platform/logging';
import { publicAppointmentUrl } from '$lib/server/integrations/public/messaging';
import { DepositError, loadDepositPolicy, openDepositReminder } from '$lib/server/scheduling/public/deposits';
import { buildDepositRequestMessage, parseAppointmentDeposit } from '$lib/scheduling/deposits';
import { readRecord, readText } from '$lib/contracts/json';
import { classifyUserAgent, type DeviceClass, whatsappHrefFor } from '$lib/device';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import { buildWaMeUrl, buildWhatsAppWebUrl } from '$lib/utils/whatsapp';
import type { RequestHandler } from './$types';

// Why the list was shown again instead of WhatsApp; the list says it in words.
export type DepositOpenNotice = 'ya_abierto' | 'no_pendiente' | 'sin_telefono' | 'no_encontrado' | 'error';

const back = (notice: DepositOpenNotice) => `/odonto/senas?aviso=${notice}`;

const requestedDevice = (value: string | null): DeviceClass | null =>
	value === 'android' || value === 'ios' || value === 'desktop' || value === 'unknown' ? value : null;

export const GET: RequestHandler = async ({ params, locals, fetch, cookies, url, request }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') throw redirect(303, '/odonto/senas');
	// A malformed identifier never reaches PostgreSQL (it would answer 22P02).
	if (!isUuid(params.appointmentId)) throw redirect(303, back('no_encontrado'));

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
	if (!context?.canOperate) throw redirect(303, '/odonto/senas');
	const business = context.business;

	const { data: row, error } = await supabase
		.from('appointment_deposits')
		.select(
			'appointment_id, status, amount, currency, request_from, due_at, auto_cancel, waived_reason, recorded_at, reminder_opened_at, expired_at, revision, appointments!inner(starts_at, status, confirmation_token, patients!inner(full_name, phone_e164, blocked))'
		)
		.eq('business_id', business.id)
		.eq('appointment_id', params.appointmentId)
		.maybeSingle();
	if (error) {
		logServerFailure('Error leyendo la seña para pedirla por WhatsApp', error);
		throw redirect(303, back('error'));
	}
	if (!row) throw redirect(303, back('no_encontrado'));
	const deposit = parseAppointmentDeposit(row);
	if (deposit?.status !== 'pending') throw redirect(303, back('no_pendiente'));
	const appointment = readRecord(row.appointments, 'depositOpen.appointment');
	const patient = readRecord(appointment.patients, 'depositOpen.patient');
	const phone = normalizeArgentineWhatsAppPhone(typeof patient.phone_e164 === 'string' ? patient.phone_e164 : null);
	if (!phone || patient.blocked === true) throw redirect(303, back('sin_telefono'));

	let message: string;
	try {
		// Built before recording anything: an opening is recorded only when there is a message to open.
		const policy = await loadDepositPolicy(supabase, business.id);
		message = buildDepositRequestMessage({
			patientName: readText(patient.full_name, 'depositOpen.patient.name'),
			businessName: business.name,
			startsAt: readText(appointment.starts_at, 'depositOpen.appointment.startsAt'),
			dueAt: deposit.due_at,
			timezone: business.timezone,
			amount: deposit.amount,
			transferDetails: policy.transferDetails,
			// «Se libera automáticamente» only if this turn cancels itself and the practice's switch is on.
			autoCancel: deposit.auto_cancel && policy.autoCancelEnabled,
			publicUrl: publicAppointmentUrl(readText(appointment.confirmation_token, 'depositOpen.appointment.token'))
		});
	} catch (messageError) {
		logServerFailure('Error armando el pedido de seña por WhatsApp', messageError);
		throw redirect(303, back('error'));
	}

	try {
		await openDepositReminder(supabase, {
			businessId: business.id,
			appointmentId: params.appointmentId,
			reopen: url.searchParams.get('confirmar') === '1'
		});
	} catch (openError) {
		const code = openError instanceof DepositError ? openError.code : 'DEPOSIT_UNEXPECTED';
		if (code === 'DEPOSIT_REMINDER_ALREADY_OPENED') throw redirect(303, back('ya_abierto'));
		if (code === 'DEPOSIT_NOT_PENDING' || code === 'DEPOSIT_APPOINTMENT_CLOSED') throw redirect(303, back('no_pendiente'));
		if (code === 'DEPOSIT_NOT_FOUND') throw redirect(303, back('no_encontrado'));
		logServerFailure('Error registrando el pedido de seña por WhatsApp', openError);
		throw redirect(303, back('error'));
	}

	const device = requestedDevice(url.searchParams.get('dispositivo')) ?? classifyUserAgent(request.headers.get('user-agent'));
	const whatsAppUrl = buildWaMeUrl(phone, message);
	return new Response(null, {
		status: 302,
		headers: {
			location: whatsappHrefFor(device, whatsAppUrl, buildWhatsAppWebUrl(phone, message)) ?? whatsAppUrl,
			'cache-control': 'no-store'
		}
	});
};
