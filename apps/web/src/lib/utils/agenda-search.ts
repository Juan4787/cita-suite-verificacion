import { isUpcomingActiveAppointment } from './appointment-visibility';

// Semantica compartida entre la precarga del navegador y la busqueda
// autoritativa de la base: nombre por prefijo (sin distinguir acentos) o
// telefono por digitos contenidos.
const MIN_PHONE_DIGITS = 2;

export type AgendaSearchPatient = {
	full_name: string | null;
	phone_e164: string | null;
};

export type AgendaSearchAppointment = {
	starts_at?: string | null;
	status?: unknown;
	patients?: AgendaSearchPatient | null;
};

export const normalizeSearchText = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/\s+/g, ' ');

export const patientMatchesAgendaQuery = (patient: AgendaSearchPatient, rawQuery: string) => {
	const query = normalizeSearchText(rawQuery);
	if (!query) return false;

	const name = normalizeSearchText(String(patient.full_name ?? ''));
	if (name.startsWith(query)) return true;
	if (name.split(' ').some((word) => word.startsWith(query))) return true;

	const queryDigits = rawQuery.replace(/\D/g, '');
	if (queryDigits.length >= MIN_PHONE_DIGITS) {
		const phoneDigits = String(patient.phone_e164 ?? '').replace(/\D/g, '');
		if (phoneDigits.includes(queryDigits)) return true;
	}

	return false;
};

export const filterAgendaAppointmentsByQuery = <T extends AgendaSearchAppointment>(
	appointments: readonly T[],
	rawQuery: string,
	limit = 60
) => {
	if (!normalizeSearchText(rawQuery) || limit <= 0) return [];
	const matches: T[] = [];
	for (const appointment of appointments) {
		if (!appointment.patients || !patientMatchesAgendaQuery(appointment.patients, rawQuery)) {
			continue;
		}
		matches.push(appointment);
		if (matches.length >= limit) break;
	}
	return matches;
};

export const filterAgendaAppointmentSnapshot = <T extends AgendaSearchAppointment>(
	appointments: readonly T[],
	rawQuery: string,
	limit = 60,
	now: Date = new Date()
) => {
	if (!normalizeSearchText(rawQuery) || limit <= 0) return [];
	const matches: T[] = [];
	for (const appointment of appointments) {
		if (!isUpcomingActiveAppointment(appointment, now)) continue;
		if (!appointment.patients || !patientMatchesAgendaQuery(appointment.patients, rawQuery)) {
			continue;
		}
		matches.push(appointment);
		if (matches.length >= limit) break;
	}
	return matches;
};
