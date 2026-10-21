import type { CitaSupabaseClient, CitaRow } from '$lib/types/database';
import { readArray, readChoice, readRecord, readText } from '$lib/contracts/json';
import type { BusinessRole } from '$lib/server/access/public/business';
import { ilikeContains } from '$lib/server/platform/postgrest-filters';
import { zonedDate } from '$lib/availability/calculate';

// Seguimientos: recordar volver a contactar a un paciente. Sin recurrencia.
// Visibilidad por rol de sistema; asignación a un perfil profesional atendible.
// Las reglas viven en la base: las lecturas pasan por RLS y cada cambio por su
// función SQL, que comprueba actor, vínculo, operación y versión en una transacción.

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
		case 'FOLLOWUP_ACCESS_EXPIRED':
			return 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a operar.';
		case 'FOLLOWUP_STATUS_CONFLICT':
			return 'El seguimiento cambió mientras lo estabas actualizando y no sobrescribimos ese cambio. Recargá la lista para ver el estado actual.';
		default:
			return 'No pudimos completar este seguimiento. Recargá la lista y volvé a intentar.';
	}
};

export const getFollowUpErrorStatus = (code: string): number => {
	if (code === 'FOLLOWUP_FORBIDDEN' || code === 'FOLLOWUP_ACCESS_EXPIRED') return 403;
	if (code === 'FOLLOWUP_NOT_FOUND') return 404;
	if (code === 'FOLLOWUP_STATUS_CONFLICT') return 409;
	return 400;
};

// ---------- Helpers puros (testeables, sin DB) ----------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Día local del negocio como YYYY-MM-DD; nunca la zona del servidor. */
export const businessTodayISO = (timezone: string, now: Date = new Date()): string => zonedDate(now, timezone);

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

// ---------- Acceso a datos (cliente del usuario; reglas en la base) ----------

/** Lo que las lecturas necesitan del consultorio activo. */
export type FollowUpBusiness = { businessId: string; timezone: string };

/** Las listas muestran hasta este número; el total dice cuántos hay. */
export const FOLLOW_UP_LIST_LIMIT = 300;

export type FollowUpList = { items: FollowUpListItem[]; total: number };

const FOLLOWUP_SELECT =
	'id, patient_id, message, remind_on, assigned_professional_id, updated_at, patients(full_name)';

type FollowUpResult = Pick<CitaRow<'follow_ups'>, 'id' | 'patient_id' | 'message' | 'remind_on' | 'assigned_professional_id' | 'updated_at'> & { patients: { full_name: string } | null };

const mapRow = (row: FollowUpResult): FollowUpListItem => ({
	id: String(row.id),
	patient_id: String(row.patient_id),
	patient_name: String(row?.patients?.full_name ?? 'Paciente'),
	message: row.message ?? null,
	remind_on: String(row.remind_on),
	assigned_professional_id: row.assigned_professional_id ? String(row.assigned_professional_id) : null,
	updated_at: String(row.updated_at)
});

const FOLLOW_UP_ERROR_CODES = [
	'FOLLOWUP_INVALID_DATE', 'FOLLOWUP_MESSAGE_TOO_LONG', 'FOLLOWUP_PATIENT_NOT_FOUND', 'FOLLOWUP_PATIENT_NOT_YOURS',
	'FOLLOWUP_PROFESSIONAL_PROFILE_REQUIRED', 'FOLLOWUP_ASSIGN_REQUIRED', 'FOLLOWUP_PROFESSIONAL_NOT_LINKED',
	'FOLLOWUP_NOT_FOUND', 'FOLLOWUP_FORBIDDEN', 'FOLLOWUP_ACCESS_EXPIRED', 'FOLLOWUP_STATUS_CONFLICT'
] as const;

/** Un rechazo de las funciones SQL llega como su código; cualquier otro error sigue siendo un error. */
const followUpFailure = (error: { message?: string | null }) => {
	const code = FOLLOW_UP_ERROR_CODES.find((candidate) => String(error.message ?? '').includes(candidate));
	return code ? new FollowUpError(code) : error;
};

/** Las filas que el usuario puede leer ya vienen filtradas por la base, antes del límite. */
const listPending = async (
	supabase: CitaSupabaseClient,
	business: FollowUpBusiness,
	when: 'executing' | 'programmed'
): Promise<FollowUpList> => {
	const today = businessTodayISO(business.timezone);
	const pending = supabase
		.from('follow_ups')
		.select(FOLLOWUP_SELECT, { count: 'exact' })
		.eq('business_id', business.businessId)
		.eq('status', 'pending');
	const { data, count, error } = await (when === 'executing' ? pending.lte('remind_on', today) : pending.gt('remind_on', today))
		.order('remind_on', { ascending: true })
		.order('id', { ascending: true })
		.limit(FOLLOW_UP_LIST_LIMIT);
	if (error) throw error;
	const items = (data ?? []).map(mapRow);
	return { items, total: count ?? items.length };
};

/** Ejecutándose: pendientes con fecha hasta hoy. */
export const listExecutingFollowUps = (supabase: CitaSupabaseClient, business: FollowUpBusiness) =>
	listPending(supabase, business, 'executing');

/** Programados: pendientes con fecha futura. */
export const listProgrammedFollowUps = (supabase: CitaSupabaseClient, business: FollowUpBusiness) =>
	listPending(supabase, business, 'programmed');

export const getNoticeSummary = async (
	supabase: CitaSupabaseClient,
	business: FollowUpBusiness
): Promise<FollowUpNotice> => {
	const today = businessTodayISO(business.timezone);
	const { data, count, error } = await supabase
		.from('follow_ups')
		.select('id', { count: 'exact' })
		.eq('business_id', business.businessId)
		.eq('status', 'pending')
		.lte('remind_on', today)
		.order('remind_on', { ascending: true })
		.order('id', { ascending: true })
		.limit(FOLLOW_UP_LIST_LIMIT);
	if (error) throw error;
	const identityIds = (data ?? []).map((row) => String(row.id));
	const total = count ?? identityIds.length;
	if (total !== 1 || identityIds.length !== 1) return buildNotice([], total, identityIds);

	const { data: singleRow, error: singleError } = await supabase
		.from('follow_ups')
		.select(FOLLOWUP_SELECT)
		.eq('business_id', business.businessId)
		.eq('id', identityIds[0])
		.maybeSingle();
	if (singleError) throw singleError;
	return buildNotice(singleRow ? [mapRow(singleRow)] : [], singleRow ? total : 0, identityIds);
};

/** Selector de asignación: vinculados al paciente + dueños/admins atendibles. */
export const listAssignableProfessionalsForPatient = async (
	supabase: CitaSupabaseClient,
	businessId: string,
	patientId: string
): Promise<AssignableProfessional[]> => {
	const { data, error } = await supabase.rpc('list_follow_up_assignable_professionals', {
		p_business_id: businessId,
		p_patient_id: patientId
	});
	if (error) throw followUpFailure(error);
	const rows = readArray(data, 'followUp.assignableProfessionals').map((value) => {
		const row = readRecord(value, 'followUp.assignableProfessional');
		return {
			id: readText(row.id, 'followUp.assignableProfessional.id'),
			name: readText(row.name, 'followUp.assignableProfessional.name'),
			source: readChoice(row.source, ['patient_link', 'owner_admin_attending'] as const, 'followUp.assignableProfessional.source')
		};
	});
	return mergeAssignableProfessionals(
		rows.filter((row) => row.source === 'patient_link').sort((a, b) => a.name.localeCompare(b.name, 'es')),
		rows.filter((row) => row.source === 'owner_admin_attending').sort((a, b) => a.name.localeCompare(b.name, 'es'))
	);
};

const cleanQuery = (value: string) => value.trim().replace(/\s+/g, ' ');

export type PatientSearchResult = { id: string; full_name: string; phone_e164: string | null };

/** Búsqueda de pacientes para asignar: la base muestra a cada rol los pacientes que puede leer. */
export const listAssignablePatientsSearch = async (
	supabase: CitaSupabaseClient,
	businessId: string,
	rawQuery: string
): Promise<PatientSearchResult[]> => {
	const query = cleanQuery(rawQuery);
	if (query.length < 2) return [];
	const digits = query.replace(/\D/g, '');
	const filters = [ilikeContains('full_name', query), ilikeContains('phone_e164', query), ilikeContains('dni', query)];
	if (digits.length >= 3) filters.push(ilikeContains('phone_e164', digits));
	const { data, error } = await supabase
		.from('patients')
		.select('id, full_name, phone_e164')
		.eq('business_id', businessId)
		.is('archived_at', null)
		.or(filters.join(','))
		.order('updated_at', { ascending: false })
		.limit(12);
	if (error) throw error;
	return (data ?? []).map((p) => ({
		id: String(p.id),
		full_name: String(p.full_name),
		phone_e164: p.phone_e164 ?? null
	}));
};

export type CreateFollowUpInput = {
	businessId: string;
	patientId: string;
	remindOn: string;
	message: string | null;
	assignToProfessionalId: string | null;
};

/** La base decide la asignación: un profesional se asigna a sí mismo. */
export const createFollowUp = async (supabase: CitaSupabaseClient, input: CreateFollowUpInput): Promise<string> => {
	const remindOn = (input.remindOn ?? '').trim();
	if (!isValidISODate(remindOn)) throw new FollowUpError('FOLLOWUP_INVALID_DATE');
	const { data, error } = await supabase.rpc('create_follow_up', {
		p_business_id: input.businessId,
		p_patient_id: input.patientId,
		p_remind_on: remindOn,
		p_message: input.message ?? '',
		...(input.assignToProfessionalId ? { p_assigned_professional_id: input.assignToProfessionalId } : {})
	});
	if (error) throw followUpFailure(error);
	return readText(data, 'followUp.created');
};

/** Una acción sobre un seguimiento lleva la versión que el usuario vio. */
export type FollowUpChange = { businessId: string; id: string; expectedUpdatedAt: string | null };

const changeResult = (error: { message?: string | null } | null) => {
	if (error) throw followUpFailure(error);
};

export const markFollowUpDone = async (supabase: CitaSupabaseClient, change: FollowUpChange): Promise<void> => {
	if (!change.expectedUpdatedAt) throw new FollowUpError('FOLLOWUP_STATUS_CONFLICT');
	const { error } = await supabase.rpc('complete_follow_up', {
		p_business_id: change.businessId,
		p_follow_up_id: change.id,
		p_expected_updated_at: change.expectedUpdatedAt
	});
	changeResult(error);
};

/** Posponer siempre lleva el seguimiento a un día futuro (sale de "ejecutándose"). */
export const snoozeFollowUp = async (
	supabase: CitaSupabaseClient,
	change: FollowUpChange & { newRemindOn: string }
): Promise<void> => {
	const remindOn = (change.newRemindOn ?? '').trim();
	if (!isValidISODate(remindOn)) throw new FollowUpError('FOLLOWUP_INVALID_DATE');
	if (!change.expectedUpdatedAt) throw new FollowUpError('FOLLOWUP_STATUS_CONFLICT');
	const { error } = await supabase.rpc('snooze_follow_up', {
		p_business_id: change.businessId,
		p_follow_up_id: change.id,
		p_expected_updated_at: change.expectedUpdatedAt,
		p_remind_on: remindOn
	});
	changeResult(error);
};

/** Editar un seguimiento pendiente: fecha, mensaje y (si corresponde) asignación. El paciente no cambia. */
export const updateFollowUp = async (
	supabase: CitaSupabaseClient,
	change: FollowUpChange & { remindOn: string; message: string | null; assignToProfessionalId: string | null }
): Promise<void> => {
	const remindOn = (change.remindOn ?? '').trim();
	if (!isValidISODate(remindOn)) throw new FollowUpError('FOLLOWUP_INVALID_DATE');
	if (!change.expectedUpdatedAt) throw new FollowUpError('FOLLOWUP_STATUS_CONFLICT');
	const { error } = await supabase.rpc('update_follow_up', {
		p_business_id: change.businessId,
		p_follow_up_id: change.id,
		p_expected_updated_at: change.expectedUpdatedAt,
		p_remind_on: remindOn,
		p_message: change.message ?? '',
		...(change.assignToProfessionalId ? { p_assigned_professional_id: change.assignToProfessionalId } : {})
	});
	changeResult(error);
};
