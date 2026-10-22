import { isUuid } from '@cita-suite/shared/uuid';
import {
	isRecord,
	readChoice,
	readJson,
	readRecord,
	readText,
	InvalidDataContractError
} from '$lib/contracts/json';
import { ROLE_ACCESS_OUTCOMES, type RoleAccessOutcome } from '$lib/access/team-contracts';
import type { BusinessRole } from '$lib/access/contracts';
import type { CitaSupabaseClient } from '$lib/types/database';
import { formatPriceLabel } from '$lib/utils/money-input';
import {
	scheduleBlocksFromForm,
	professionalSchedulePayload,
	MIN_SERVICE_DURATION_MINUTES,
	MAX_SERVICE_DURATION_MINUTES
} from '$lib/team/professional-form';
import { parseAvailabilityExceptionInterval } from './availability-exceptions';
import type { SaveResult } from './professional-editor';

export type TeamMemberProfileConfiguration = {
	professionalId: string;
	email: string;
	role: BusinessRole;
	name: string;
	specialty: string;
	serviceIds: string[];
	newServices: { name: string; duration_minutes: number; price_label: string | null }[];
	blocks: ReturnType<typeof professionalSchedulePayload>;
	exception: null | {
		appliesTo: 'business' | 'professional';
		type: string;
		startsAt: string;
		endsAt: string;
		reason: string;
	};
};

export function prepareTeamMemberProfile(
	form: FormData,
	role: BusinessRole,
	email: string,
	timeZone: string
): SaveResult<TeamMemberProfileConfiguration> {
	const name = String(form.get('professional_name') ?? '').trim();
	if (!name)
		return {
			ok: false,
			status: 400,
			message: 'Completá el nombre del profesional para continuar.'
		};
	if (name.length > 160)
		return { ok: false, status: 400, message: 'Acortá el nombre profesional a 160 caracteres.' };
	const schedule = scheduleBlocksFromForm(form);
	if (!schedule.ok) return schedule;
	let items: unknown;
	try {
		items = JSON.parse(String(form.get('new_services') ?? '[]') || '[]');
	} catch {
		return { ok: false, status: 400, message: 'Los servicios cargados no son válidos.' };
	}
	if (!Array.isArray(items))
		return { ok: false, status: 400, message: 'Los servicios cargados no son válidos.' };
	const rows: unknown[] = items,
		newServices: TeamMemberProfileConfiguration['newServices'] = [];
	for (const item of rows) {
		if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim())
			return {
				ok: false,
				status: 400,
				message: 'No se puede crear un servicio adicional sin nombre.'
			};
		const duration =
			typeof item.duration_minutes === 'number' || typeof item.duration_minutes === 'string'
				? Number(item.duration_minutes)
				: NaN;
		if (
			!Number.isInteger(duration) ||
			duration < MIN_SERVICE_DURATION_MINUTES ||
			duration > MAX_SERVICE_DURATION_MINUTES
		)
			return {
				ok: false,
				status: 400,
				message: 'La duración del servicio debe estar entre 5 y 480 minutos.'
			};
		if (item.price_label != null && typeof item.price_label !== 'string')
			return { ok: false, status: 400, message: 'Revisá el arancel de los servicios nuevos.' };
		newServices.push({
			name: item.name.trim(),
			duration_minutes: duration,
			price_label: formatPriceLabel(item.price_label ?? '') || null
		});
	}
	const serviceIds = [
		...new Set(
			form
				.getAll('service_ids')
				.map(String)
				.map((value) => value.trim())
				.filter(Boolean)
		)
	];
	if (serviceIds.length + newServices.length > 500)
		return { ok: false, status: 400, message: 'Elegí hasta 500 prestaciones personalizadas.' };
	const periodMode = String(form.get('exception_period_mode') ?? 'single').trim();
	const date = String(form.get('exception_date') ?? '').trim(),
		dateFrom = String(form.get('exception_date_from') ?? '').trim(),
		dateTo = String(form.get('exception_date_to') ?? '').trim(),
		timeRange = String(form.get('exception_time_range') ?? '').trim();
	const hasException =
		periodMode === 'range' ? Boolean(dateFrom || dateTo) : Boolean(date || timeRange);
	let exception: TeamMemberProfileConfiguration['exception'] = null;
	if (hasException) {
		const type = String(form.get('exception_type') ?? 'blocked').trim();
		const interval = parseAvailabilityExceptionInterval({
			type,
			periodMode,
			date,
			dateFrom,
			dateTo,
			timeRange,
			timeZone
		});
		if (!interval.ok) return { ok: false, status: 400, message: interval.message };
		exception = {
			appliesTo: form.get('exception_applies_to') === 'business' ? 'business' : 'professional',
			type,
			startsAt: interval.startsAt.toISOString(),
			endsAt: interval.endsAt.toISOString(),
			reason: String(form.get('exception_reason') ?? '').trim()
		};
	}
	return {
		ok: true,
		data: {
			professionalId: crypto.randomUUID(),
			name,
			specialty: String(form.get('professional_specialty') ?? '').trim(),
			role,
			email,
			serviceIds,
			newServices,
			blocks: professionalSchedulePayload(schedule.blocks),
			exception
		}
	};
}

export async function createTeamMemberProfile(
	supabase: CitaSupabaseClient,
	businessId: string,
	configuration: TeamMemberProfileConfiguration
): Promise<{ status: RoleAccessOutcome; professionalId: string }> {
	const { data, error } = await supabase.rpc('create_team_member_profile', {
		p_business_id: businessId,
		p_configuration: readJson(configuration, 'team.member.profile.input')
	});
	if (error) throw error;
	const result = readRecord(data, 'team.member.profile.result');
	const id = readText(result.professionalId, 'team.member.profile.id');
	if (id !== configuration.professionalId)
		throw new InvalidDataContractError('team.member.profile.scope');
	return {
		professionalId: id,
		status: readChoice(result.status, ROLE_ACCESS_OUTCOMES, 'team.member.profile.status')
	};
}

export async function makeTeamMemberAttending(
	supabase: CitaSupabaseClient,
	businessId: string,
	accessId: string,
	name: string
): Promise<string> {
	const { data, error } = await supabase.rpc('make_team_member_attending', {
		p_business_id: businessId,
		p_access_id: accessId,
		p_name: name
	});
	if (error) throw error;
	if (!isUuid(data)) throw new InvalidDataContractError('team.member.attending.id');
	return data;
}

/** Never render provider/SQL messages or retry a possibly committed command. */
export function teamMemberFailure(error: unknown): { status: number; message: string } {
	const raw = isRecord(error) && typeof error.message === 'string' ? error.message : '';
	const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
	if (code === '55P03' || raw.includes('AVAILABILITY_REVISION_CONFLICT'))
		return {
			status: 409,
			message: 'El equipo o sus horarios cambiaron. Recargá la pantalla antes de guardar.'
		};
	if (
		raw.includes('TEAM_ACCESS_DENIED') ||
		raw.includes('BUSINESS_MANAGE_DENIED') ||
		raw.includes('ADMIN_OWNER_ACTION_DENIED')
	)
		return {
			status: 403,
			message: 'Tu acceso cambió o no permite administrar a esta persona. Recargá la pantalla.'
		};
	if (
		raw.includes('TEAM_PROFILE_ALREADY_EXISTS') ||
		raw.includes('PROFESSIONAL_EMAIL_ALREADY_EXISTS')
	)
		return {
			status: 409,
			message: 'Esa persona ya tiene un perfil profesional. Revisalo en Equipo.'
		};
	if (raw.includes('BUSINESS_USER_NOT_FOUND') || raw.includes('BUSINESS_INVITE_NOT_FOUND'))
		return {
			status: 409,
			message: 'El acceso del equipo cambió. Recargá la lista y volvé a intentar.'
		};
	if (raw.includes('INVALID_SERVICE_ASSIGNMENT'))
		return {
			status: 400,
			message:
				'Alguna prestación seleccionada ya no está disponible en este consultorio. Revisá la selección.'
		};
	if (raw.includes('EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS'))
		return {
			status: 409,
			message: 'Ese correo ya está asociado a otro consultorio. Usá otro correo para esta persona.'
		};
	if (raw.includes('LAST_OWNER_BLOCKED'))
		return { status: 400, message: 'El consultorio debe conservar al menos un dueño.' };
	if (raw.includes('PROFESSIONAL_ROLE_NOT_SUPPORTED'))
		return {
			status: 400,
			message: 'Solo un profesional, administrador o dueño puede tener perfil profesional.'
		};
	return {
		status: 503,
		message: 'No pudimos confirmar el cambio. Revisá Equipo antes de volver a intentarlo.'
	};
}
