// Compatibilidad para consumidores de servidor. La implementacion vive en
// utils porque el navegador usa exactamente la misma semantica al filtrar la
// precarga en memoria.
export {
	filterAgendaAppointmentSnapshot,
	filterAgendaAppointmentsByQuery,
	normalizeSearchText,
	patientMatchesAgendaQuery,
	type AgendaSearchAppointment,
	type AgendaSearchPatient
} from '$lib/utils/agenda-search';
