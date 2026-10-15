import { env } from '$env/dynamic/private';
import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/business';
import {
	cancelPreapproval,
	confirmMpSubscriptionForBusiness,
	createPreapproval,
	getMercadoPagoEnvironment,
	getMercadoPagoApiConfigIssue,
	getPreapproval,
	getSubscriptionAmountArs,
	pickRelevantMpSubscription,
	settleApprovedChargesForPreapproval,
	upsertMpSubscription,
	type MpApiResult,
	type MpPreapproval,
	type MpReturnSummary
} from '$lib/server/mercadopago';
import { getExternalCallbackSiteUrl } from '$lib/server/messaging';
import {
	enforceRateLimits,
	mpSubscriptionRateLimitRules,
	rateLimitFail
} from '$lib/server/rate-limits';
import { createSupabaseAdminClient, createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export type MpSubscriptionView = {
	preapproval_id: string;
	status: string;
	payer_email: string | null;
	transaction_amount: number | null;
	next_charge_at: string | null;
	updated_at: string | null;
};

const PENDING_PREAPPROVAL_REUSE_MS = 15 * 60 * 1000;
const SUBSCRIPTION_PREPARATION_UNAVAILABLE =
	'No pudimos preparar el ingreso a Mercado Pago. No se generó ningún cobro. Probá de nuevo en unos minutos; si continúa, contactá a soporte.';

const loadMpSubscription = async (
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
	businessId: string
): Promise<MpSubscriptionView | null> => {
	const { data, error } = await admin
		.from('mp_subscriptions')
		.select('preapproval_id, status, payer_email, transaction_amount, next_charge_at, updated_at')
		.eq('business_id', businessId)
		.order('created_at', { ascending: false })
		.limit(5);
	if (error) {
		console.error('Error cargando suscripción de Mercado Pago', error);
		return null;
	}
	return pickRelevantMpSubscription((data ?? []) as MpSubscriptionView[]);
};

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			grants: [],
			demo: true,
			mpSubscription: null,
			mpAmount: getSubscriptionAmountArs(),
			mpEnvironment: getMercadoPagoEnvironment(),
			mpReturn: null as MpReturnSummary | null,
			mpReturnFailed: false
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	let context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');

	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role !== 'owner' && context.role !== 'admin') throw redirect(303, '/odonto/agenda');
	if (context.assistance) throw redirect(303, '/odonto/configuracion/ayuda');

	// Sin cliente admin la página degrada (no muestra el estado MP) pero no se
	// cae: el estado comercial sale del cliente del usuario igual que antes.
	let admin: Awaited<ReturnType<typeof createSupabaseAdminClient>> | null = null;
	try {
		admin = await createSupabaseAdminClient('odonto', fetch);
	} catch (error) {
		console.error('No se pudo crear el cliente admin para la página de suscripción', error);
	}

	// Retorno del checkout: confirmación activa contra la API de MP ANTES de
	// leer el estado, así el cliente ve su acceso al día en esta misma carga.
	// Si MP está lento/caído, la página no se cae: el webhook y la conciliación
	// acreditan solos después.
	let mpReturn: MpReturnSummary | null = null;
	let mpReturnFailed = false;
	if (admin && url.searchParams.get('mp') === 'retorno') {
		try {
			mpReturn = await confirmMpSubscriptionForBusiness(admin, fetch, context.business.id);
			// El contexto se refresca siempre tras confirmar: si el webhook ganó
			// la carrera y acreditó primero (outcome duplicado), el acceso al día
			// igual tiene que verse en esta carga.
			const refreshed = await resolveActiveBusiness({
				supabase,
				accessToken: locals.auth.access_token,
				cookies
			});
			if (refreshed) context = refreshed;
		} catch (error) {
			mpReturnFailed = true;
			console.error('No se pudo confirmar el retorno de Mercado Pago', error);
		}
	}

	const [{ data: grants, error }, mpSubscription] = await Promise.all([
		supabase
			.from('access_grants')
			.select(
				'id, operation, duration_unit, duration_seconds, is_permanent_grant, amount, source, note, admin_email, paid_until_before, paid_until_after, status_before, status_after, created_at'
			)
			.eq('business_id', context.business.id)
			.order('created_at', { ascending: false })
			.limit(30),
		admin ? loadMpSubscription(admin, context.business.id) : Promise.resolve(null)
	]);

	if (error) {
		console.error('Error cargando historial de suscripción', error);
	}

	return {
		context,
		grants: grants ?? [],
		demo: false,
		mpSubscription,
		mpAmount: getSubscriptionAmountArs(),
		mpEnvironment: getMercadoPagoEnvironment(),
		mpReturn,
		mpReturnFailed: mpReturnFailed || (!admin && url.searchParams.get('mp') === 'retorno')
	};
};

export const actions: Actions = {
	subscribe: async ({ locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
		let context: Awaited<ReturnType<typeof resolveActiveBusiness>>;
		try {
			supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
			context = await resolveActiveBusiness({
				supabase,
				accessToken: locals.auth.access_token,
				cookies
			});
		} catch (error) {
			console.error('No se pudo preparar el contexto para suscribir', error);
			return fail(503, { message: SUBSCRIPTION_PREPARATION_UNAVAILABLE });
		}
		if (!context) {
			return fail(503, { message: SUBSCRIPTION_PREPARATION_UNAVAILABLE });
		}
		if (context.role !== 'owner' && context.role !== 'admin') {
			return fail(403, { message: 'No tenés permisos para gestionar la suscripción.' });
		}
		if (context.assistance) {
			return fail(403, { message: 'La suscripción la gestiona el consultorio.' });
		}
		if (context.access.isPermanent) {
			return fail(400, { message: 'Tu cuenta es permanente: no necesita suscripción.' });
		}
		// Kill-switch manual o archivado administrativo: un pago automático NO
		// reactiva el acceso (lo manual gana), así que suscribirse solo
		// generaría cobros sin servicio. Un "archived" calculado por vencimiento
		// total tiene archivedAt null y sí es pagable.
		if (!context.access.commercialAccessEnabled || context.access.archivedAt) {
			return fail(409, {
				message:
					'Tu acceso está suspendido por el administrador del sistema. Un pago no lo reactivaría automáticamente: escribí a soporte antes de suscribirte.'
			});
		}

		let authEmail = '';
		try {
			const { data: userData, error: userError } = await supabase.auth.getUser();
			if (userError) {
				console.warn('No se pudo leer el email autenticado para la suscripción', {
					status: userError.status
				});
			} else {
				authEmail = userData?.user?.email?.trim() ?? '';
			}
		} catch (error) {
			console.error('No se pudo consultar el email autenticado para la suscripción', error);
		}
		const payerEmail =
			authEmail || context.business.email?.trim() || '';
		if (!payerEmail) {
			return fail(400, {
				message: 'No encontramos un email para asociar la suscripción. Cargá un email en la configuración del negocio.'
			});
		}

		const amount = getSubscriptionAmountArs();
		const backUrl = `${getExternalCallbackSiteUrl()}/odonto/pago/procesando?mp=retorno`;
		const mpConfigIssue = getMercadoPagoApiConfigIssue();
		if (mpConfigIssue) {
			console.error('Mercado Pago no está configurado para crear suscripciones', {
				missing: mpConfigIssue
			});
			return fail(503, { message: SUBSCRIPTION_PREPARATION_UNAVAILABLE });
		}

		// El cliente admin se crea ANTES de tocar Mercado Pago: si falta el
		// service role acá, mejor fallar sin haber creado un preapproval
		// huérfano del otro lado.
		let admin;
		try {
			admin = await createSupabaseAdminClient('odonto', fetch);
		} catch (error) {
			console.error('No se pudo crear el cliente admin para suscribir', error);
			return fail(503, { message: SUBSCRIPTION_PREPARATION_UNAVAILABLE });
		}

		// Nunca dos débitos para el mismo negocio. Además de bloquear una activa,
		// reutilizamos la solicitud pendiente más nueva: repetir el botón ya no
		// crea varios links que podrían autorizarse y debitarse por separado.
		const { data: existingRows, error: existingError } = await admin
			.from('mp_subscriptions')
			.select('preapproval_id, status, created_at')
			.eq('business_id', context.business.id)
			.in('status', ['authorized', 'paused', 'pending'])
			.order('created_at', { ascending: false });
		if (existingError) {
			console.error('No se pudo verificar suscripciones existentes', existingError);
			return fail(503, { message: SUBSCRIPTION_PREPARATION_UNAVAILABLE });
		}
		const blockingSubscription = (existingRows ?? []).find((row) =>
			['authorized', 'paused'].includes(String(row.status))
		);
		const pendingRows = (existingRows ?? []).filter(
			(row) => String(row.status) === 'pending' && row.preapproval_id
		);
		if (pendingRows.length > 0) {
			let synchronized: Array<{
				row: { preapproval_id: string; created_at: string | null };
				result: MpApiResult<MpPreapproval>;
			}>;
			try {
				synchronized = await Promise.all(
					pendingRows.map(async (row) => ({
						row: {
							preapproval_id: String(row.preapproval_id),
							created_at: row.created_at ? String(row.created_at) : null
						},
						result: await getPreapproval(String(row.preapproval_id), fetch)
					}))
				);
			} catch (error) {
				console.error('No se pudieron consultar las solicitudes pendientes de Mercado Pago', error);
				return fail(502, {
					message:
						'Ya hay una solicitud de suscripción pendiente, pero no pudimos abrirla en este momento. Probá de nuevo en unos minutos.'
				});
			}

			if (synchronized.some(({ result }) => !result.ok || !result.data)) {
				return fail(502, {
					message:
						'Ya hay una solicitud de suscripción pendiente, pero Mercado Pago no respondió. Probá de nuevo en unos minutos.'
				});
			}

			const livePending: Array<{
				preapproval: MpPreapproval;
				createdAt: number;
			}> = [];
			let hasBlockingRemoteSubscription = false;
			for (const entry of synchronized) {
				const preapproval = entry.result.data!;
				if (preapproval.external_reference !== context.business.id) {
					console.error('Una solicitud pendiente de Mercado Pago no pertenece al negocio activo');
					return fail(409, {
						message: 'La solicitud pendiente no corresponde a este consultorio. Avisá al administrador.'
					});
				}
				await upsertMpSubscription(admin, preapproval);
				if (preapproval.status === 'authorized' || preapproval.status === 'paused') {
					hasBlockingRemoteSubscription = true;
				}
				if (preapproval.status === 'pending') {
					livePending.push({
						preapproval,
						createdAt: Date.parse(String(entry.row.created_at ?? ''))
					});
				}
			}

			const cancelLivePending = async () => {
				if (livePending.length === 0) return true;
				let cancelledResults: Array<MpApiResult<MpPreapproval>>;
				try {
					cancelledResults = await Promise.all(
						livePending.map(({ preapproval }) => cancelPreapproval(fetch, preapproval.id))
					);
				} catch (error) {
					console.error('No se pudieron cancelar solicitudes pendientes viejas', error);
					return false;
				}
				if (cancelledResults.some((result) => !result.ok || !result.data)) return false;
				for (let index = 0; index < cancelledResults.length; index += 1) {
					const cancelled = cancelledResults[index].data!;
					await upsertMpSubscription(admin, {
						...livePending[index].preapproval,
						...cancelled,
						external_reference: cancelled.external_reference ?? context.business.id
					});
				}
				return true;
			};

			if (blockingSubscription || hasBlockingRemoteSubscription) {
				if (!(await cancelLivePending())) {
					return fail(502, {
						message:
							'La suscripción ya está activa, pero no pudimos cerrar otra solicitud pendiente. Avisá al administrador antes de autorizar otro link.'
					});
				}
				return fail(400, {
					message: 'La suscripción ya está activa o pausada. Actualizá la página para ver su estado.'
				});
			}

			const reusable = livePending.length === 1 ? livePending[0] : null;
			const reusableIsRecent = Boolean(
				reusable &&
					Number.isFinite(reusable.createdAt) &&
					Date.now() - reusable.createdAt <= PENDING_PREAPPROVAL_REUSE_MS
			);
			if (reusable && reusable.preapproval.init_point && reusableIsRecent) {
				throw redirect(303, reusable.preapproval.init_point);
			}

			if (livePending.length > 0) {
				// Una solicitud vieja puede devolver un checkout vencido. Si hay más
				// de una, ninguna se reutiliza: primero se cancelan todas para que no
				// queden enlaces autorizables capaces de producir débitos duplicados.
				if (!(await cancelLivePending())) {
					return fail(502, {
						message:
							'No pudimos renovar la solicitud pendiente en Mercado Pago. Probá de nuevo en unos minutos.'
					});
				}
			}
		}

		if (blockingSubscription) {
			return fail(400, {
				message:
					'Ya hay una suscripción activa o pausada para este negocio. Actualizá la página para ver su estado.'
			});
		}

		try {
			await enforceRateLimits(mpSubscriptionRateLimitRules(context.business.id), fetch);
		} catch (error) {
			const result = rateLimitFail(error, {
				logContext: 'Error validando rate limit de suscripción MP',
				unavailableMessage: SUBSCRIPTION_PREPARATION_UNAVAILABLE
			});
			return fail(result.status, { message: result.message });
		}

		let created;
		try {
			created = await createPreapproval(fetch, {
				businessId: context.business.id,
				payerEmail,
				amount,
				backUrl
			});
		} catch (error) {
			console.error('Error creando preapproval de Mercado Pago', error);
			return fail(502, {
				message: 'No pudimos iniciar la suscripción con Mercado Pago. Probá de nuevo en unos minutos.'
			});
		}

		if (!created.ok || !created.data?.id || !created.data.init_point) {
			console.error('Mercado Pago rechazó el preapproval', created.status, created.data);
			return fail(502, {
				message: 'Mercado Pago no aceptó la solicitud. Probá de nuevo en unos minutos.'
			});
		}

		// El mapeo local se guarda ANTES de redirigir: el retorno y el webhook
		// dependen de él. Si este insert fallara, el topic subscription_preapproval
		// lo reconstruye igual desde external_reference.
		const { error: upsertError } = await admin.from('mp_subscriptions').upsert(
			{
				business_id: context.business.id,
				preapproval_id: created.data.id,
				status: created.data.status ?? 'pending',
				payer_email: payerEmail,
				transaction_amount: amount,
				currency_id: 'ARS',
				last_synced_at: new Date().toISOString(),
				raw: created.data
			},
			{ onConflict: 'preapproval_id' }
		);
		if (upsertError) {
			console.error('No se pudo guardar el mapeo de la suscripción MP', upsertError);
		}

		throw redirect(303, created.data.init_point);
	},

	cancel: async ({ request, locals, fetch, cookies }) => {
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
		if (context.role !== 'owner' && context.role !== 'admin') {
			return fail(403, { message: 'No tenés permisos para gestionar la suscripción.' });
		}
		if (context.assistance) {
			return fail(403, { message: 'La suscripción la gestiona el consultorio.' });
		}

		const form = await request.formData();
		const preapprovalId = String(form.get('preapproval_id') ?? '').trim();
		if (!preapprovalId) {
			return fail(400, { message: 'Falta el identificador de la suscripción.' });
		}

		// La suscripción tiene que pertenecer al negocio activo: nadie cancela
		// preapprovals ajenos manipulando el form.
		let admin;
		try {
			admin = await createSupabaseAdminClient('odonto', fetch);
		} catch (error) {
			console.error('No se pudo crear el cliente admin para cancelar', error);
			return fail(500, {
				message: 'El sistema no está listo para procesar la cancelación. Avisá al administrador.'
			});
		}
		const { data: owned, error: ownedError } = await admin
			.from('mp_subscriptions')
			.select('preapproval_id')
			.eq('preapproval_id', preapprovalId)
			.eq('business_id', context.business.id)
			.maybeSingle();
		if (ownedError) {
			console.error('Error verificando la suscripción a cancelar', ownedError);
			return fail(500, { message: 'No se pudo verificar la suscripción.' });
		}
		if (!owned) {
			return fail(404, { message: 'La suscripción no corresponde a este negocio.' });
		}
		const mpConfigIssue = getMercadoPagoApiConfigIssue();
		if (mpConfigIssue) {
			console.error('Mercado Pago no está configurado para cancelar suscripciones', {
				missing: mpConfigIssue
			});
			return fail(500, {
				message: 'Mercado Pago no está configurado para cancelar suscripciones. Contactá soporte.'
			});
		}

		// Antes de cancelar se asienta cualquier cobro ya aprobado sin registrar:
		// una vez cancelada, la fila sale del filtro de conciliación y el último
		// mes pagado se perdería. Si el barrido falla, la cancelación sigue (la
		// conciliación de esta última corrida como authorized aún puede curarlo).
		try {
			await settleApprovedChargesForPreapproval(admin, fetch, context.business.id, preapprovalId);
		} catch (error) {
			console.error('No se pudo asentar el cobro final antes de cancelar', error);
		}

		let cancelled;
		try {
			cancelled = await cancelPreapproval(fetch, preapprovalId);
		} catch (error) {
			console.error('Error cancelando preapproval de Mercado Pago', error);
			return fail(502, {
				message: 'No pudimos cancelar la suscripción en Mercado Pago. Probá de nuevo en unos minutos.'
			});
		}
		if (!cancelled.ok) {
			console.error('Mercado Pago rechazó la cancelación', cancelled.status, cancelled.data);
			return fail(502, {
				message: 'Mercado Pago no aceptó la cancelación. Probá de nuevo en unos minutos.'
			});
		}

		const { error: updateError } = await admin
			.from('mp_subscriptions')
			.update({
				status: cancelled.data?.status ?? 'cancelled',
				last_synced_at: new Date().toISOString(),
				raw: cancelled.data ?? { status: 'cancelled' }
			})
			.eq('preapproval_id', preapprovalId);
		if (updateError) {
			console.error('No se pudo actualizar el estado local de la suscripción', updateError);
		}

		return {
			success: true,
			message:
				'Suscripción cancelada: no se generarán más cobros. El tiempo ya pagado sigue vigente hasta su vencimiento.'
		};
	}
};
