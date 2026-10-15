export const CLINICAL_ENTRY_TYPES = [
	'Consulta',
	'Diagnóstico',
	'Tratamiento',
	'Procedimiento',
	'Evolución',
	'Indicaciones',
	'Nota interna'
] as const;

export const CASE_STATUS = [
	'Nuevo',
	'En curso',
	'Pendiente docs',
	'Presentado',
	'Resuelto',
	'Cerrado'
] as const;

export const CASE_EVENT_TYPES = [
	'Llamada',
	'Presentación',
	'Rechazo',
	'Requerimiento',
	'Envío docs',
	'Visita',
	'Nota'
] as const;

export const PUBLIC_SITE_URL_FALLBACK = 'https://app.cita-suite.workers.dev';
