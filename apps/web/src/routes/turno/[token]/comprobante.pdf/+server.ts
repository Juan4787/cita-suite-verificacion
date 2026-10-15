// Comprobante de turno en PDF (generación SERVER-SIDE, descarga en todos los dispositivos).
// Mismos datos que el resumen de la reserva + la ubicación como dato. Se genera siempre
// desde el estado ACTUAL del turno; no cachear (lleva el token en la URL).

import { error } from '@sveltejs/kit';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import { buildAppointmentReceiptPdf, type ReceiptField } from '$lib/server/receipt-pdf';
import { formatDateTime } from '$lib/utils/format';
import { BOOKING_MODALITY_LABELS } from '@turnos-saas/shared/booking-integration';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, fetch }) => {
	const { appointment } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment) throw error(404, 'El enlace no es válido o ya no está disponible.');

	const business = appointment.business;
	const fields: ReceiptField[] = [
		{ label: 'Servicio', value: appointment.service_name_snapshot },
		{
			label: appointment.is_joint ? 'Equipo profesional' : 'Profesional',
			value: appointment.professional_name_snapshot
		},
		{ label: 'Fecha y hora', value: formatDateTime(appointment.starts_at, business.timezone) }
	];
	if (appointment.booking_context) fields.push({ label: 'Modalidad', value: BOOKING_MODALITY_LABELS[appointment.booking_context.modality] });
	if (business.address) fields.push({ label: 'Ubicación', value: business.address });
	if (business.address_instructions) {
		fields.push({ label: 'Indicaciones', value: business.address_instructions });
	}

	const pdf = await buildAppointmentReceiptPdf({
		title: 'Comprobante de turno',
		businessName: business.name,
		statusLabel: appointment.public_status_label,
		fields,
		footer: `Comprobante generado el ${formatDateTime(new Date().toISOString(), business.timezone)}.`
	});

	// Copia a un buffer propio para tipar el body como BodyInit (doc.save() devuelve
	// Uint8Array<ArrayBufferLike>, que TS no acepta directo en Response).
	const body = new Uint8Array(pdf.byteLength);
	body.set(pdf);

	return new Response(body, {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': 'attachment; filename="comprobante-turno.pdf"',
			'cache-control': 'no-store'
		}
	});
};
