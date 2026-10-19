import {
	roleSupportsProfessionalProfile,
	shouldConfigureProfessionalProfile
} from '$lib/utils/team-permissions';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import {
	prepareTeamMemberProfile,
	createTeamMemberProfile,
	makeTeamMemberAttending,
	teamMemberFailure
} from '$lib/server/team/public/member-profile';
import type { BusinessRoleAccess } from '$lib/access/team-contracts';
import {
	grantBusinessRoleAccess,
	listBusinessRoleAccess as listRoleAccess
} from '$lib/server/access/public/team-access';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { logServerFailure } from '$lib/server/platform/logging';
import {
	BUSINESS_ROLES,
	demoBusinessContext,
	isBusinessRole,
	type BusinessRole
} from '$lib/server/access/public/business';
import {
	DEFAULT_SERVICE_NAMES,
	isDefaultServiceName
} from '$lib/server/team/public/default-services';
import {
	businessEmailAssociationErrorStatus,
	EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS_MESSAGE,
	isEmailAlreadyAssociatedWithOtherBusinessError
} from '$lib/server/access/public/business-email-association';
import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { CitaSupabaseClient } from '$lib/types/database';

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

// Roles que se ofrecen al agregar un integrante desde Equipo.
const TEAM_ROLES = BUSINESS_ROLES.filter((role) => role !== 'readonly');

const normalizeEmail = (value: FormDataEntryValue | null) =>
	String(value ?? '')
		.trim()
		.toLowerCase();

const listServices = async (
	supabase: CitaSupabaseClient,
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
	return (data ?? []).map((item) => ({
		id: String(item.id),
		name: String(item.name ?? ''),
		duration_minutes: Number(item.duration_minutes ?? 0),
		price_label: item.price_label ? String(item.price_label) : null,
		is_default: isDefaultServiceName(String(item.name ?? ''))
	}));
};

const countOwners = (members: BusinessRoleAccess[]) =>
	members.filter((member) => member.status === 'active' && member.role === 'owner').length;

const roleAccessErrorMessage = (error: { code?: string; message?: string } | null | undefined) => {
	const raw = error?.message ?? '';
	if (isEmailAlreadyAssociatedWithOtherBusinessError(error)) {
		return EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS_MESSAGE;
	}
	if (raw.includes('BUSINESS_MANAGE_DENIED'))
		return 'No tenés permisos para administrar el equipo.';
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
	if (
		error?.code === '42P10' ||
		raw.includes('no unique or exclusion constraint matching the on conflict')
	) {
		return 'No pudimos guardar el acceso. Volvé a intentar en unos minutos.';
	}
	if (raw.includes('ADMIN_OWNER_ACTION_DENIED'))
		return 'Un administrador no puede modificar dueños ni otros administradores.';
	if (raw.includes('LAST_OWNER_BLOCKED')) return 'El consultorio debe conservar al menos un dueño.';
	if (raw.includes('SELF_REMOVE_DENIED'))
		return 'No podés quitar tu propio rol desde esta pantalla.';
	return 'No se pudo guardar el rol.';
};

const roleAccessErrorStatus = (error: { code?: string; message?: string } | null | undefined) => {
	const raw = error?.message ?? '';
	if (raw.includes('BUSINESS_USER_NOT_FOUND') || raw.includes('BUSINESS_INVITE_NOT_FOUND'))
		return 409;
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

	const {
		supabase,
		business: context,
		userId: currentUserId
	} = await getOdontoContext({ locals, fetch, cookies });
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

		let form: FormData;
		try {
			form = await readBoundedBookingForm(request, ['service_ids', 'weekdays']);
		} catch {
			return fail(400, { message: 'Revisá los datos del integrante antes de guardar.' });
		}
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

		const { supabase, business: context } = await getOdontoContext({ locals, fetch, cookies });
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

		try {
			if (configureProfessionalProfile) {
				const prepared = prepareTeamMemberProfile(form, role, email, context.business.timezone);
				if (!prepared.ok) return fail(prepared.status, { message: prepared.message, values });
				if (!prepared.data)
					return fail(503, {
						message: 'No pudimos preparar el perfil. Revisá los datos y volvé a intentar.',
						values
					});
				const result = await createTeamMemberProfile(supabase, context.business.id, prepared.data);
				return {
					success: true,
					openRole: role,
					message:
						result.status === 'pending' || result.status === 'already_pending'
							? `Perfil profesional configurado con rol ${roleLabel(role)}. No aparecerá en las reservas online hasta que la persona cree su cuenta con ${email}.`
							: `Perfil profesional creado y rol ${roleLabel(role)} asignado al consultorio.`
				};
			}
			const result = await grantBusinessRoleAccess(supabase, context.business.id, email, role);
			if (result.status === 'already_active' || result.status === 'already_pending') {
				return { success: true, openRole: role, message: 'Ese correo ya tenía ese rol asignado.' };
			}
			return {
				success: true,
				openRole: role,
				message:
					result.status === 'pending'
						? 'Acceso preparado. Cuando la persona cree su cuenta con ese correo, el rol se asignará automáticamente.'
						: 'Rol asignado al consultorio.'
			};
		} catch (error) {
			logServerFailure('Error guardando integrante del equipo', error);
			const result = teamMemberFailure(error);
			return fail(result.status, { message: result.message, values });
		}
	},
	make_attending: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		let form: FormData;
		try {
			form = await readBoundedBookingForm(request);
		} catch {
			return fail(400, { message: 'Revisá el nombre y la persona seleccionada.' });
		}
		const accessId = String(form.get('access_id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		if (!accessId) return fail(400, { message: 'Elegí a la persona del equipo.' });
		if (!name || name.length > 160)
			return fail(400, { message: 'Ingresá un nombre profesional de hasta 160 caracteres.' });
		const { supabase, business: context } = await getOdontoContext({ locals, fetch, cookies });
		if (!context.canManage)
			return fail(403, { message: 'No tenés permisos para administrar el equipo.' });
		let professionalId: string;
		try {
			professionalId = await makeTeamMemberAttending(supabase, context.business.id, accessId, name);
		} catch (error) {
			logServerFailure('Error configurando perfil profesional del integrante', error);
			const result = teamMemberFailure(error);
			return fail(result.status, { message: result.message });
		}
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

		const { supabase, business: context } = await getOdontoContext({ locals, fetch, cookies });
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para administrar el equipo.' });
		}

		const members = await listRoleAccess(supabase, context.business.id);
		const target = members.find(
			(member) => member.id === membershipId && member.status === 'active'
		);
		if (!target) {
			return fail(404, { message: 'Rol no encontrado en este consultorio.' });
		}
		if (
			context.assistance &&
			(target.role === 'owner' || target.role === 'admin' || role === 'owner' || role === 'admin')
		) {
			return fail(403, {
				message: 'El dueño y los administradores se configuran desde el consultorio.'
			});
		}
		if (target.role === 'owner' && role !== 'owner' && countOwners(members) <= 1) {
			return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
		}
		if (role === 'professional' && !target.professional_id) {
			return fail(400, {
				message: 'Para asignar rol profesional, usá Agregar integrante con rol Profesional.'
			});
		}

		const { error } = await supabase.rpc('update_business_role_access', {
			target_access_id: membershipId,
			target_role: role
		});

		if (error) {
			logServerFailure('Error actualizando rol', error);
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

		const {
			supabase,
			business: context,
			userId: currentUserId
		} = await getOdontoContext({ locals, fetch, cookies });
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
				logServerFailure('Error cancelando invitación', error);
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
			logServerFailure('Error quitando acceso', error);
			return fail(roleAccessErrorStatus(error), { message: roleAccessErrorMessage(error) });
		}

		return { success: true, message: 'Rol quitado del consultorio.' };
	}
};
