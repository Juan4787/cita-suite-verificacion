// The content of an appointment email, built from the current snapshot that claiming read. Pure, so
// a preview and the real message cannot differ. The identity is the practice's: nothing here names
// the software. No clinical detail either: not even the service, which can reveal a health matter.
// Nobody reads replies (plan 12.35): the message has no Reply-To and its footer says it is not answered.
import {
	isRecord,
	readBoolean,
	readChoice,
	readNullableText,
	readRecord,
	readText
} from '$lib/contracts/json';
import {
	describeDepositDeadline,
	formatDepositAmount,
	parseAppointmentDeposit,
	parseCancellationDepositOutcome
} from '$lib/scheduling/deposits';
import {
	APPOINTMENT_EMAIL_PURPOSES,
	resolveAppointmentEmailContext,
	type AppointmentEmailPurpose
} from '$lib/scheduling/patient-action-context';
import { tokens } from '$lib/theme/palette.js';
import { formatInTimeZone } from '$lib/utils/format';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import { splitTextWithHttpsLinks } from '$lib/utils/safe-links';
import { buildWaMeUrl } from '$lib/utils/whatsapp';

export type AppointmentEmailWork = {
	deliveryId: string;
	leaseToken: string;
	purpose: AppointmentEmailPurpose;
	recipient: string;
	token: string | null;
	unsubscribeToken: string;
	sender: { fromAddress: string };
	preferences: { showCancel: boolean; showReschedule: boolean };
	snapshot: Record<string, unknown>;
};

export const parseAppointmentEmailWork = (value: unknown): AppointmentEmailWork => {
	const row = readRecord(value, 'email.work');
	const sender = readRecord(row.sender, 'email.work.sender');
	const preferences = readRecord(row.preferences, 'email.work.preferences');
	return {
		deliveryId: readText(row.delivery_id, 'email.work.delivery'),
		leaseToken: readText(row.lease_token, 'email.work.lease'),
		purpose: readChoice(row.purpose, APPOINTMENT_EMAIL_PURPOSES, 'email.work.purpose'),
		recipient: readText(row.recipient, 'email.work.recipient'),
		token: readNullableText(row.token, 'email.work.token'),
		unsubscribeToken: readText(row.unsubscribe_token, 'email.work.unsubscribe'),
		sender: { fromAddress: readText(sender.from_address, 'email.work.from') },
		preferences: {
			showCancel: readBoolean(preferences.show_cancel, 'email.work.showCancel'),
			showReschedule: readBoolean(preferences.show_reschedule, 'email.work.showReschedule')
		},
		snapshot: readRecord(row.snapshot, 'email.work.snapshot')
	};
};

const color = (name: string) => {
	const value = tokens.find((token) => token[0] === name)?.[1];
	if (!value) throw new Error(`Unknown theme color ${name}`);
	return value;
};

const escapeHtml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A header value: one line, bounded. A practice name must never add a header or break the subject. */
export const headerText = (value: string, limit = 150) =>
	value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, limit);

const button = (href: string, label: string, primary: boolean) =>
	`<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none;` +
	(primary
		? `background:${color('--accent-strong')};color:${color('--on-accent')};`
		: `background:${color('--surface')};color:${color('--accent-text')};border:1px solid ${color('--border-strong')};`) +
	`">${escapeHtml(label)}</a>`;

const paragraph = (value: string) =>
	`<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${color('--text')};">${escapeHtml(value).replace(/\n/g, '<br>')}</p>`;

const paragraphWithHttpsLinks = (prefix: string, value: string) => {
	const rendered = splitTextWithHttpsLinks(value)
		.map((part) =>
			part.type === 'link'
				? `<a href="${escapeHtml(part.href)}" style="color:${color('--accent-text')};text-decoration:underline;word-break:break-word;">${escapeHtml(part.label)}</a>`
				: escapeHtml(part.value).replace(/\n/g, '<br>')
		)
		.join('');
	return `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${color('--text')};">${escapeHtml(prefix)}${rendered}</p>`;
};

const VIRTUAL_LINK_UPDATED_NOTICE =
	'Si cambia el enlace de conexión, el enlace vigente está siempre en la página de tu turno.';

const small = (value: string) =>
	`<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${color('--text-muted')};">${escapeHtml(value)}</p>`;

type EmailLink = { label: string; href: string; primary: boolean };

export type BuiltAppointmentEmail =
	| { send: false; reason: string }
	| { send: true; subject: string; preheader: string; html: string; text: string; headers: Record<string, string>; fromName: string; links: EmailLink[] };

const headings: Record<AppointmentEmailPurpose, string> = {
	booking_receipt: 'Tu turno quedó reservado',
	reschedule_receipt: 'Tu turno cambió de horario',
	cancellation_receipt: 'Tu turno fue cancelado',
	deposit_request: 'Falta registrar la seña de tu turno',
	deposit_expiring_reminder: 'Tu seña está por vencer',
	reminder_72h: 'Te recordamos tu turno',
	reminder_24h: 'Tu turno se acerca'
};

export const buildAppointmentEmail = (
	work: AppointmentEmailWork,
	options: { siteUrl: string; now: Date }
): BuiltAppointmentEmail => {
	const snapshot = work.snapshot;
	const business = readRecord(snapshot.business, 'email.snapshot.business');
	const businessName = headerText(readText(business.name, 'email.snapshot.business.name'), 80);
	const timezone = readText(business.timezone, 'email.snapshot.business.timezone');
	const status = readText(snapshot.status, 'email.snapshot.status');
	const startsAt = readText(snapshot.starts_at, 'email.snapshot.startsAt');
	const deposit = snapshot.deposit === null || snapshot.deposit === undefined ? null : parseAppointmentDeposit(snapshot.deposit);
	const context = resolveAppointmentEmailContext({
		status,
		startsAt,
		now: options.now,
		managementAccessValid: work.purpose === 'cancellation_receipt' || work.token !== null,
		cancelAllowed: snapshot.can_cancel === true,
		rescheduleAllowed: snapshot.can_reschedule === true,
		newBookingAllowed: snapshot.new_booking_allowed === true,
		purpose: work.purpose,
		depositStatus: deposit?.status ?? null,
		showCancel: work.preferences.showCancel,
		showReschedule: work.preferences.showReschedule
	});
	if (!context.send) return { send: false, reason: context.skipReason ?? 'invalid_context' };

	const when = formatInTimeZone(startsAt, timezone);
	const modality = typeof snapshot.modality === 'string' ? snapshot.modality : 'in_person';
	const virtual = modality === 'video';
	const integration = isRecord(snapshot.integration) ? snapshot.integration : null;
	const address = typeof business.address === 'string' && business.address.trim() ? business.address.trim() : null;
	const addressInstructions =
		typeof business.address_instructions === 'string' && business.address_instructions.trim()
			? business.address_instructions.trim()
			: null;
	const videoInstructions =
		typeof integration?.video_instructions_snapshot === 'string' && integration.video_instructions_snapshot.trim()
			? integration.video_instructions_snapshot.trim()
			: null;
	const mapsUrl = typeof business.maps_url === 'string' && /^https:\/\//.test(business.maps_url) ? business.maps_url : null;
	const logoUrl = typeof business.logo_url === 'string' && /^https:\/\//.test(business.logo_url) ? business.logo_url : null;
	const whatsappPhone = normalizeArgentineWhatsAppPhone(
		typeof business.whatsapp_contact_phone === 'string' ? business.whatsapp_contact_phone : null
	);
	const phone = typeof business.whatsapp_contact_phone === 'string' ? business.whatsapp_contact_phone
		: typeof business.phone === 'string' ? business.phone : null;
	const patientName = typeof snapshot.patient_name === 'string' ? snapshot.patient_name.trim().split(/\s+/)[0] ?? '' : '';
	const cancelled = work.purpose === 'cancellation_receipt';
	const cancelledByDepositExpiry =
		cancelled && (snapshot.cancelled_by_deposit_expiry === true || deposit?.status === 'expired');
	const cancellationDepositOutcome = cancelled
		? (() => {
				try {
					return parseCancellationDepositOutcome(snapshot.cancellation_deposit_outcome);
				} catch {
					return null;
				}
			})()
		: null;
	const depositPending = !cancelled && deposit?.status === 'pending';
	const depositPaymentNoticeAt = depositPending ? (deposit?.patient_payment_notice_at ?? null) : null;
	const transferDetails = typeof snapshot.deposit_transfer_details === 'string' ? snapshot.deposit_transfer_details : null;
	const selfManagementWindowClosed = !cancelled && snapshot.self_management_window_closed === true;
	const selfManagementCutoffHours =
		typeof snapshot.self_management_cutoff_hours === 'number' && Number.isSafeInteger(snapshot.self_management_cutoff_hours)
			? snapshot.self_management_cutoff_hours
			: null;

	const cancelledDepositDueLabel =
		cancelledByDepositExpiry && deposit ? formatInTimeZone(deposit.due_at, timezone).full : null;

	const stateLine = cancelled
		? cancelledDepositDueLabel
			? `El turno del ${when.full} se canceló automáticamente porque no se registró la seña antes del ${cancelledDepositDueLabel}.`
			: cancelledByDepositExpiry
				? `El turno del ${when.full} se canceló automáticamente porque no se registró la seña dentro del plazo.`
				: `El turno del ${when.full} quedó cancelado.`
		: work.purpose === 'deposit_expiring_reminder'
			? 'La seña de tu turno está por vencer. Transferila y avisá al consultorio para confirmarlo.'
			: depositPending
				? depositPaymentNoticeAt
					? 'Tu turno está reservado. Ya avisaste que transferiste la seña y el consultorio va a verificar el pago.'
					: 'Tu turno está reservado. Se confirma cuando el consultorio registre la seña.'
				: status === 'confirmed'
					? 'Tu turno está confirmado.'
					: 'Tu turno está reservado.';
	const subject = headerText(
		work.purpose === 'booking_receipt' ? `Tu turno en ${businessName}: ${when.full}`
		: work.purpose === 'reschedule_receipt' ? `Tu turno cambió: ${when.full}`
		: work.purpose === 'cancellation_receipt' ? `Turno cancelado: ${when.full}`
		: work.purpose === 'deposit_request' ? `Seña de tu turno del ${when.full}`
		: work.purpose === 'deposit_expiring_reminder' ? `Tu seña está por vencer: turno del ${when.full}`
		: `Recordatorio de tu turno: ${when.full}`
	);
	const preheader = headerText(cancelled ? stateLine : `${when.full}. ${stateLine}`, 120);

	const base = work.token ? `${options.siteUrl}/gestion/${work.token}` : null;
	// The link states which time this message described, so an old message can say that it changed.
	const sentFor = typeof snapshot.schedule_revision === 'number' ? `desde=${snapshot.schedule_revision}` : '';
	const links: EmailLink[] = [];
	if (base && !cancelled) {
		if (work.purpose === 'deposit_expiring_reminder') {
			links.push({
				label: 'Pagar la seña y avisar',
				href: `${sentFor ? `${base}?${sentFor}` : base}#sena-del-turno`,
				primary: true
			});
		} else {
			links.push({ label: 'Ver mi turno', href: sentFor ? `${base}?${sentFor}` : base, primary: true });
		}
	}
	if (base && context.actions.reschedule) links.push({ label: 'Reprogramar', href: `${base}?accion=reprogramar${sentFor ? `&${sentFor}` : ''}`, primary: false });
	if (base && context.actions.cancel) links.push({ label: 'Cancelar', href: `${base}?accion=cancelar${sentFor ? `&${sentFor}` : ''}`, primary: false });
	if (context.actions.bookNew) {
		const slug = typeof business.slug === 'string' ? business.slug : null;
		const path = integration?.is_active === true && typeof integration.public_key === 'string'
			? `/embed/v1/${integration.public_key}` : slug ? `/reservar/${slug}` : null;
		if (path) links.push({ label: 'Reservar otro turno', href: `${options.siteUrl}${path}`, primary: true });
	}
	if (cancelledByDepositExpiry && whatsappPhone) {
		const whatsappMessage = `Hola, te escribo por mi turno del ${when.full} que se canceló por falta de seña.`;
		links.push({
			label: 'Escribir al consultorio por WhatsApp',
			href: buildWaMeUrl(whatsappPhone, whatsappMessage),
			primary: !links.some((link) => link.primary)
		});
	}
	const calendarUrl = base && !cancelled ? `${base}/calendario.ics` : null;
	const unsubscribeUrl = `${options.siteUrl}/correo/baja/${work.unsubscribeToken}`;

	const details: string[] = [];
	const detailsHtml: string[] = [];
	if (!cancelled) {
		details.push(`Fecha y hora: ${when.full}`);
		detailsHtml.push(paragraph(`Fecha y hora: ${when.full}`));
	}
	if (!cancelled && virtual) {
		details.push('Modalidad: virtual');
		detailsHtml.push(paragraph('Modalidad: virtual'));
	}
	if (!cancelled && virtual && videoInstructions) {
		details.push(`Indicaciones: ${videoInstructions}`);
		details.push(VIRTUAL_LINK_UPDATED_NOTICE);
		detailsHtml.push(paragraphWithHttpsLinks('Indicaciones: ', videoInstructions));
		detailsHtml.push(paragraph(VIRTUAL_LINK_UPDATED_NOTICE));
	}
	if (!cancelled && !virtual && address) {
		details.push(`Dirección: ${address}`);
		detailsHtml.push(paragraph(`Dirección: ${address}`));
	}
	if (!cancelled && !virtual && addressInstructions) {
		details.push(`Indicaciones: ${addressInstructions}`);
		detailsHtml.push(paragraph(`Indicaciones: ${addressInstructions}`));
	}

	const depositLines: string[] = [];
	if (depositPending && deposit) {
		const deadline = describeDepositDeadline(
			{
				amount: deposit.amount,
				dueAt: deposit.due_at,
				autoCancel: deposit.auto_cancel,
				paymentNoticeAt: depositPaymentNoticeAt
			},
			timezone,
			options.now
		);
		depositLines.push(deadline.emailLine);
		if (depositPaymentNoticeAt) {
			depositLines.push('Ya avisaste que transferiste la seña; el consultorio va a verificar el pago.');
		} else {
			if (transferDetails) depositLines.push(`Datos para transferir:\n${transferDetails}`);
			if (deadline.autoCancelSentence) depositLines.push(deadline.autoCancelSentence);
			depositLines.push('Esto no es un comprobante de pago: el consultorio registra la seña cuando recibe la transferencia.');
		}
	}
	const closing: string[] = [];
	const closingHtml: string[] = [];
	if (cancelled && !cancelledByDepositExpiry && cancellationDepositOutcome) {
		const amountLabel = formatDepositAmount(Number(cancellationDepositOutcome.amount));
		const line =
			cancellationDepositOutcome.outcome === 'credit'
				? cancellationDepositOutcome.reason === 'force_majeure'
					? `Tu seña de ${amountLabel} quedó a cuenta para un próximo turno por excepción del consultorio.`
					: `Tu seña de ${amountLabel} quedó a cuenta para un próximo turno.`
				: cancellationDepositOutcome.cutoffHours
					? `Como la cancelación fue con menos de ${cancellationDepositOutcome.cutoffHours === 1 ? '1\u00a0hora' : `${cancellationDepositOutcome.cutoffHours}\u00a0horas`} de anticipación, la seña de ${amountLabel} se perdió.`
					: `La seña de ${amountLabel} se perdió por cancelación fuera de plazo.`;
		closing.push(line);
		closingHtml.push(paragraph(line));
	}
	if (selfManagementWindowClosed) {
		const hoursText = selfManagementCutoffHours
			? selfManagementCutoffHours === 1
				? 'la última hora'
				: `las últimas ${selfManagementCutoffHours}\u00a0horas`
			: 'el límite previo';
		if (whatsappPhone) {
			const waUrl = buildWaMeUrl(whatsappPhone, `Hola, te escribo por mi turno del ${when.full}.`);
			closing.push(
				`Este turno está dentro de ${hoursText} antes de la consulta y no admite cambios ni cancelaciones online. Si necesitás coordinar un cambio, escribile al consultorio por WhatsApp: ${waUrl}`
			);
			closingHtml.push(
				`<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${color('--text')};">${escapeHtml(`Este turno está dentro de ${hoursText} antes de la consulta y no admite cambios ni cancelaciones online. Si necesitás coordinar un cambio, `)}<a href="${escapeHtml(waUrl)}" style="color:${color('--accent-text')};text-decoration:underline;">escribile al consultorio por WhatsApp</a>.</p>`
			);
		} else {
			const line = `Este turno está dentro de ${hoursText} antes de la consulta y no admite cambios ni cancelaciones online. Si necesitás coordinar un cambio, contactá al consultorio.`;
			closing.push(line);
			closingHtml.push(paragraph(line));
		}
	}
	if (cancelledByDepositExpiry) {
		const line = 'Si ya hiciste la transferencia o querés coordinar otro horario, escribile al consultorio.';
		closing.push(line);
		closingHtml.push(paragraph(line));
	}
	// Sólo el archivo queda viejo: quien conectó su cuenta Google no debe borrar un evento ya actualizado.
	if (work.purpose === 'reschedule_receipt') {
		const line = 'Si guardaste el archivo en tu calendario, borrá el evento anterior y guardá el nuevo. Si conectaste tu cuenta Google, ese evento se actualiza solo.';
		closing.push(line);
		closingHtml.push(paragraph(line));
	}
	if (cancelled) {
		const line = 'Si guardaste el archivo en tu calendario, borralo desde ahí. Si conectaste tu cuenta Google, ese evento se quita solo.';
		closing.push(line);
		closingHtml.push(paragraph(line));
	}

	const footer = [
		`Recibís este correo porque tenés un turno en ${businessName}.`,
		address && !virtual ? address : null,
		phone ? `Teléfono: ${phone}` : null,
		'Este correo es automático y no recibe respuestas.'
	].filter((line): line is string => line !== null);

	const text = [
		headings[work.purpose],
		'',
		patientName ? `Hola, ${patientName}.` : null,
		stateLine,
		'',
		...details,
		...(depositLines.length ? ['', ...depositLines] : []),
		...(closing.length ? ['', ...closing] : []),
		...(links.length ? ['', ...links.map((link) => `${link.label}: ${link.href}`)] : []),
		...(calendarUrl ? [`Agregar a mi calendario: ${calendarUrl}`] : []),
		...(mapsUrl && !virtual && !cancelled ? [`Cómo llegar: ${mapsUrl}`] : []),
		'',
		'--',
		...footer,
		`Dejar de recibir estos correos: ${unsubscribeUrl}`
	].filter((line): line is string => line !== null).join('\n');

	const header = logoUrl
		? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" height="56" style="display:block;max-height:56px;border:0;">`
		: `<p style="margin:0;font-size:18px;font-weight:700;color:${color('--text')};">${escapeHtml(businessName)}</p>`;

	const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(subject)}</title></head>` +
		`<body style="margin:0;padding:0;background:${color('--bg')};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
		`<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color('--bg')};"><tr><td align="center" style="padding:16px;">` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${color('--surface')};border:1px solid ${color('--border')};border-radius:14px;"><tr><td style="padding:24px;">` +
		`<div style="margin-bottom:20px;">${header}</div>` +
		`<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${color('--text')};">${escapeHtml(headings[work.purpose])}</h1>` +
		(patientName ? paragraph(`Hola, ${patientName}.`) : '') +
		paragraph(stateLine) +
		(detailsHtml.length ? `<div style="margin:16px 0;padding:14px 16px;background:${color('--surface-2')};border-radius:10px;">${detailsHtml.join('')}</div>` : '') +
		(depositLines.length ? `<div style="margin:16px 0;padding:14px 16px;background:${color('--warning-soft')};border-radius:10px;">${depositLines.map(paragraph).join('')}</div>` : '') +
		closingHtml.join('') +
		(links.length ? `<div style="margin:20px 0 8px;">${links.map((link) => button(link.href, link.label, link.primary)).join('')}</div>` : '') +
		(calendarUrl ? `<p style="margin:8px 0;font-size:14px;"><a href="${escapeHtml(calendarUrl)}" style="color:${color('--accent-text')};">Agregar a mi calendario</a></p>` : '') +
		(mapsUrl && !virtual && !cancelled ? `<p style="margin:8px 0;font-size:14px;"><a href="${escapeHtml(mapsUrl)}" style="color:${color('--accent-text')};">Cómo llegar</a></p>` : '') +
		`<hr style="margin:24px 0 16px;border:0;border-top:1px solid ${color('--border')};">` +
		footer.map(small).join('') +
		`<p style="margin:8px 0 0;font-size:13px;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:${color('--text-muted')};">Dejar de recibir estos correos</a></p>` +
		`</td></tr></table></td></tr></table></body></html>`;

	return {
		send: true,
		subject,
		preheader,
		html,
		text,
		fromName: businessName,
		links,
		headers: {
			'List-Unsubscribe': `<${unsubscribeUrl}>`,
			'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
		}
	};
};
