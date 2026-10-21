import { logServerFailure } from '$lib/server/platform/logging';
import {
	COMMERCIAL_STATUSES,
	getBusinessAccessState
} from '$lib/access/commercial-access';
import {
	cancelPreapproval,
	pickRelevantMpSubscription,
	reconcileMercadoPago,
	settleApprovedChargesForPreapproval,
	type MpSubscriptionRow
} from '$lib/server/integrations/public/mercadopago';
import { ACTIVE_BUSINESS_COOKIE, normalizeSlug } from '$lib/server/access/public/business';
import { createSupabaseAdminClient, isMasterEmail } from '$lib/server/platform/supabase';
import {
	businessEmailAssociationErrorMessage,
	businessEmailAssociationErrorStatus
} from '$lib/server/access/public/business-email-association';
import { InvalidDataContractError, readArray, readBoolean, readRecord, readText } from '$lib/contracts/json';
import { parseMoneyInteger } from '$lib/utils/money-input';
import { isUuid } from '@cita-suite/shared/uuid';
import { defaultManualAccessNote } from '$lib/utils/commercial-access-copy';
import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';

// The master is the identity Auth verified in hooks, never a claim decoded from the token.
const ensureMaster = (locals: App.Locals) => {
	const user = locals.verifiedUser;
	if (!user?.email || !isMasterEmail(user.email)) {
		throw redirect(303, '/odonto/pacientes');
	}
	return { email: user.email, userId: user.id };
};

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ONBOARDING_MODES = ['manual', 'self_service'] as const;
type OnboardingMode = (typeof ONBOARDING_MODES)[number];

const isOnboardingMode = (value: string): value is OnboardingMode =>
	(ONBOARDING_MODES as readonly string[]).includes(value);

const DURATION_SECONDS: Record<string, { seconds: number | null; unit: string; label: string }> = {
	hour_1: { seconds: 60 * 60, unit: 'hour', label: '1 hora' },
	day_1: { seconds: 24 * 60 * 60, unit: 'day', label: '1 día' },
	day_7: { seconds: 7 * 24 * 60 * 60, unit: 'day', label: '7 días' },
	month_1: { seconds: 30 * 24 * 60 * 60, unit: 'month', label: '1 mes' },
	month_2: { seconds: 2 * 30 * 24 * 60 * 60, unit: 'month', label: '2 meses' },
	month_3: { seconds: 3 * 30 * 24 * 60 * 60, unit: 'month', label: '3 meses' },
	month_4: { seconds: 4 * 30 * 24 * 60 * 60, unit: 'month', label: '4 meses' },
	month_5: { seconds: 5 * 30 * 24 * 60 * 60, unit: 'month', label: '5 meses' },
	month_6: { seconds: 6 * 30 * 24 * 60 * 60, unit: 'month', label: '6 meses' },
	month_7: { seconds: 7 * 30 * 24 * 60 * 60, unit: 'month', label: '7 meses' },
	month_8: { seconds: 8 * 30 * 24 * 60 * 60, unit: 'month', label: '8 meses' },
	month_9: { seconds: 9 * 30 * 24 * 60 * 60, unit: 'month', label: '9 meses' },
	month_10: { seconds: 10 * 30 * 24 * 60 * 60, unit: 'month', label: '10 meses' },
	month_11: { seconds: 11 * 30 * 24 * 60 * 60, unit: 'month', label: '11 meses' },
	month_12: { seconds: 12 * 30 * 24 * 60 * 60, unit: 'month', label: '12 meses' },
	permanent: { seconds: null, unit: 'permanent', label: 'permanente' }
};

const BUSINESS_ACCESS_OPERATIONS = [
	'grant_access',
	'extend_access',
	'reduce_access',
	'set_permanent',
	'unset_permanent',
	'disable_business_access',
	'enable_business_access',
	'archive_business',
	'reactivate_business',
	'manual_correction',
	'payment_registered',
	'payment_cancelled'
] as const;

const normalizeEmail = (value: FormDataEntryValue | string | null | undefined) =>
	String(value ?? '')
		.trim()
		.toLowerCase();

const UNCONFIRMED_BUSINESS_CREATION =
	'No pudimos confirmar el alta del consultorio. Revisá la lista de consultorios antes de volver a intentarlo.';

// The creation confirms exactly one practice; any other answer is not a confirmation.
const readCreatedBusiness = (data: unknown) => {
	const rows = readArray(data, 'createdBusiness');
	if (rows.length !== 1) throw new InvalidDataContractError('createdBusiness');
	const row = readRecord(rows[0], 'createdBusiness');
	const businessId = readText(row.business_id, 'createdBusiness');
	if (!isUuid(businessId)) throw new InvalidDataContractError('createdBusiness');
	return { businessId, ownerLinked: readBoolean(row.owner_linked, 'createdBusiness') };
};

const listAuthEmailsById = async (admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>) => {
	const result = new Map<string, string>();
	const perPage = 200;
	let page = 1;

	while (true) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
		// A partial list would show accounts without their emails.
		if (error) throw error;
		const users = data?.users ?? [];
		for (const user of users) {
			if (user.id && user.email) result.set(user.id, user.email);
		}
		if (users.length < perPage) break;
		page += 1;
	}

	return result;
};

const businessHasMasterOwner = async (
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
	businessId: string,
	masterUserId: string | null,
	masterEmail: string
) => {
	const { data, error } = await admin
		.from('business_users')
		.select('user_id')
		.eq('business_id', businessId)
		.eq('role', 'owner');
	if (error) throw error;
	const ownerIds = (data ?? [])
		.map((membership) => String(membership.user_id ?? ''))
		.filter(Boolean);
	if (masterUserId && ownerIds.includes(masterUserId)) return true;

	const emailsByUserId = await listAuthEmailsById(admin);
	const normalizedMasterEmail = masterEmail.trim().toLowerCase();
	return ownerIds.some((userId) => {
		const email = String(emailsByUserId.get(userId) ?? '').toLowerCase();
		return email === normalizedMasterEmail || isMasterEmail(email);
	});
};

const buildMasterData = async (
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
	masterEmail: string
) => {
	const [
		emailsRes,
		businessesRes,
		subscriptionsRes,
		membershipsRes,
		grantsRes,
		mpSubsRes,
		mpAttentionRes,
		assistanceRes,
		emailsByUserId
	] = await Promise.all([
		admin
			.from('allowed_emails')
			.select('id, email, enabled, note, onboarding_mode, disabled_at, disabled_reason, created_at, updated_at')
			.order('email', { ascending: true }),
		admin
			.from('businesses')
			.select('id, name, slug, email, timezone, is_active, created_at, updated_at')
			.order('created_at', { ascending: false }),
		admin
			.from('business_subscriptions')
			.select(
				'id, business_id, commercial_access_enabled, is_permanent, subscription_status, access_starts_at, paid_until, grace_until, restricted_until, archived_at, last_payment_at, last_payment_amount, last_grant_duration_seconds, expiration_notice_enabled, access_source, access_note, updated_by, created_at, updated_at'
			),
		admin.from('business_users').select('id, business_id, user_id, role, created_at'),
		admin
			.from('access_grants')
			.select('id, business_id, operation, duration_unit, duration_seconds, amount, source, note, admin_email, paid_until_before, paid_until_after, status_before, status_after, created_at')
			.order('created_at', { ascending: false })
			.limit(200),
		admin
			.from('mp_subscriptions')
			.select(
				'business_id, preapproval_id, status, payer_email, transaction_amount, next_charge_at, last_synced_at'
			)
			.order('created_at', { ascending: false }),
		admin
			.from('mp_webhook_events')
			.select('id, received_at, topic, action, resource_id, processing_status, processing_detail, business_id')
			.eq('requires_attention', true)
			.order('received_at', { ascending: false })
			.limit(20),
		admin
			.from('account_assistance_grants')
			.select('id, business_id, requested_by_user_id, support_user_id, status, starts_at, expires_at, revoked_at, business:businesses(id, name, slug)')
			.eq('status', 'active')
			.is('revoked_at', null)
			.gt('expires_at', new Date().toISOString())
			.order('expires_at', { ascending: true }),
		listAuthEmailsById(admin)
	]);

	if (emailsRes.error) throw emailsRes.error;
	if (businessesRes.error) throw businessesRes.error;
	// Every table exists since its migration: a failed read is an error the panel shows,
	// not practices listed without their commercial state, grants or payments.
	for (const result of [subscriptionsRes, membershipsRes, grantsRes, mpSubsRes, mpAttentionRes, assistanceRes])
		if (result.error) throw result.error;

	const subscriptionsByBusinessId = new Map(
		(subscriptionsRes.data ?? []).map((subscription) => [
			subscription.business_id,
			subscription
		])
	);
	const membershipsByBusinessId = new Map<string, (NonNullable<typeof membershipsRes.data>[number] & { email: string | null })[]>();
	for (const membership of membershipsRes.data ?? []) {
		const businessId = String(membership.business_id);
		const list = membershipsByBusinessId.get(businessId) ?? [];
		list.push({
			...membership,
			email: emailsByUserId.get(String(membership.user_id)) ?? null
		});
		membershipsByBusinessId.set(businessId, list);
	}

	const grantsByBusinessId = new Map<string, NonNullable<typeof grantsRes.data>>();
	for (const grant of grantsRes.data ?? []) {
		const businessId = String(grant.business_id);
		const list = grantsByBusinessId.get(businessId) ?? [];
		list.push(grant);
		grantsByBusinessId.set(businessId, list);
	}

	const mpSubsByBusinessId = new Map<string, MpSubscriptionRow[]>();
	for (const sub of mpSubsRes.data ?? []) {
		const businessId = String(sub.business_id);
		const list = mpSubsByBusinessId.get(businessId) ?? [];
		list.push(sub);
		mpSubsByBusinessId.set(businessId, list);
	}

	const normalizedMasterEmail = masterEmail.trim().toLowerCase();
	const isProtectedEmail = (value?: string | null) => {
		const email = String(value ?? '').trim().toLowerCase();
		return Boolean(email && (email === normalizedMasterEmail || isMasterEmail(email)));
	};

	const businesses = (businessesRes.data ?? []).map((business) => {
		const subscription = subscriptionsByBusinessId.get(String(business.id)) ?? null;
		const access = getBusinessAccessState(subscription, { businessCreatedAt: business.created_at });
		const members = membershipsByBusinessId.get(String(business.id)) ?? [];
		const owners = members.filter((member) => member.role === 'owner');
		return {
			...business,
			subscription,
			access,
			members,
			owners,
			primaryOwnerEmail: owners[0]?.email ?? members[0]?.email ?? null,
			recentGrants: grantsByBusinessId.get(String(business.id)) ?? [],
			mpSubscription: pickRelevantMpSubscription(
				mpSubsByBusinessId.get(String(business.id)) ?? []
			)
		};
	}).filter((business) => {
		const ownerEmails = (business.owners ?? [])
			.map((owner) => String(owner.email ?? '').toLowerCase())
			.filter(Boolean);
		if (isProtectedEmail(business.email)) return false;
		return !ownerEmails.some((email: string) => isProtectedEmail(email));
	});

	const businessNameById = new Map(
		businesses.map((business) => [String(business.id), String(business.name ?? '')])
	);
	const assistance = (assistanceRes.data ?? [])
		.filter((grant) => businessNameById.has(String(grant.business_id)))
		.map((grant) => {
			const business = Array.isArray(grant.business) ? grant.business[0] : grant.business;
			return {
				id: String(grant.id),
				businessId: String(grant.business_id),
				businessName: String(business?.name ?? businessNameById.get(String(grant.business_id)) ?? 'Consultorio'),
				businessSlug: String(business?.slug ?? ''),
				requestedByEmail: emailsByUserId.get(String(grant.requested_by_user_id)) ?? null,
				supportUserId: String(grant.support_user_id),
				startsAt: String(grant.starts_at ?? ''),
				expiresAt: String(grant.expires_at ?? '')
			};
		});
	// Solo eventos de negocios visibles en el panel (o globales, sin negocio):
	// los negocios filtrados por protección no deben filtrarse por acá.
	const mpAttention = (mpAttentionRes.data ?? [])
		.filter((event) => !event.business_id || businessNameById.has(String(event.business_id)))
		.map((event) => ({
			...event,
			businessName: event.business_id
				? businessNameById.get(String(event.business_id)) ?? null
				: null
		}));

	return {
		emails: (emailsRes.data ?? []).filter((item) => !isProtectedEmail(String(item.email ?? ''))),
		businesses,
		statuses: COMMERCIAL_STATUSES,
		assistance,
		mpAttention
	};
};

export const load: PageServerLoad = async ({ locals, fetch }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const master = ensureMaster(locals);
	const admin = await createSupabaseAdminClient('odonto', fetch);

	try {
		return {
			...(await buildMasterData(admin, master.email)),
			masterEmail: master.email,
			loadError: null
		};
	} catch (error) {
		logServerFailure('Error cargando panel maestro', error);
		return {
			emails: [],
			businesses: [],
			statuses: COMMERCIAL_STATUSES,
			assistance: [],
			mpAttention: [],
			masterEmail: master.email,
			loadError: 'No se pudo cargar el panel maestro. Revisá la conexión y las migraciones.'
		};
	}
};

export const actions: Actions = {
	enter_assisted_business: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals);
		const form = await request.formData();
		const grantId = String(form.get('grant_id') ?? '').trim();
		const businessId = String(form.get('business_id') ?? '').trim();
		if (!grantId || !businessId) {
			return fail(400, { message: 'Faltan datos para abrir el consultorio.' });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		const masterUserId = master.userId;

		const { data: grant, error } = await admin
			.from('account_assistance_grants')
			.select('id, business_id, support_user_id, status, expires_at, revoked_at')
			.eq('id', grantId)
			.eq('business_id', businessId)
			.maybeSingle();
		if (error) {
			logServerFailure('Error validando ayuda para configurar desde panel maestro', error);
			return fail(500, { message: 'No pudimos validar la ayuda.' });
		}
		if (
			!grant ||
			String(grant.support_user_id) !== masterUserId ||
			String(grant.status) !== 'active' ||
			grant.revoked_at ||
			new Date(String(grant.expires_at)).getTime() <= Date.now()
		) {
			return fail(403, { message: 'Esta ayuda ya no está activa.' });
		}

		const { data: canUseRows, error: canUseError } = await admin.rpc('business_allows_operation', {
			target_business_id: businessId
		});
		if (canUseError) {
			logServerFailure('Error validando estado del consultorio para ayuda', canUseError);
			return fail(500, { message: 'No pudimos validar el estado del consultorio.' });
		}
		if (canUseRows !== true) {
			return fail(409, { message: 'La cuenta debe estar activa para abrir su configuración.' });
		}

		cookies.set(ACTIVE_BUSINESS_COOKIE, businessId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60
		});

		throw redirect(303, '/odonto/configuracion/usuarios');
	},
	create_business: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const ownerEmail = normalizeEmail(form.get('owner_email'));
		const durationKey = String(form.get('duration') ?? '').trim();
		const note = String(form.get('note') ?? '').trim() || null;
		const duration = DURATION_SECONDS[durationKey] ?? null;

		if (!name) return fail(400, { message: 'Ingresá el nombre del consultorio.' });
		if (!EMAIL_FORMAT_REGEX.test(ownerEmail)) {
			return fail(400, { message: 'Ingresá un correo owner válido.' });
		}
		if (isMasterEmail(ownerEmail)) {
			return fail(403, { message: 'El email maestro no se puede usar como owner operativo.' });
		}
		if (!duration) {
			return fail(400, { message: 'Elegí la duración inicial del consultorio.' });
		}

		// The access email, the practice, its owner and its initial access are written in
		// one transaction, and the database keeps one practice per email.
		const admin = await createSupabaseAdminClient('odonto', fetch);
		const { data, error } = await admin.rpc('create_business_with_owner', {
			p_name: name,
			p_slug_base: normalizeSlug(name) || 'consultorio',
			p_owner_email: ownerEmail,
			p_duration_seconds: duration.seconds,
			p_duration_unit: duration.unit,
			p_is_permanent: durationKey === 'permanent',
			p_note: note,
			p_access_note: note ?? `Consultorio creado con acceso inicial: ${duration.label}.`,
			p_admin_id: master.userId,
			p_admin_email: master.email,
			p_idempotency_key: randomUUID()
		});
		if (error) {
			logServerFailure('Error creando consultorio', error);
			return fail(businessEmailAssociationErrorStatus(error, 503), {
				message: businessEmailAssociationErrorMessage(error, UNCONFIRMED_BUSINESS_CREATION)
			});
		}
		let created: ReturnType<typeof readCreatedBusiness>;
		try {
			created = readCreatedBusiness(data);
		} catch (contractError) {
			logServerFailure('Respuesta inválida al crear el consultorio', contractError);
			return fail(503, { message: UNCONFIRMED_BUSINESS_CREATION });
		}

		return {
			success: true,
			message: created.ownerLinked
				? `Consultorio creado y owner vinculado. Acceso inicial: ${duration.label}.`
				: `Consultorio creado con owner pendiente. Acceso inicial: ${duration.label}. Cuando el owner ingrese, se vinculará automáticamente.`
		};
	},
	add_email: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals);
		const form = await request.formData();
		const email = normalizeEmail(form.get('email'));
		const onboardingModeRaw = String(form.get('onboarding_mode') ?? 'manual').trim();
		const onboardingMode = isOnboardingMode(onboardingModeRaw) ? onboardingModeRaw : null;
		const note = String(form.get('note') ?? '').trim() || null;

		if (!EMAIL_FORMAT_REGEX.test(email)) {
			return fail(400, { message: 'Ingresá un correo electrónico válido.', email });
		}
		if (isMasterEmail(email)) {
			return fail(403, { message: 'El email maestro no se gestiona desde este panel.' });
		}
		if (!onboardingMode) {
			return fail(400, { message: 'Elegí si el alta es manual o con autopago.', email });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		const { data: existingEmail, error: existingError } = await admin
			.from('allowed_emails')
			.select('id')
			.eq('email', email)
			.maybeSingle();

		if (existingError) {
			logServerFailure('Error buscando email habilitado', existingError);
			return fail(500, { message: 'No pudimos validar el correo electrónico.', email });
		}

		const { error } = existingEmail
			? await admin
					.from('allowed_emails')
					.update({
						enabled: true,
						onboarding_mode: onboardingMode,
						note,
						disabled_at: null,
						disabled_reason: null,
						updated_by: master.userId
					})
					.eq('id', existingEmail.id)
			: await admin.from('allowed_emails').insert({
					email,
					enabled: true,
					onboarding_mode: onboardingMode,
					note,
					disabled_at: null,
					disabled_reason: null,
					updated_by: master.userId,
					created_by: master.userId
				});

		if (error) {
			logServerFailure('Error guardando email habilitado', error);
			return fail(500, { message: 'No pudimos guardar el correo electrónico.', email });
		}

		return {
			success: true,
			message:
				onboardingMode === 'self_service'
					? 'Correo guardado como referencia histórica de autopago.'
					: 'Correo guardado como referencia manual.'
		};
	},
	toggle_email: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals);
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const enabled = String(form.get('enabled') ?? '') === 'true';
		const reason = String(form.get('reason') ?? '').trim() || null;

		if (!id) return fail(400, { message: 'Correo electrónico inválido.' });

		const admin = await createSupabaseAdminClient('odonto', fetch);
		const { data: existingEmail, error: existingError } = await admin
			.from('allowed_emails')
			.select('email')
			.eq('id', id)
			.maybeSingle();
		if (existingError) {
			logServerFailure('Error validando email para cambio de estado', existingError);
			return fail(500, { message: 'No pudimos validar el correo electrónico.' });
		}
		if (!existingEmail) return fail(404, { message: 'Correo electrónico no encontrado.' });
		if (isMasterEmail(String(existingEmail.email ?? ''))) {
			return fail(403, { message: 'El email maestro no puede deshabilitarse.' });
		}

		const { error } = await admin
			.from('allowed_emails')
			.update({
				enabled,
				disabled_at: enabled ? null : new Date().toISOString(),
				disabled_reason: enabled ? null : reason,
				updated_by: master.userId
			})
			.eq('id', id);

		if (error) {
			logServerFailure('Error actualizando email', error);
			return fail(500, { message: 'No pudimos actualizar el correo electrónico.' });
		}

		return {
			success: true,
			message: enabled ? 'Referencia de email restaurada.' : 'Referencia de email desactivada.'
		};
	},
	adjust_business_access: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals);
		const form = await request.formData();
		const businessId = String(form.get('business_id') ?? '').trim();
		const operation = String(form.get('operation') ?? '').trim();
		const durationKey = String(form.get('duration') ?? '').trim();
		const source = String(form.get('source') ?? 'manual').trim() || 'manual';
		const note = String(form.get('note') ?? '').trim() || null;
		const amountRaw = String(form.get('amount') ?? '').trim();
		const amount = parseMoneyInteger(amountRaw);
		const duration = DURATION_SECONDS[durationKey] ?? null;
		const idempotencyKey = String(form.get('idempotency_key') ?? '').trim() || randomUUID();

		if (!businessId) return fail(400, { message: 'Consultorio inválido.' });
		if (!BUSINESS_ACCESS_OPERATIONS.some(allowed => allowed === operation)) {
			return fail(400, { message: 'Operación inválida.' });
		}
		if (!duration && !['disable_business_access', 'enable_business_access', 'archive_business', 'payment_cancelled', 'unset_permanent'].includes(operation)) {
			return fail(400, { message: 'Duración inválida.' });
		}
		if (amountRaw && amount === null) {
			return fail(400, { message: 'Monto inválido.' });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		if (await businessHasMasterOwner(admin, businessId, master.userId, master.email)) {
			return fail(403, { message: 'El consultorio interno del email maestro no se gestiona desde este panel.' });
		}

		const { error } = await admin.rpc('grant_business_access', {
			p_business_id: businessId,
			p_operation: operation,
			p_duration_seconds: duration?.seconds ?? null,
			p_duration_unit: duration?.unit ?? null,
			p_is_permanent: durationKey === 'permanent' || operation === 'set_permanent',
			p_amount: amount,
			p_source: source,
			p_note: note ?? defaultManualAccessNote(operation),
			p_admin_id: master.userId,
			p_admin_email: master.email,
			p_idempotency_key: idempotencyKey
		});

		if (error) {
			logServerFailure('Error ajustando acceso comercial', error);
			const raw = error.message?.toLowerCase() ?? '';
			if (raw.includes('permanent')) {
				return fail(400, { message: 'La operación no es válida para una cuenta permanente.' });
			}
			if (raw.includes('idempotency')) {
				return fail(409, { message: 'La operación ya fue procesada o la clave se reutilizó con otros datos.' });
			}
			return fail(500, { message: 'No pudimos ajustar el acceso comercial.' });
		}

		const successMessage = (() => {
			if (operation === 'extend_access' || operation === 'grant_access') {
				return `Listo: se sumó ${duration?.label ?? 'tiempo'} de acceso.`;
			}
			if (operation === 'reduce_access') {
				return `Listo: se quitó ${duration?.label ?? 'tiempo'} del acceso.`;
			}
			if (operation === 'set_permanent') return 'Listo: el acceso ahora es permanente.';
			if (operation === 'unset_permanent') return 'Listo: se quitó el acceso permanente.';
			if (operation === 'disable_business_access') return 'Acceso pausado.';
			if (operation === 'enable_business_access') return 'Acceso reanudado.';
			if (operation === 'archive_business') return 'Consultorio archivado.';
			if (operation === 'reactivate_business') return 'Consultorio reactivado.';
			return 'Acceso comercial actualizado.';
		})();

		return { success: true, message: successMessage };
	},
	revoke_business_sessions: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals);
		const form = await request.formData();
		const businessId = String(form.get('business_id') ?? '').trim();
		if (!businessId) return fail(400, { message: 'Consultorio inválido.' });

		const admin = await createSupabaseAdminClient('odonto', fetch);
		if (await businessHasMasterOwner(admin, businessId, master.userId, master.email)) {
			return fail(403, { message: 'No se pueden cerrar sesiones del email maestro desde este panel.' });
		}

		const { data: members, error: membersError } = await admin
			.from('business_users')
			.select('user_id')
			.eq('business_id', businessId);
		if (membersError) {
			logServerFailure('Error cargando usuarios para cerrar sesiones', membersError);
			return fail(500, { message: 'No pudimos cargar los usuarios del consultorio.' });
		}

		let revoked = 0;
		for (const member of members ?? []) {
			if (!member.user_id) continue;
			const { error } = await admin.auth.admin.signOut(member.user_id);
			if (error) {
				logServerFailure('Error cerrando sesión de usuario', error);
				continue;
			}
			revoked += 1;
		}

		await admin.from('access_grants').insert({
			business_id: businessId,
			operation: 'sessions_revoked',
			source: 'internal',
			note: `Sesiones cerradas: ${revoked}`,
			admin_id: master.userId,
			admin_email: master.email,
			idempotency_key: randomUUID()
		});

		return { success: true, message: `Sesiones cerradas: ${revoked}.` };
	},
	mp_cancel_subscription: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		ensureMaster(locals);
		const form = await request.formData();
		const businessId = String(form.get('business_id') ?? '').trim();
		const preapprovalId = String(form.get('preapproval_id') ?? '').trim();
		if (!businessId || !preapprovalId) {
			return fail(400, { message: 'Faltan datos de la suscripción a cancelar.' });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		// La suscripción tiene que pertenecer al negocio indicado.
		const { data: owned, error: ownedError } = await admin
			.from('mp_subscriptions')
			.select('preapproval_id')
			.eq('preapproval_id', preapprovalId)
			.eq('business_id', businessId)
			.maybeSingle();
		if (ownedError) {
			logServerFailure('Error verificando suscripción MP a cancelar', ownedError);
			return fail(500, { message: 'No se pudo verificar la suscripción.' });
		}
		if (!owned) {
			return fail(404, { message: 'La suscripción no corresponde a ese consultorio.' });
		}

		// Se asienta cualquier cobro aprobado sin registrar antes de cancelar:
		// una vez cancelada la fila sale del filtro de conciliación. Si el barrido
		// falla, la cancelación sigue y queda un evento que requiere atención.
		await settleApprovedChargesForPreapproval(admin, fetch, businessId, preapprovalId);

		let cancelled;
		try {
			cancelled = await cancelPreapproval(fetch, preapprovalId);
		} catch (error) {
			logServerFailure('Error cancelando suscripción MP desde maestro', error);
			return fail(502, { message: 'Mercado Pago no respondió. Probá de nuevo en unos minutos.' });
		}
		if (!cancelled.ok) {
			logServerFailure('MP rechazó la cancelación desde maestro', { status: cancelled.status });
			return fail(502, { message: 'Mercado Pago no aceptó la cancelación.' });
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
			logServerFailure('No se pudo sincronizar la suscripción cancelada', updateError);
		}

		return {
			success: true,
			message: 'Suscripción de Mercado Pago cancelada: no se generarán más cobros. El acceso vigente no se modificó.'
		};
	},
	mp_reconcile_now: async ({ locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		ensureMaster(locals);

		const admin = await createSupabaseAdminClient('odonto', fetch);
		let summary;
		try {
			summary = await reconcileMercadoPago(admin, fetch, { limit: 20 });
		} catch (error) {
			logServerFailure('Error corriendo conciliación manual', error);
			return fail(500, { message: 'La conciliación falló. Revisá los logs.' });
		}

		return {
			success: true,
			message: `Conciliación: ${summary.scanned} suscripciones revisadas, ${summary.credited} pagos acreditados, ${summary.attention} para revisar, ${summary.errors} errores.`
		};
	}
};
