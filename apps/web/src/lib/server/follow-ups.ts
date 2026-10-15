import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessRole } from './business';

// Seguimientos: recordar volver a contactar a un paciente. Sin recurrencia.
// Visibilidad por rol de sistema; asignación a un perfil profesional atendible.
// Seguridad principal = guards server-side (admin client). RLS = defensa secundaria.

export type FollowUpStatus = 'pending' | 'done';

export type FollowUpListItem = {
	id: string;
	patient_id: string;
	patient_name: string;
	message: string | null;
	remind_on: string; // YYYY-MM-DD
	assigned_professional_id: string | null;
	/** Versión de fila para que una acción no pueda sobrescribir una edición concurrente. */
	updated_at: string;
};

export type FollowUpNotice = {
	count: number;
	single: FollowUpListItem | null;
	dismissalKey: string;
};

export type AssignableProfessionalSource = 'patient_link' | 'owner_admin_attending';

export type AssignableProfessional = {
	id: string;
	name: string;
	source: AssignableProfessionalSource;
};

export class FollowUpError extends Error {
	code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
		this.name = 'FollowUpError';
	}
}

export const getFollowUpErrorMessage = (code: string): string => {
	switch (code) {
		case 'FOLLOWUP_INVALID_DATE':
			return 'La fecha del recordatorio no es válida o ya pasó.';
		case 'FOLLOWUP_MESSAGE_TOO_LONG':
			return 'El mensaje es demasiado largo (máximo 500 caracteres).';
		case 'FOLLOWUP_PATIENT_NOT_FOUND':
			return 'No se encontró el paciente.';
		case 'FOLLOWUP_PATIENT_NOT_YOURS':
			return 'Ese paciente no está entre tus pacientes.';
		case 'FOLLOWUP_PROFESSIONAL_PROFILE_REQUIRED':
			return 'Tu usuario no tiene un perfil profesional para asignar el seguimiento.';
		case 'FOLLOWUP_ASSIGN_REQUIRED':
			return 'Elegí a qué profesional asignar el seguimiento.';
		case 'FOLLOWUP_PROFESSIONAL_NOT_LINKED':
			return 'Ese perfil profesional no puede asignarse a este paciente.';
		case 'FOLLOWUP_NOT_FOUND':
			return 'No se encontró el seguimiento.';
		case 'FOLLOWUP_FORBIDDEN':
			return 'No tenés permiso para esta acción.';
		case 'FOLLOWUP_STATUS_CONFLICT':
			return 'El seguimiento cambió mientras lo estabas actualizando y no sobrescribimos ese cambio. Recargá la lista para ver el estado actual.';
		default:
			return 'No pudimos completar este seguimiento. Recargá la lista y volvé a intentar.';
	}
};

export const getFollowUpErrorStatus = (code: string): number => {
	if (code === 'FOLLOWUP_FORBIDDEN') return 403;
	if (code === 'FOLLOWUP_NOT_FOUND') return 404;
	if (code === 'FOLLOWUP_STATUS_CONFLICT') return 409;
	return 400;
};

// ---------- Helpers puros (testeables, sin DB) ----------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Día local del negocio como YYYY-MM-DD. Única fuente de "hoy"; nunca tz del server. */
export const businessTodayISO = (timezone: string, now: Date = new Date()): string => {
	const fmt = (tz?: string) =>
		new Intl.DateTimeFormat('en-CA', {
			...(tz ? { timeZone: tz } : {}),
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(now);
	try {
		return fmt(timezone);
	} catch {
		return fmt();
	}
};

export const isValidISODate = (value: string): boolean => {
	if (!ISO_DATE_RE.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export const addDaysISO = (iso: string, days: number): string => {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

export type SnoozePreset = 'manana' | 'tres_dias' | 'semana';

export const snoozePresetDate = (preset: SnoozePreset, todayISO: string): string => {
	if (preset === 'manana') return addDaysISO(todayISO, 1);
	if (preset === 'tres_dias') return addDaysISO(todayISO, 3);
	return addDaysISO(todayISO, 7);
};

/** Dueño/Admin/Recepción ven TODO el consultorio. */
export const roleSeesAllFollowUps = (role: BusinessRole): boolean =>
	role === 'owner' || role === 'admin' || role === 'reception';

/** Quién participa de Seguimientos (sección + aviso). Lectura queda afuera. */
export const roleParticipatesInFollowUps = (role: BusinessRole): boolean =>
	roleSeesAllFollowUps(role) || role === 'professional';

/** Ejecutándose = pending AND remind_on <= hoy (comparación lexicográfica válida para ISO). */
export const isExecuting = (remindOn: string, todayISO: string): boolean => remindOn <= todayISO;

export const followUpNoticeFingerprint = (ids: string[], count: number): string => {
	let hash = 2166136261;
	const source = `${count}:${ids.join('|')}`;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${count}-${(hash >>> 0).toString(36)}`;
};

export const buildNotice = (
	rows: FollowUpListItem[],
	count: number,
	identityIds: string[] = rows.map((row) => row.id)
): FollowUpNotice => ({
	count,
	single: count === 1 ? rows[0] ?? null : null,
	dismissalKey: followUpNoticeFingerprint(identityIds, count)
});

export const mergeAssignableProfessionals = (
	linkedProfessionals: AssignableProfessional[],
	ownerAdminProfessionals: AssignableProfessional[]
): AssignableProfessional[] => {
	const byId = new Map<string, AssignableProfessional>();
	for (const professional of linkedProfessionals) byId.set(professional.id, professional);
	for (const professional of ownerAdminProfessionals) {
		if (!byId.has(professional.id)) byId.set(professional.id, professional);
	}
	return [...byId.values()].sort((a, b) => {
		const sourceOrder =
			(a.source === 'patient_link' ? 0 : 1) - (b.source === 'patient_link' ? 0 : 1);
		return sourceOrder || a.name.localeCompare(b.name, 'es');
	});
};

// ---------- Acceso a datos (admin client; scope server-side) ----------

export type RoleScope = {
	businessId: string;
	role: BusinessRole;
	professionalId: string | null;
};

export type TzScope = RoleScope & { timezone: string };

const FOLLOWUP_SELECT =
	'id, patient_id, message, remind_on, assigned_professional_id, updated_at, patients(full_name)';

const mapRow = (row: any): FollowUpListItem => ({
	id: String(row.id),
	patient_id: String(row.patient_id),
	patient_name: String(row?.patients?.full_name ?? 'Paciente'),
	message: row.message ?? null,
	remind_on: String(row.remind_on),
	assigned_professional_id: row.assigned_professional_id ? String(row.assigned_professional_id) : null,
	updated_at: String(row.updated_at)
});

/** professional_id del usuario actuante (rol Profesional). Mirror de pacientes/+page.server.ts. */
export const resolveActingProfessionalId = async (
	admin: SupabaseClient,
	businessId: string,
	userId: string
): Promise<string | null> => {
	const { data, error } = await admin
		.from('professional_users')
		.select('professional_id')
		.eq('business_id', businessId)
		.eq('user_id', userId)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return data?.professional_id ? String(data.professional_id) : null;
};

/** Resuelve el scope (incluye professionalId para rol Profesional). Una sola fuente para endpoints. */
export const buildFollowUpScope = async (
	admin: SupabaseClient,
	business: { role: BusinessRole; business: { id: string; timezone: string } },
	userId: string
): Promise<TzScope> => {
	const professionalId =
		business.role === 'professional'
			? await resolveActingProfessionalId(admin, business.business.id, userId)
			: null;
	return {
		businessId: business.business.id,
		role: business.role,
		professionalId,
		timezone: business.business.timezone
	};
};

const applyRoleScope = (query: any, scope: RoleScope) =>
	roleSeesAllFollowUps(scope.role) ? query : query.eq('assigned_professional_id', scope.professionalId);

/**
 * La asignación de un seguimiento no conserva acceso si el vínculo del
 * profesional con el paciente fue archivado. Las consultas usan el cliente
 * backend, por lo que esta segunda comprobación es necesaria además del scope
 * por assigned_professional_id.
 */
const filterActiveProfessionalPatientLinks = async (
	admin: SupabaseClient,
	scope: RoleScope,
	rows: any[]
) => {
	if (roleSeesAllFollowUps(scope.role)) return rows;
	if (!scope.professionalId || rows.length === 0) return [];
	const patientIds = [...new Set(rows.map((row) => String(row.patient_id)).filter(Boolean))];
	if (patientIds.length === 0) return [];
	const { data, error } = await admin
		.from('professional_patient_links')
		.select('patient_id')
		.eq('business_id', scope.businessId)
		.eq('professional_id', scope.professionalId)
		.eq('is_active', true)
		.in('patient_id', patientIds);
	if (error) throw error;
	const linkedPatientIds = new Set((data ?? []).map((row: any) => String(row.patient_id)));
	return rows.filter((row) => linkedPatientIds.has(String(row.patient_id)));
};

export const listExecutingFollowUps = async (
	admin: SupabaseClient,
	scope: TzScope
): Promise<FollowUpListItem[]> => {
	if (!roleSeesAllFollowUps(scope.role) && !scope.professionalId) return [];
	const today = businessTodayISO(scope.timezone);
	const { data, error } = await applyRoleScope(
		admin
			.from('follow_ups')
			.select(FOLLOWUP_SELECT)
			.eq('business_id', scope.businessId)
			.eq('status', 'pending')
			.lte('remind_on', today)
			.order('remind_on', { ascending: true })
			.limit(300),
		scope
	);
	if (error) throw error;
	const visibleRows = await filterActiveProfessionalPatientLinks(admin, scope, data ?? []);
	return visibleRows.map(mapRow);
};

export const listProgrammedFollowUps = async (
	admin: SupabaseClient,
	scope: TzScope
): Promise<FollowUpListItem[]> => {
	if (!roleSeesAllFollowUps(scope.role) && !scope.professionalId) return [];
	const today = businessTodayISO(scope.timezone);
	const { data, error } = await applyRoleScope(
		admin
			.from('follow_ups')
			.select(FOLLOWUP_SELECT)
			.eq('business_id', scope.businessId)
			.eq('status', 'pending')
			.gt('remind_on', today)
			.order('remind_on', { ascending: true })
			.limit(300),
		scope
	);
	if (error) throw error;
	const visibleRows = await filterActiveProfessionalPatientLinks(admin, scope, data ?? []);
	return visibleRows.map(mapRow);
};

export const getNoticeSummary = async (
	admin: SupabaseClient,
	scope: TzScope
): Promise<FollowUpNotice> => {
	if (!roleSeesAllFollowUps(scope.role) && !scope.professionalId) return buildNotice([], 0);
	const today = businessTodayISO(scope.timezone);
	const { data: identityRows, count, error } = await applyRoleScope(
		admin
			.from('follow_ups')
			.select('id, patient_id', { count: 'exact' })
			.eq('business_id', scope.businessId)
			.eq('status', 'pending')
			.lte('remind_on', today)
			.order('remind_on', { ascending: true })
			.order('id', { ascending: true })
			.limit(300),
		scope
	);
	if (error) throw error;
	const visibleIdentityRows = await filterActiveProfessionalPatientLinks(admin, scope, identityRows ?? []);
	const identityIds = visibleIdentityRows.map((row: any) => String(row.id));
	// Si se filtró un vínculo archivado, el count de PostgREST ya no representa
	// lo que puede ver el profesional. En ese caso usamos sólo las filas visibles
	// para no mostrar un aviso huérfano ni filtrar un paciente por accidente.
	const total = visibleIdentityRows.length === (identityRows ?? []).length ? (count ?? 0) : visibleIdentityRows.length;
	if (total !== 1 || identityIds.length !== 1) return buildNotice([], total, identityIds);

	const { data: singleRow, error: singleError } = await admin
		.from('follow_ups')
		.select(FOLLOWUP_SELECT)
		.eq('business_id', scope.businessId)
		.eq('id', identityIds[0])
		.maybeSingle();
	if (singleError) throw singleError;
	if (
		!roleSeesAllFollowUps(scope.role) &&
		!(await filterActiveProfessionalPatientLinks(admin, scope, singleRow ? [singleRow] : [])).length
	) {
		return buildNotice([], 0);
	}
	return buildNotice(singleRow ? [mapRow(singleRow)] : [], total, identityIds);
};

/** Profesionales atendibles (activos) vinculados a un paciente. */
const listLinkedProfessionalsForPatient = async (
	admin: SupabaseClient,
	businessId: string,
	patientId: string
): Promise<AssignableProfessional[]> => {
	const { data: links, error: linksError } = await admin
		.from('professional_patient_links')
		.select('professional_id')
		.eq('business_id', businessId)
		.eq('patient_id', patientId)
		.eq('is_active', true);
	if (linksError) throw linksError;
	const ids = [...new Set((links ?? []).map((l: any) => String(l.professional_id)))];
	if (ids.length === 0) return [];
	const { data: profs, error: profsError } = await admin
		.from('professionals')
		.select('id, name, is_active')
		.eq('business_id', businessId)
		.in('id', ids);
	if (profsError) throw profsError;
	return (profs ?? [])
		.filter((p: any) => p.is_active !== false)
		.map((p: any) => ({
			id: String(p.id),
			name: String(p.name),
			source: 'patient_link' as const
		}))
		.sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

const listOwnerAdminAttendingProfessionals = async (
	admin: SupabaseClient,
	businessId: string
): Promise<AssignableProfessional[]> => {
	const { data: memberships, error: membershipsError } = await admin
		.from('business_users')
		.select('user_id, role')
		.eq('business_id', businessId)
		.eq('status', 'active')
		.in('role', ['owner', 'admin']);
	if (membershipsError) throw membershipsError;

	const userIds = [
		...new Set((memberships ?? []).map((row: any) => row.user_id).filter(Boolean).map(String))
	];
	if (userIds.length === 0) return [];

	const { data: links, error: linksError } = await admin
		.from('professional_users')
		.select('professional_id, user_id')
		.eq('business_id', businessId)
		.in('user_id', userIds);
	if (linksError) throw linksError;

	const ids = [...new Set((links ?? []).map((row: any) => String(row.professional_id)))];
	if (ids.length === 0) return [];

	const { data: professionals, error: professionalsError } = await admin
		.from('professionals')
		.select('id, name, is_active')
		.eq('business_id', businessId)
		.in('id', ids);
	if (professionalsError) throw professionalsError;

	return (professionals ?? [])
		.filter((professional: any) => professional.is_active !== false)
		.map((professional: any) => ({
			id: String(professional.id),
			name: String(professional.name),
			source: 'owner_admin_attending' as const
		}))
		.sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

/** Selector de asignación: vinculados al paciente + dueños/admins atendibles. */
export const listAssignableProfessionalsForPatient = async (
	admin: SupabaseClient,
	businessId: string,
	patientId: string
): Promise<AssignableProfessional[]> => {
	const [linkedProfessionals, ownerAdminProfessionals] = await Promise.all([
		listLinkedProfessionalsForPatient(admin, businessId, patientId),
		listOwnerAdminAttendingProfessionals(admin, businessId)
	]);
	return mergeAssignableProfessionals(linkedProfessionals, ownerAdminProfessionals);
};

const cleanQuery = (value: string) => value.trim().replace(/\s+/g, ' ');

export type PatientSearchResult = { id: string; full_name: string; phone_e164: string | null };

/** Búsqueda de pacientes para asignar: Dueño/Admin/Recepción todos; Profesional sólo los suyos. */
export const listAssignablePatientsSearch = async (
	admin: SupabaseClient,
	scope: RoleScope,
	rawQuery: string
): Promise<PatientSearchResult[]> => {
	const query = cleanQuery(rawQuery);
	if (query.length < 2) return [];
	const safe = query.replace(/[%_]/g, '\\$&');
	const digits = query.replace(/\D/g, '');
	const filters = [`full_name.ilike.%${safe}%`, `phone_e164.ilike.%${safe}%`, `dni.ilike.%${safe}%`];
	if (digits.length >= 3) filters.push(`phone_e164.ilike.%${digits}%`);

	// Profesional: restringir a sus pacientes vinculados activos.
	let restrictIds: string[] | null = null;
	if (!roleSeesAllFollowUps(scope.role)) {
		if (!scope.professionalId) return [];
		const { data: links, error: linksError } = await admin
			.from('professional_patient_links')
			.select('patient_id')
			.eq('business_id', scope.businessId)
			.eq('professional_id', scope.professionalId)
			.eq('is_active', true);
		if (linksError) throw linksError;
		restrictIds = [...new Set((links ?? []).map((l: any) => String(l.patient_id)))];
		if (restrictIds.length === 0) return [];
	}

	let q = admin
		.from('patients')
		.select('id, full_name, phone_e164')
		.eq('business_id', scope.businessId)
		.is('archived_at', null);
	if (restrictIds) q = q.in('id', restrictIds);
	const { data, error } = await q
		.or(filters.join(','))
		.order('updated_at', { ascending: false })
		.limit(12);
	if (error) throw error;
	return (data ?? []).map((p: any) => ({
		id: String(p.id),
		full_name: String(p.full_name),
		phone_e164: p.phone_e164 ?? null
	}));
};

const patientBelongsToBusiness = async (
	admin: SupabaseClient,
	businessId: string,
	patientId: string
): Promise<boolean> => {
	const { data, error } = await admin
		.from('patients')
		.select('id')
		.eq('business_id', businessId)
		.eq('id', patientId)
		.is('archived_at', null)
		.maybeSingle();
	if (error) throw error;
	return Boolean(data?.id);
};

const professionalLinkedToPatient = async (
	admin: SupabaseClient,
	businessId: string,
	professionalId: string,
	patientId: string
): Promise<boolean> => {
	const { data, error } = await admin
		.from('professional_patient_links')
		.select('id')
		.eq('business_id', businessId)
		.eq('professional_id', professionalId)
		.eq('patient_id', patientId)
		.eq('is_active', true)
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return Boolean(data?.id);
};

const professionalCanReceiveFollowUp = async (
	admin: SupabaseClient,
	businessId: string,
	professionalId: string,
	patientId: string
): Promise<boolean> => {
	const assignableProfessionals = await listAssignableProfessionalsForPatient(
		admin,
		businessId,
		patientId
	);
	return assignableProfessionals.some((professional) => professional.id === professionalId);
};

export type CreateFollowUpInput = {
	businessId: string;
	role: BusinessRole;
	userId: string;
	actingProfessionalId: string | null;
	patientId: string;
	remindOn: string;
	message: string | null;
	assignToProfessionalId: string | null;
	timezone: string;
};

/** El endpoint NUNCA inserta assigned_professional_id null en el flujo normal. */
export const createFollowUp = async (
	admin: SupabaseClient,
	input: CreateFollowUpInput
): Promise<string> => {
	const { businessId, role, userId, patientId, timezone } = input;
	if (!roleParticipatesInFollowUps(role)) throw new FollowUpError('FOLLOWUP_FORBIDDEN');

	const today = businessTodayISO(timezone);
	const remindOn = (input.remindOn ?? '').trim();
	if (!isValidISODate(remindOn) || remindOn < today) throw new FollowUpError('FOLLOWUP_INVALID_DATE');

	const message = (input.message ?? '').trim();
	if (message.length > 500) throw new FollowUpError('FOLLOWUP_MESSAGE_TOO_LONG');

	if (!(await patientBelongsToBusiness(admin, businessId, patientId)))
		throw new FollowUpError('FOLLOWUP_PATIENT_NOT_FOUND');

	let assignedProfessionalId: string;
	if (role === 'professional') {
		if (!input.actingProfessionalId)
			throw new FollowUpError('FOLLOWUP_PROFESSIONAL_PROFILE_REQUIRED');
		if (!(await professionalLinkedToPatient(admin, businessId, input.actingProfessionalId, patientId)))
			throw new FollowUpError('FOLLOWUP_PATIENT_NOT_YOURS');
		assignedProfessionalId = input.actingProfessionalId;
	} else {
		const assignTo = (input.assignToProfessionalId ?? '').trim();
		if (!assignTo) throw new FollowUpError('FOLLOWUP_ASSIGN_REQUIRED');
		if (!(await professionalCanReceiveFollowUp(admin, businessId, assignTo, patientId)))
			throw new FollowUpError('FOLLOWUP_PROFESSIONAL_NOT_LINKED');
		assignedProfessionalId = assignTo;
	}

	const { data, error } = await admin
		.from('follow_ups')
		.insert({
			business_id: businessId,
			patient_id: patientId,
			assigned_professional_id: assignedProfessionalId,
			remind_on: remindOn,
			message: message || null,
			status: 'pending',
			created_by: userId
		})
		.select('id')
		.single();
	if (error) throw error;
	return String(data.id);
};

const loadScopedPendingFollowUp = async (admin: SupabaseClient, scope: RoleScope, id: string) => {
	const { data, error } = await admin
		.from('follow_ups')
		.select('id, patient_id, assigned_professional_id, status, remind_on, updated_at')
		.eq('business_id', scope.businessId)
		.eq('id', id)
		.eq('status', 'pending')
		.maybeSingle();
	if (error) throw error;
	if (!data) throw new FollowUpError('FOLLOWUP_NOT_FOUND');
	if (!roleSeesAllFollowUps(scope.role)) {
		if (!scope.professionalId || String(data.assigned_professional_id ?? '') !== scope.professionalId)
			throw new FollowUpError('FOLLOWUP_FORBIDDEN');
		if (!(await professionalLinkedToPatient(admin, scope.businessId, scope.professionalId, String(data.patient_id))))
			throw new FollowUpError('FOLLOWUP_FORBIDDEN');
	}
	return data;
};

export const isStaleFollowUpUpdatedAt = (
	expected: string | null | undefined,
	current: string | null | undefined,
	toleranceMs = 1000
): boolean => {
	const trimmedExpected = typeof expected === 'string' ? expected.trim() : '';
	const trimmedCurrent = typeof current === 'string' ? current.trim() : '';
	if (!trimmedExpected || !trimmedCurrent) return true;
	if (trimmedExpected === trimmedCurrent) return false;

	const expectedMs = Date.parse(trimmedExpected);
	const currentMs = Date.parse(trimmedCurrent);
	if (!Number.isFinite(expectedMs) || !Number.isFinite(currentMs)) {
		return trimmedExpected !== trimmedCurrent;
	}

	return Math.abs(currentMs - expectedMs) > toleranceMs;
};

export const assertExpectedFollowUpVersion = (
	expectedUpdatedAt: string | null | undefined,
	existing: any
) => {
	if (isStaleFollowUpUpdatedAt(expectedUpdatedAt, existing?.updated_at)) {
		throw new FollowUpError('FOLLOWUP_STATUS_CONFLICT');
	}
};

export const markFollowUpDone = async (
	admin: SupabaseClient,
	args: RoleScope & { id: string; expectedUpdatedAt: string | null }
): Promise<void> => {
	const existing = await loadScopedPendingFollowUp(admin, args, args.id);
	assertExpectedFollowUpVersion(args.expectedUpdatedAt, existing);
	const { data: changed, error } = await admin
		.from('follow_ups')
		.update({ status: 'done', done_at: new Date().toISOString() })
		.eq('business_id', args.businessId)
		.eq('id', args.id)
		.eq('status', 'pending')
		.eq('updated_at', String(existing.updated_at))
		.select('id')
		.maybeSingle();
	if (error) throw error;
	if (!changed) throw new FollowUpError('FOLLOWUP_STATUS_CONFLICT');
};

export const snoozeFollowUp = async (
	admin: SupabaseClient,
	args: RoleScope & {
		id: string;
		newRemindOn: string;
		timezone: string;
		expectedUpdatedAt: string | null;
	}
): Promise<void> => {
	const today = businessTodayISO(args.timezone);
	const remindOn = (args.newRemindOn ?? '').trim();
	// Snooze siempre a FUTURO (sale de "ejecutándose").
	if (!isValidISODate(remindOn) || remindOn <= today) throw new FollowUpError('FOLLOWUP_INVALID_DATE');
	const existing = await loadScopedPendingFollowUp(admin, args, args.id);
	assertExpectedFollowUpVersion(args.expectedUpdatedAt, existing);
	const { data: changed, error } = await admin
		.from('follow_ups')
		.update({ remind_on: remindOn })
		.eq('business_id', args.businessId)
		.eq('id', args.id)
		.eq('status', 'pending')
		.eq('updated_at', String(existing.updated_at))
		.select('id')
		.maybeSingle();
	if (error) throw error;
	if (!changed) throw new FollowUpError('FOLLOWUP_STATUS_CONFLICT');
};

/** Editar un seguimiento pendiente: fecha, mensaje y (si corresponde) asignación. El paciente no cambia. */
export const updateFollowUp = async (
	admin: SupabaseClient,
	args: RoleScope & {
		id: string;
		remindOn: string;
		message: string | null;
		assignToProfessionalId: string | null;
		timezone: string;
		expectedUpdatedAt: string | null;
	}
): Promise<void> => {
	const existing = await loadScopedPendingFollowUp(admin, args, args.id);
	assertExpectedFollowUpVersion(args.expectedUpdatedAt, existing);

	const today = businessTodayISO(args.timezone);
	const remindOn = (args.remindOn ?? '').trim();
	if (!isValidISODate(remindOn) || remindOn < today) throw new FollowUpError('FOLLOWUP_INVALID_DATE');

	const message = (args.message ?? '').trim();
	if (message.length > 500) throw new FollowUpError('FOLLOWUP_MESSAGE_TOO_LONG');

	let assignedProfessionalId: string;
	if (args.role === 'professional') {
		if (!args.professionalId) throw new FollowUpError('FOLLOWUP_PROFESSIONAL_PROFILE_REQUIRED');
		assignedProfessionalId = args.professionalId;
	} else {
		const assignTo = (args.assignToProfessionalId ?? '').trim();
		if (!assignTo) throw new FollowUpError('FOLLOWUP_ASSIGN_REQUIRED');
		if (!(await professionalCanReceiveFollowUp(admin, args.businessId, assignTo, String(existing.patient_id))))
			throw new FollowUpError('FOLLOWUP_PROFESSIONAL_NOT_LINKED');
		assignedProfessionalId = assignTo;
	}

	const { data: changed, error } = await admin
		.from('follow_ups')
		.update({
			remind_on: remindOn,
			message: message || null,
			assigned_professional_id: assignedProfessionalId
		})
		.eq('business_id', args.businessId)
		.eq('id', args.id)
		.eq('status', 'pending')
		.eq('updated_at', String(existing.updated_at))
		.select('id')
		.maybeSingle();
	if (error) throw error;
	if (!changed) throw new FollowUpError('FOLLOWUP_STATUS_CONFLICT');
};

/** ¿El profesional tiene seguimientos asociados (cualquier estado)? Para el guard de borrado. */
export const professionalHasFollowUps = async (
	admin: SupabaseClient,
	businessId: string,
	professionalId: string
): Promise<number> => {
	const { count, error } = await admin
		.from('follow_ups')
		.select('id', { count: 'exact', head: true })
		.eq('business_id', businessId)
		.eq('assigned_professional_id', professionalId);
	if (error) throw error;
	return count ?? 0;
};
