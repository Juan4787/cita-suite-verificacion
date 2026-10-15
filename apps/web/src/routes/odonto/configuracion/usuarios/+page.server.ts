import {
	BUSINESS_ROLES,
	demoBusinessContext,
	isBusinessRole,
	resolveActiveBusiness,
	type BusinessRole
} from '$lib/server/business';
import {
	findProfessionalByEmail,
	humanProfessionalEmailConflict,
	normalizeProfessionalEmail
} from '$lib/server/professionals';
import {
	DEFAULT_SERVICE_NAMES,
	ensureDefaultServicesAssigned,
	isDefaultServiceName
} from '$lib/server/default-services';
import {
	replaceProfessionalScheduleBlocks
} from '$lib/server/availability-rules';
import { parseAvailabilityExceptionInterval } from '$lib/server/availability-exceptions';
import { setProfessionalServices } from '$lib/server/professional-services';
import { writeAuditLog } from '$lib/server/audit';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId
} from '$lib/server/supabase';
import {
	businessEmailAssociationErrorStatus,
	EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS_MESSAGE,
	isEmailAlreadyAssociatedWithOtherBusinessError
} from '$lib/server/business-email-association';
import { formatPriceLabel } from '$lib/utils/money-input';
import {
	canAssignTeamRole,
	canConfigureAttendingProfile,
	roleSupportsProfessionalProfile,
	shouldConfigureProfessionalProfile
} from '$lib/utils/team-permissions';
import {
	parseScheduleBlocksJson,
	validateScheduleBlocks,
	type NormalizedScheduleBlock,
	type ScheduleBlockDraft
} from '$lib/utils/schedule-blocks';
import { env } from '$env/dynamic/private';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';

type RoleAccessStatus = 'active' | 'pending';

type BusinessRoleAccess = {
	id: string;
	business_id: string;
	user_id: string | null;
	email: string;
	role: BusinessRole;
	status: RoleAccessStatus;
	professional_id: string | null;
	created_at: string;
};

type ServiceOption = {
	id: string;
	name: string;
	duration_minutes: number;
	price_label: string | null;
	is_default: boolean;
};

const DEMO_MEMBERS: BusinessRoleAccess[] = [
	{
		id: 'demo-owner',
		business_id: 'demo-business',
		user_id: 'demo-user',
		email: 'dueno@consultorio.demo',
		role: 'owner',
		status: 'active',
		professional_id: null,
		created_at: new Date('2026-01-01T12:00:00Z').toISOString()
	},
	{
		id: 'demo-reception',
		business_id: 'demo-business',
		user_id: 'demo-reception-user',
		email: 'recepcion@consultorio.demo',
		role: 'reception',
		status: 'active',
		professional_id: null,
		created_at: new Date('2026-01-02T12:00:00Z').toISOString()
	}
];

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_SERVICE_DURATION_MINUTES = 5;
const MAX_SERVICE_DURATION_MINUTES = 480;

// Roles que se ofrecen al agregar un integrante desde Equipo.
const TEAM_ROLES = BUSINESS_ROLES.filter((role) => role !== 'readonly');

const normalizeEmail = (value: FormDataEntryValue | null) =>
	String(value ?? '')
		.trim()
		.toLowerCase();

const normalizeAccess = (row: any): BusinessRoleAccess | null => {
	const role = String(row?.role ?? '');
	const status = String(row?.status ?? '');
	if (!row?.id || !row?.business_id || !row?.email || !isBusinessRole(role)) return null;
	if (status !== 'active' && status !== 'pending') return null;
	return {
		id: String(row.id),
		business_id: String(row.business_id),
		user_id: row.user_id ? String(row.user_id) : null,
		email: String(row.email),
		role,
		status,
		professional_id: row.professional_id ? String(row.professional_id) : null,
		created_at: String(row.created_at ?? '')
	};
};

const listRoleAccess = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<BusinessRoleAccess[]> => {
	const { data, error } = await supabase.rpc('list_business_role_access', {
		target_business_id: businessId
	});
	if (error) throw error;
	return ((data ?? []) as unknown[])
		.map(normalizeAccess)
		.filter((item): item is BusinessRoleAccess => Boolean(item));
};

const listServices = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<ServiceOption[]> => {
	const { data, error } = await supabase
		.from('services')
		.select('id, name, duration_minutes, price_label, is_active')
		.eq('business_id', businessId)
		.eq('is_active', true)
		.order('sort_order')
		.order('name');
	if (error) throw error;
	return ((data ?? []) as any[]).map((item) => ({
		id: String(item.id),
		name: String(item.name ?? ''),
		duration_minutes: Number(item.duration_minutes ?? 0),
		price_label: item.price_label ? String(item.price_label) : null,
		is_default: isDefaultServiceName(String(item.name ?? ''))
	}));
};

const getUsersPageContext = async ({
	locals,
	fetch,
	cookies
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: import('@sveltejs/kit').Cookies;
}) => {
	if (!locals.auth) throw redirect(303, '/login');

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const [context, currentUserId] = await Promise.all([
		resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies
		}),
		getAuthUserId(supabase, locals.auth.access_token)
	]);

	if (!context) {
		throw kitError(500, 'No se pudo resolver el negocio activo');
	}

	return { supabase, context, currentUserId };
};

const countOwners = (members: BusinessRoleAccess[]) =>
	members.filter((member) => member.status === 'active' && member.role === 'owner').length;

const roleAccessErrorMessage = (error: { code?: string; message?: string } | null | undefined) => {
	const raw = error?.message ?? '';
	if (isEmailAlreadyAssociatedWithOtherBusinessError(error)) {
		return EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS_MESSAGE;
	}
	if (raw.includes('BUSINESS_MANAGE_DENIED')) return 'No tenés permisos para administrar el equipo.';
	if (raw.includes('INVALID_EMAIL')) return 'Ingresá un email válido.';
	if (raw.includes('INVALID_ROLE')) return 'El rol seleccionado no es válido.';
	if (raw.includes('PROFESSIONAL_REQUIRED')) return 'Completá los datos del profesional.';
	if (raw.includes('PROFESSIONAL_ROLE_NOT_SUPPORTED')) {
		return 'Solo un profesional, administrador o dueño puede tener perfil profesional.';
	}
	if (raw.includes('PROFESSIONAL_NOT_FOUND')) return 'No se encontró el profesional asociado.';
	if (raw.includes('BUSINESS_USER_NOT_FOUND') || raw.includes('BUSINESS_INVITE_NOT_FOUND')) {
		return 'El acceso del equipo cambió. Recargá la lista y volvé a intentar.';
	}
	if (raw.includes('PROFESSIONAL_ALREADY_LINKED_TO_USER')) {
		return 'Ese profesional ya está vinculado a otro usuario.';
	}
	if (raw.includes('PROFESSIONAL_EMAIL_ALREADY_EXISTS')) {
		return 'Ese correo ya está cargado en otro profesional.';
	}
	if (error?.code === '42P10' || raw.includes('no unique or exclusion constraint matching the on conflict')) {
		return 'Falta aplicar la migración de roles en la base de datos.';
	}
	if (raw.includes('ADMIN_OWNER_ACTION_DENIED')) return 'Un administrador no puede modificar dueños ni otros administradores.';
	if (raw.includes('LAST_OWNER_BLOCKED')) return 'El consultorio debe conservar al menos un dueño.';
	if (raw.includes('SELF_REMOVE_DENIED')) return 'No podés quitar tu propio rol desde esta pantalla.';
	return 'No se pudo guardar el rol.';
};

const roleAccessErrorStatus = (error: { code?: string; message?: string } | null | undefined) => {
	const raw = error?.message ?? '';
	if (raw.includes('BUSINESS_USER_NOT_FOUND') || raw.includes('BUSINESS_INVITE_NOT_FOUND')) return 409;
	return businessEmailAssociationErrorStatus(error);
};

const roleLabel = (role: BusinessRole) => {
	const labels: Record<BusinessRole, string> = {
		owner: 'Dueño',
		admin: 'Administrador',
		reception: 'Recepción',
		professional: 'Profesional',
		readonly: 'Solo lectura'
	};
	return labels[role];
};

const findAuthUserIdByEmail = async (admin: SupabaseClient, email: string) => {
	for (let page = 1; page <= 20; page += 1) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw error;
		const user = data.users.find((item) => item.email?.trim().toLowerCase() === email);
		if (user?.id) return user.id;
		if (data.users.length < 1000) return null;
	}
	return null;
};

const saveRoleAccessDirect = async ({
	admin,
	businessId,
	email,
	role,
	professionalId,
	actorId,
	actorRole,
	isAssisting,
	currentAccess
}: {
	admin: SupabaseClient;
	businessId: string;
	email: string;
	role: BusinessRole;
	professionalId: string | null;
	actorId: string | null;
	actorRole: BusinessRole;
	isAssisting: boolean;
	currentAccess: BusinessRoleAccess[];
}) => {
	if (!actorId) throw new Error('AUTH_REQUIRED');
	if (!canAssignTeamRole({ actorRole, targetRole: role, isAssisting })) {
		throw new Error('ADMIN_OWNER_ACTION_DENIED');
	}
	const currentEmailAccess = currentAccess.find(
		(item) => item.email.toLowerCase() === email.toLowerCase()
	);
	const effectiveProfessionalId =
		professionalId ??
		(roleSupportsProfessionalProfile(role) ? currentEmailAccess?.professional_id ?? null : null);
	if (role === 'professional' && !effectiveProfessionalId) {
		throw new Error('PROFESSIONAL_REQUIRED');
	}
	if (effectiveProfessionalId && !roleSupportsProfessionalProfile(role)) {
		throw new Error('PROFESSIONAL_ROLE_NOT_SUPPORTED');
	}

	const targetUserId = await findAuthUserIdByEmail(admin, email);

	if (effectiveProfessionalId) {
		const { data: linkedRows, error: linkedError } = await admin
			.from('professional_users')
			.select('id, user_id')
			.eq('business_id', businessId)
			.eq('professional_id', effectiveProfessionalId)
			.limit(10);
		if (linkedError) throw linkedError;
		if ((linkedRows ?? []).some((row: any) => !targetUserId || String(row.user_id) !== targetUserId)) {
			throw new Error('PROFESSIONAL_ALREADY_LINKED_TO_USER');
		}
	}

	if (targetUserId) {
		const existing = currentAccess.find(
			(item) => item.status === 'active' && item.user_id === targetUserId
		);
		if (actorRole === 'admin' && existing?.role && (existing.role === 'owner' || existing.role === 'admin')) {
			throw new Error('ADMIN_OWNER_ACTION_DENIED');
		}
		if (existing?.role === 'owner' && role !== 'owner' && countOwners(currentAccess) <= 1) {
			throw new Error('LAST_OWNER_BLOCKED');
		}

		if (existing) {
			const { data: updatedMembership, error } = await admin
				.from('business_users')
				.update({
					role,
					status: 'active',
					disabled_at: null,
					disabled_reason: null,
					updated_by: actorId,
					updated_at: new Date().toISOString()
				})
				.eq('id', existing.id)
				.eq('business_id', businessId)
				.select('id')
				.maybeSingle();
			if (error) throw error;
			if (!updatedMembership) throw new Error('BUSINESS_USER_NOT_FOUND');
		} else {
			const { error } = await admin.from('business_users').insert({
				business_id: businessId,
				user_id: targetUserId,
				role,
				status: 'active',
				accepted_at: new Date().toISOString(),
				created_by: actorId,
				updated_by: actorId
			});
			if (error) throw error;
		}

		if (effectiveProfessionalId) {
			const deleteByUser = await admin
				.from('professional_users')
				.delete()
				.eq('business_id', businessId)
				.eq('user_id', targetUserId);
			if (deleteByUser.error) throw deleteByUser.error;
			const deleteByProfessional = await admin
				.from('professional_users')
				.delete()
				.eq('business_id', businessId)
				.eq('professional_id', effectiveProfessionalId);
			if (deleteByProfessional.error) throw deleteByProfessional.error;
			const { error } = await admin.from('professional_users').insert({
				business_id: businessId,
				professional_id: effectiveProfessionalId,
				user_id: targetUserId
			});
			if (error) throw error;
		} else {
			const { error } = await admin
				.from('professional_users')
				.delete()
				.eq('business_id', businessId)
				.eq('user_id', targetUserId);
			if (error) throw error;
		}

		const { error: inviteError } = await admin
			.from('business_user_invites')
			.update({
				status: 'accepted',
				accepted_user_id: targetUserId,
				accepted_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			})
			.eq('business_id', businessId)
			.ilike('email', email)
			.eq('status', 'pending');
		if (inviteError) throw inviteError;

		return {
			status:
				existing?.role === role && existing.professional_id === effectiveProfessionalId
					? 'already_active'
					: 'active'
		};
	}

	const existingPending = currentAccess.find(
		(item) => item.status === 'pending' && item.email.toLowerCase() === email
	);
	if (existingPending) {
		const { data: updatedInvite, error } = await admin
			.from('business_user_invites')
			.update({
				role,
				professional_id: effectiveProfessionalId,
				invited_by: actorId,
				updated_at: new Date().toISOString()
			})
			.eq('id', existingPending.id)
			.eq('business_id', businessId)
			.select('id')
			.maybeSingle();
		if (error) throw error;
		if (!updatedInvite) throw new Error('BUSINESS_INVITE_NOT_FOUND');
		return {
			status:
				existingPending.role === role &&
				existingPending.professional_id === effectiveProfessionalId
					? 'already_pending'
					: 'pending'
		};
	}

	const { error } = await admin.from('business_user_invites').insert({
		business_id: businessId,
		email,
		role,
		professional_id: effectiveProfessionalId,
		invited_by: actorId
	});
	if (error) throw error;
	return { status: 'pending' };
};

type NewServiceInput = {
	name: string;
	duration_minutes: number;
	price_label: string | null;
};

const parseNewServices = (raw: string): NewServiceInput[] => {
	if (!raw.trim()) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('INVALID_NEW_SERVICES');
	}
	if (!Array.isArray(parsed)) throw new Error('INVALID_NEW_SERVICES');
	return parsed.map((item: any) => {
		const name = String(item?.name ?? '').trim();
		const duration = Number(item?.duration_minutes ?? 0);
		if (!name) throw new Error('NEW_SERVICE_NAME_REQUIRED');
		if (
			!Number.isInteger(duration) ||
			duration < MIN_SERVICE_DURATION_MINUTES ||
			duration > MAX_SERVICE_DURATION_MINUTES
		) {
			throw new Error('NEW_SERVICE_DURATION_INVALID');
		}
		return {
			name,
			duration_minutes: duration,
			price_label: formatPriceLabel(String(item?.price_label ?? '')) || null
		};
	});
};

const scheduleBlocksFromForm = (
	form: FormData
):
	| { ok: true; blocks: NormalizedScheduleBlock[] }
	| { ok: false; message: string } => {
	const rawBlocks = String(form.get('schedule_blocks') ?? '').trim();
	let draftBlocks: ScheduleBlockDraft[] | null = rawBlocks ? parseScheduleBlocksJson(rawBlocks) : null;
	if (rawBlocks && !draftBlocks) {
		return { ok: false, message: 'Los bloques horarios no son válidos.' };
	}
	if (!draftBlocks) {
		draftBlocks = [
			{
				weekdays: form
					.getAll('weekdays')
					.map((value) => Number(value))
					.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
				timeRanges: String(form.get('time_ranges') ?? ''),
				slotInterval: String(form.get('break_minutes') ?? 15),
				gridInterval: String(form.get('slot_interval_minutes') ?? 15)
			}
		];
	}
	const result = validateScheduleBlocks(draftBlocks);
	if (!result.ok) return { ok: false, message: result.message };
	return { ok: true, blocks: result.blocks };
};

export const load: PageServerLoad = async ({ locals, fetch, cookies, depends }) => {
	depends('app:team');
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			members: DEMO_MEMBERS,
			services: [],
			roles: TEAM_ROLES,
			defaultServiceNames: DEFAULT_SERVICE_NAMES,
			currentUserId: 'demo-user',
			demo: true
		};
	}

	const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role !== 'owner' && context.role !== 'admin') throw redirect(303, '/odonto/agenda');
	const [members, services] = await Promise.all([
		listRoleAccess(supabase, context.business.id),
		listServices(supabase, context.business.id)
	]);

	return {
		context,
		members,
		services,
		roles: context.assistance ? TEAM_ROLES.filter((role) => role !== 'owner') : TEAM_ROLES,
		defaultServiceNames: DEFAULT_SERVICE_NAMES,
		currentUserId,
		demo: false
	};
};

export const actions: Actions = {
	add_user: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const values = Object.fromEntries(form);
		const email = normalizeEmail(form.get('email'));
		const role = String(form.get('role') ?? '').trim();
		const requestedProfessionalProfile = form.get('has_professional_profile') === 'true';

		if (!EMAIL_FORMAT_REGEX.test(email)) {
			return fail(400, { message: 'Ingresá un email válido.', values });
		}
		if (!isBusinessRole(role)) {
			return fail(400, { message: 'El rol seleccionado no es válido.', values });
		}
		if (requestedProfessionalProfile && !roleSupportsProfessionalProfile(role)) {
			return fail(400, {
				message: 'Solo un profesional, administrador o dueño puede tener perfil profesional.',
				values
			});
		}
		const configureProfessionalProfile = shouldConfigureProfessionalProfile({
			role,
			requested: requestedProfessionalProfile
		});

		const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
			if (!context.canManage) {
				return fail(403, { message: 'No tenés permisos para administrar el equipo.', values });
			}
			if (context.assistance && role === 'owner') {
				return fail(403, {
					message: 'La propiedad del consultorio solo puede administrarla su dueño.',
					values
				});
			}

			const currentAccess = await listRoleAccess(supabase, context.business.id);
		const existing = currentAccess.find((item) => item.email.toLowerCase() === email);
		if (existing?.role === role) {
			return fail(400, {
				message: `Ese correo ya está asignado al rol ${roleLabel(role)}.`,
				values
			});
		}

		const businessId = context.business.id;
		let professionalId: string | null = null;
		let createdProfessionalId: string | null = null;
		const createdServiceIds: string[] = [];

		if (configureProfessionalProfile) {
			const professionalName = String(form.get('professional_name') ?? '').trim();
			const specialty = String(form.get('professional_specialty') ?? '').trim();
			if (!professionalName) {
				return fail(400, { message: 'Completá el nombre del profesional para continuar.', values });
			}

			// Servicios: personalizados existentes seleccionados + nuevos creados en el wizard.
			const selectedServiceIds = form
				.getAll('service_ids')
				.map((value) => String(value).trim())
				.filter(Boolean);
			let newServices: NewServiceInput[];
			try {
				newServices = parseNewServices(String(form.get('new_services') ?? ''));
			} catch (error) {
				const code = (error as Error)?.message ?? '';
				if (code === 'NEW_SERVICE_NAME_REQUIRED') {
					return fail(400, { message: 'No se puede crear un servicio adicional sin nombre.', values });
				}
				if (code === 'NEW_SERVICE_DURATION_INVALID') {
					return fail(400, { message: 'La duración del servicio debe estar entre 5 y 480 minutos.', values });
				}
				return fail(400, { message: 'Los servicios cargados no son válidos.', values });
			}

			// Horarios de atención: obligatorios y separados por bloques de días.
			const scheduleBlocks = scheduleBlocksFromForm(form);
			if (!scheduleBlocks.ok) {
				return fail(400, { message: scheduleBlocks.message, values });
			}

			// Cambio puntual: opcional, pero si se carga debe ser válido.
			const exceptionPeriodMode = String(form.get('exception_period_mode') ?? 'single').trim();
			const exceptionDate = String(form.get('exception_date') ?? '').trim();
			const exceptionDateFrom = String(form.get('exception_date_from') ?? '').trim();
			const exceptionDateTo = String(form.get('exception_date_to') ?? '').trim();
			const exceptionTimeRange = String(form.get('exception_time_range') ?? '').trim();
			const exceptionAppliesTo = String(form.get('exception_applies_to') ?? 'professional').trim();
			const exceptionType = String(form.get('exception_type') ?? 'blocked').trim();
			const exceptionReason = String(form.get('exception_reason') ?? '').trim();
			const hasException =
				exceptionPeriodMode === 'range'
					? Boolean(exceptionDateFrom || exceptionDateTo)
					: Boolean(exceptionDate || exceptionTimeRange);
			let exceptionStartsAt: Date | null = null;
			let exceptionEndsAt: Date | null = null;
			if (hasException) {
				const interval = parseAvailabilityExceptionInterval({
					type: exceptionType,
					periodMode: exceptionPeriodMode,
					date: exceptionDate,
					dateFrom: exceptionDateFrom,
					dateTo: exceptionDateTo,
					timeRange: exceptionTimeRange,
					timeZone: context.business.timezone
				});
				if (!interval.ok) return fail(400, { message: interval.message, values });
				exceptionStartsAt = interval.startsAt;
				exceptionEndsAt = interval.endsAt;
			}

			const existingProfessional = await findProfessionalByEmail(
				supabase,
				businessId,
				normalizeProfessionalEmail(email)
			);
			if (existingProfessional) {
				return fail(400, { message: humanProfessionalEmailConflict(existingProfessional), values });
			}

			const professionalId = crypto.randomUUID();
			createdProfessionalId = professionalId;

			const { error: createError } = await supabase
				.from('professionals')
				.insert({
					id: professionalId,
					business_id: businessId,
					name: professionalName,
					specialty: specialty || null,
					email,
					is_active: true,
					// Se habilita para reservas sólo si la cuenta ya existe. Si queda una
					// invitación pendiente, la vinculación de la cuenta la publica automáticamente.
					is_public: false
				});
			if (createError) {
				console.error('Error creando profesional', createError);
				return fail(500, { message: 'No se pudo crear el profesional.', values });
			}

			const rollback = async (admin: SupabaseClient) => {
				// Borrar el profesional limpia en cascada asignaciones, reglas y excepciones.
				await admin.from('professionals').delete().eq('business_id', businessId).eq('id', createdProfessionalId);
				if (createdServiceIds.length > 0) {
					await admin.from('services').delete().eq('business_id', businessId).in('id', createdServiceIds);
				}
			};

			const admin = await createSupabaseAdminClient('odonto', fetch);
			try {
				// Consulta y Otro servicio: existen siempre y quedan asignados automáticamente.
				const defaultServiceIds = await ensureDefaultServicesAssigned(supabase, businessId, professionalId);

				for (const newService of newServices) {
					const serviceId = crypto.randomUUID();
					const { error: serviceError } = await supabase
						.from('services')
						.insert({
							id: serviceId,
							business_id: businessId,
							name: newService.name,
							duration_minutes: newService.duration_minutes,
							price_label: newService.price_label,
							description: null,
							buffer_before_minutes: 0,
							buffer_after_minutes: 0,
							is_public: true,
							is_active: true
						});
					if (serviceError) {
						throw serviceError;
					}
					createdServiceIds.push(serviceId);
				}

				await setProfessionalServices(supabase, businessId, professionalId, [
					...defaultServiceIds,
					...selectedServiceIds,
					...createdServiceIds
				]);

				await replaceProfessionalScheduleBlocks(supabase, {
					businessId,
					professionalId,
					blocks: scheduleBlocks.blocks
				});

				if (hasException && exceptionStartsAt && exceptionEndsAt) {
					const { error: exceptionError } = await supabase.from('availability_exceptions').insert({
						business_id: businessId,
						professional_id: exceptionAppliesTo === 'business' ? null : professionalId,
						type: exceptionType,
						starts_at: exceptionStartsAt.toISOString(),
						ends_at: exceptionEndsAt.toISOString(),
						reason: exceptionReason || null
					});
					if (exceptionError) throw exceptionError;
				}

				const result = await saveRoleAccessDirect({
					admin,
					businessId,
					email,
					role,
					professionalId,
					actorId: currentUserId,
					actorRole: context.role,
					isAssisting: Boolean(context.assistance),
					currentAccess
				});

				await writeAuditLog(supabase, {
					businessId,
					userId: currentUserId,
					action: 'professional.created',
					entityType: 'professional',
					entityId: professionalId,
					metadata: {
						name: professionalName,
						email,
						schedule_blocks: scheduleBlocks.blocks,
						service_ids: [...defaultServiceIds, ...selectedServiceIds, ...createdServiceIds]
					}
				});

				const status = String(result.status ?? '');
				if (status === 'pending' || status === 'already_pending') {
					return {
						success: true,
						openRole: role,
						message:
							`Perfil profesional configurado con rol ${roleLabel(role)}. No aparecerá en las reservas online hasta que la persona cree su cuenta con ${email}.`
					};
				}

				const { data: publishedProfessional, error: publishError } = await admin
					.from('professionals')
					.update({ is_public: true, updated_at: new Date().toISOString() })
					.eq('business_id', businessId)
					.eq('id', professionalId)
					.eq('is_active', true)
					.select('id')
					.maybeSingle();
				if (publishError) throw publishError;
				if (!publishedProfessional) throw new Error('PROFESSIONAL_NOT_FOUND');

				return {
					success: true,
					openRole: role,
					message: `Perfil profesional creado y rol ${roleLabel(role)} asignado al consultorio.`
				};
			} catch (error) {
				await rollback(admin);
				console.error('Error guardando alta de profesional', error);
				const code = (error as { message?: string })?.message ?? '';
				if (code === 'INVALID_SERVICE_ASSIGNMENT') {
					return fail(400, { message: 'Algún servicio seleccionado no pertenece a este consultorio.', values });
				}
				const roleError = error as { code?: string; message?: string };
				return fail(roleAccessErrorStatus(roleError), { message: roleAccessErrorMessage(roleError), values });
			}
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		let result: { status: string };
		try {
			result = await saveRoleAccessDirect({
				admin,
				businessId,
				email,
				role,
				professionalId,
				actorId: currentUserId,
				actorRole: context.role,
				isAssisting: Boolean(context.assistance),
				currentAccess
			});
		} catch (error) {
			console.error('Error guardando acceso al negocio', error);
			const roleError = error as { code?: string; message?: string };
			return fail(roleAccessErrorStatus(roleError), { message: roleAccessErrorMessage(roleError), values });
		}

		const status = String(result.status ?? '');
		if (status === 'already_active' || status === 'already_pending') {
			return { success: true, openRole: role, message: 'Ese correo ya tenía ese rol asignado.' };
		}
		if (status === 'pending') {
			return {
				success: true,
				openRole: role,
				message: 'Acceso preparado. Cuando la persona cree su cuenta con ese correo, el rol se asignará automáticamente.'
			};
		}

		return { success: true, openRole: role, message: 'Rol asignado al consultorio.' };
	},
	make_attending: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const targetAccessId = String(form.get('access_id') ?? '').trim();
		const professionalName = String(form.get('name') ?? '').trim();

		const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para administrar el equipo.' });
		}
		if (!targetAccessId) return fail(400, { message: 'Elegí a la persona del equipo.' });
		if (!professionalName) return fail(400, { message: 'El nombre profesional es obligatorio.' });

		const currentAccess = await listRoleAccess(supabase, context.business.id);
		const member = currentAccess.find((item) => item.id === targetAccessId);
		if (!member) return fail(400, { message: 'No se encontró a esa persona en el equipo.' });
		if (member.role !== 'owner' && member.role !== 'admin') {
			return fail(400, {
				message: 'Desde acá solo se configura como atendible al dueño o a un administrador.'
			});
		}
		if (
			!canConfigureAttendingProfile({
				actorRole: context.role,
				targetRole: member.role,
				isAssisting: Boolean(context.assistance)
			})
		) {
			return fail(403, { message: 'Un administrador no puede configurar al dueño.' });
		}
		if (member.professional_id) {
			return fail(400, { message: 'Esa persona ya tiene un perfil profesional.' });
		}

		const businessId = context.business.id;
		const admin = await createSupabaseAdminClient('odonto', fetch);

		if (member.user_id) {
			const { data: existingLink, error: existingLinkError } = await admin
				.from('professional_users')
				.select('id')
				.eq('business_id', businessId)
				.eq('user_id', member.user_id)
				.limit(1)
				.maybeSingle();
			if (existingLinkError) {
				console.error('Error verificando vínculo profesional', existingLinkError);
				return fail(500, { message: 'No se pudo verificar el perfil profesional.' });
			}
			if (existingLink?.id) {
				return fail(400, { message: 'Esa persona ya tiene un perfil profesional.' });
			}
		}

		// Sin email en professionals: la identidad se resuelve por la invitación pendiente
		// o por professional_users y así no se duplican identidades profesionales.
		const { data: createdProfessional, error: createError } = await admin
			.from('professionals')
			.insert({
				business_id: businessId,
				name: professionalName,
				is_active: true,
				is_public: member.status === 'active'
			})
			.select('id')
			.single();
		if (createError || !createdProfessional?.id) {
			console.error('Error creando profesional atendible', createError);
			return fail(500, { message: 'No se pudo crear el perfil profesional.' });
		}
		const professionalId = String(createdProfessional.id);

		let linkError: { message?: string } | null = null;
		let linkCreated = false;
		if (member.user_id) {
			const result = await admin.from('professional_users').insert({
				business_id: businessId,
				professional_id: professionalId,
				user_id: member.user_id
			});
			linkError = result.error;
			linkCreated = !result.error;
		} else {
			const result = await admin
				.from('business_user_invites')
				.update({ professional_id: professionalId, updated_at: new Date().toISOString() })
				.eq('business_id', businessId)
				.eq('id', member.id)
				.eq('status', 'pending')
				.select('id')
				.maybeSingle();
			linkError = result.error;
			linkCreated = Boolean(result.data?.id);
		}
		if (linkError || !linkCreated) {
			await admin.from('professionals').delete().eq('business_id', businessId).eq('id', professionalId);
			console.error('Error vinculando profesional al usuario', linkError);
			return fail(500, { message: 'No se pudo vincular el perfil profesional a la persona del equipo.' });
		}

		try {
			await ensureDefaultServicesAssigned(supabase, businessId, professionalId);
		} catch (defaultsError) {
			console.error('No se pudieron asegurar servicios por defecto del atendible', defaultsError);
		}

		await writeAuditLog(admin, {
			businessId,
			userId: currentUserId,
			action: 'professional.created_attending',
			entityType: 'professional',
			entityId: professionalId,
			metadata: {
				user_id: member.user_id,
				email: member.email,
				account_status: member.status,
				role: member.role,
				name: professionalName
			}
		});

		throw redirect(303, `/odonto/profesionales/${professionalId}?tab=servicios`);
	},
	update_role: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const membershipId = String(form.get('membership_id') ?? '').trim();
		const role = String(form.get('role') ?? '').trim();

		if (!membershipId) {
			return fail(400, { message: 'Rol inválido.' });
		}
		if (!isBusinessRole(role)) {
			return fail(400, { message: 'El rol seleccionado no es válido.' });
		}

		const { supabase, context } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para administrar el equipo.' });
		}

			const members = await listRoleAccess(supabase, context.business.id);
			const target = members.find((member) => member.id === membershipId && member.status === 'active');
			if (!target) {
				return fail(404, { message: 'Rol no encontrado en este consultorio.' });
			}
			if (context.assistance && (target.role === 'owner' || target.role === 'admin' || role === 'owner' || role === 'admin')) {
				return fail(403, {
					message: 'El dueño y los administradores se configuran desde el consultorio.'
				});
			}
			if (target.role === 'owner' && role !== 'owner' && countOwners(members) <= 1) {
				return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
			}
		if (role === 'professional' && !target.professional_id) {
			return fail(400, { message: 'Para asignar rol profesional, usá Agregar integrante con rol Profesional.' });
		}

		const { error } = await supabase.rpc('update_business_role_access', {
			target_access_id: membershipId,
			target_role: role
		});

		if (error) {
			console.error('Error actualizando rol', error);
			return fail(roleAccessErrorStatus(error), { message: roleAccessErrorMessage(error) });
		}

		return { success: true, message: 'Rol actualizado.' };
	},
	remove_user: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const accessId = String(form.get('access_id') ?? form.get('membership_id') ?? '').trim();
		const status = String(form.get('status') ?? 'active').trim();
		if (!accessId) {
			return fail(400, { message: 'Rol inválido.' });
		}

		const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
			if (!context.canManage) {
				return fail(403, { message: 'No tenés permisos para administrar el equipo.' });
			}

			const members = await listRoleAccess(supabase, context.business.id);
			const target = members.find((member) => member.id === accessId && member.status === status);
			if (!target) {
				return fail(404, { message: 'Rol no encontrado en este consultorio.' });
			}
			if (context.assistance && (target.role === 'owner' || target.role === 'admin')) {
				return fail(403, {
					message: 'El dueño y los administradores se configuran desde el consultorio.'
				});
			}

			if (status === 'pending') {
				const { error } = await supabase.rpc('cancel_business_role_invite', {
					target_invite_id: accessId
			});
			if (error) {
				console.error('Error cancelando invitación', error);
				return fail(500, { message: 'No se pudo quitar el rol pendiente.' });
				}
				return { success: true, message: 'Rol pendiente quitado.' };
			}

			if (target.user_id === currentUserId) {
				return fail(400, { message: 'No podés quitar tu propio acceso desde esta pantalla.' });
			}
		if (target.role === 'owner' && countOwners(members) <= 1) {
			return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
		}

		const { error } = await supabase.rpc('remove_business_role_access', {
			target_access_id: accessId
		});

		if (error) {
			console.error('Error quitando acceso', error);
			return fail(roleAccessErrorStatus(error), { message: roleAccessErrorMessage(error) });
		}

		return { success: true, message: 'Rol quitado del consultorio.' };
	}
};
