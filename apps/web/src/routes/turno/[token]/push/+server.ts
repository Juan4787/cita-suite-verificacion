// Alta de suscripción push para un turno. Si el permiso todavía está sin decidir,
// el cliente lo pide únicamente después del toque. Si ya estaba concedido, recupera
// la suscripción automáticamente sin volver a interrumpir a la persona.

import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import {
	getLatestPushTestStatus,
	getPushDeliveryStatus,
	isPushConfigured,
	isValidPushDeliveryId,
	isValidPushTestRequestKey,
	isValidSubscriptionPayload,
	recordPushTestFeedback,
	saveAppointmentPushSubscription,
	sendTestPushNotification
} from '$lib/server/push';
import type { RequestHandler } from './$types';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';

export const POST: RequestHandler = async ({ params, request, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (env.DEMO_MODE === 'true') return json({ ok: true, demo: true });
	if (!isPushConfigured()) {
		return json(
			{ ok: false, message: 'Las notificaciones no están disponibles en este momento.' },
			{ status: 503 }
		);
	}

	const { appointment, supabase } = await loadAppointmentForToken(fetch, params.token);
	if (
		!appointment ||
		!supabase ||
		appointment.is_past ||
		!isActiveAppointmentStatus(appointment.status)
	) {
		return json({ ok: false, message: 'El turno no admite recordatorios.' }, { status: 404 });
	}

	let raw: unknown;
	try {
		const body = await request.text();
		if (body.length > 16_384) throw new Error('BODY_TOO_LARGE');
		raw = JSON.parse(body);
	} catch {
		return json(
			{ ok: false, message: 'No pudimos leer los datos necesarios para activar el recordatorio.' },
			{ status: 400 }
		);
	}
	const wrapped = raw as {
		subscription?: unknown;
		test?: unknown;
		testRequestKey?: unknown;
	} | null;
	const payload = wrapped?.subscription ?? raw;
	// Compatibilidad con clientes anteriores: el body crudo sólo guarda. La prueba
	// inmediata se dispara únicamente con el contrato nuevo `{ subscription, test }`.
	const requestTest = Boolean(wrapped?.subscription && wrapped.test === true);
	const testRequestKey =
		typeof wrapped?.testRequestKey === 'string' ? wrapped.testRequestKey.trim() : '';
	if (requestTest && testRequestKey && !isValidPushTestRequestKey(testRequestKey)) {
		return json({ ok: false, message: 'No pudimos preparar la prueba.' }, { status: 400 });
	}
	if (!isValidSubscriptionPayload(payload)) {
		return json(
			{ ok: false, message: 'No pudimos preparar el recordatorio en este teléfono.' },
			{ status: 400 }
		);
	}

	try {
		const saved = await saveAppointmentPushSubscription(
			supabase,
			appointment,
			payload,
			request.headers.get('user-agent')
		);
		// Un 404/410 previo es una razón técnica concreta. El permiso del navegador
		// no se toca en el servidor: el cliente reemplaza esa suscripción y vuelve a
		// asociar el endpoint sano al turno.
		if (saved.providerGone) {
			return json(
				{
					ok: false,
					code: 'subscription_expired',
					message: 'El teléfono rechazó la configuración anterior de avisos.'
				},
				{ status: 410 }
			);
		}
		// La confirmación pertenece al dispositivo. Se reutiliza en este u otro
		// turno sin volver a preguntar ni mandar otra prueba automáticamente.
		if (saved.verifiedAt) {
			return json({ ok: true, verified: true, delivery: null, verificationAvailable: true });
		}
		if (requestTest) {
			const testResult = await sendTestPushNotification(supabase, {
				appointment,
				...(testRequestKey ? { requestKey: testRequestKey } : {}),
				subscription: {
					id: saved.id,
					endpoint: payload.endpoint,
					p256dh: payload.keys.p256dh,
					auth: payload.keys.auth
				}
			});
			if (!testResult.accepted) {
				return json(
					{
						ok: false,
						code: testResult.gone ? 'subscription_expired' : 'test_not_accepted',
						message: testResult.gone
							? 'El teléfono rechazó la configuración anterior de avisos.'
							: 'No pudimos completar la notificación de prueba en este momento.'
					},
					{ status: testResult.gone ? 410 : 502 }
				);
			}
			let delivery = null;
			if (testResult.deliveryId) {
				try {
					delivery = await getPushDeliveryStatus(supabase, {
						appointmentId: appointment.id,
						deliveryId: testResult.deliveryId
					});
				} catch (statusError) {
					// El proveedor ya aceptó la prueba y existe un identificador durable.
					// Una lectura transitoria no debe convertir ese envío exitoso en un
					// falso error de activación: el cliente puede volver a consultarlo.
					console.error('Error consultando estado de prueba push recién enviada', statusError);
				}
			}
			return json({
				ok: true,
				verified: false,
				deliveryId: testResult.deliveryId,
				delivery,
				verificationAvailable: Boolean(testResult.deliveryId)
			});
		}

		const delivery = await getLatestPushTestStatus(supabase, { subscriptionId: saved.id });
		return json({
			ok: true,
			verified: false,
			delivery,
			verificationAvailable: Boolean(delivery)
		});
	} catch (error) {
		console.error('Error guardando suscripción push', error);
		return json(
			{
				ok: false,
				message: 'No pudimos completar la activación en este momento.'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ params, url, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const deliveryId = (url.searchParams.get('delivery_id') ?? '').trim();
	if (!isValidPushDeliveryId(deliveryId)) {
		return json({ ok: false, message: 'No pudimos verificar la prueba.' }, { status: 400 });
	}
	const { appointment, supabase } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment || !supabase) {
		return json({ ok: false, message: 'El turno no está disponible.' }, { status: 404 });
	}
	try {
		const delivery = await getPushDeliveryStatus(supabase, {
			appointmentId: appointment.id,
			deliveryId
		});
		if (!delivery) {
			return json({ ok: false, message: 'No pudimos verificar la prueba.' }, { status: 404 });
		}
		return json({ ok: true, delivery });
	} catch (error) {
		console.error('Error consultando prueba push', error);
		return json(
			{ ok: false, message: 'No pudimos comprobar la notificación todavía.' },
			{ status: 500 }
		);
	}
};

export const PATCH: RequestHandler = async ({ params, request, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	let raw: unknown;
	try {
		const body = await request.text();
		if (body.length > 4096) throw new Error('BODY_TOO_LARGE');
		raw = JSON.parse(body);
	} catch {
		return json({ ok: false, message: 'No pudimos guardar tu respuesta.' }, { status: 400 });
	}
	const input = raw as { deliveryId?: unknown; visible?: unknown } | null;
	const deliveryId = typeof input?.deliveryId === 'string' ? input.deliveryId.trim() : '';
	if (!isValidPushDeliveryId(deliveryId) || typeof input?.visible !== 'boolean') {
		return json({ ok: false, message: 'No pudimos guardar tu respuesta.' }, { status: 400 });
	}

	const { appointment, supabase } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment || !supabase) {
		return json({ ok: false, message: 'El turno no está disponible.' }, { status: 404 });
	}
	try {
		const updated = await recordPushTestFeedback(supabase, {
			appointmentId: appointment.id,
			deliveryId,
			visible: input.visible
		});
		if (!updated) {
			return json({ ok: false, message: 'No pudimos guardar tu respuesta.' }, { status: 404 });
		}
		const delivery = await getPushDeliveryStatus(supabase, {
			appointmentId: appointment.id,
			deliveryId
		});
		return json({ ok: true, delivery });
	} catch (error) {
		console.error('Error guardando confirmación de prueba push', error);
		return json(
			{ ok: false, message: 'No pudimos guardar tu respuesta. Volvé a intentar.' },
			{ status: 500 }
		);
	}
};
