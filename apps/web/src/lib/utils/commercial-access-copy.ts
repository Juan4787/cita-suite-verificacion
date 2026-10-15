const STALE_INITIAL_ACTIVATION_NOTES = new Set([
	'cuenta pendiente de activación de suscripción.',
	'suscripción pendiente de configuración explícita desde panel maestro.'
]);

export const visibleCommercialAccessNote = (
	note: string | null | undefined,
	canUseBusiness: boolean
): string | null => {
	const trimmed = String(note ?? '').trim();
	if (!trimmed) return null;
	if (canUseBusiness && STALE_INITIAL_ACTIVATION_NOTES.has(trimmed.toLocaleLowerCase('es'))) {
		return null;
	}
	return trimmed;
};

export const defaultManualAccessNote = (operation: string): string | null => {
	if (operation === 'grant_access') return 'Acceso habilitado manualmente por el administrador.';
	if (operation === 'extend_access') return 'Acceso extendido manualmente por el administrador.';
	if (operation === 'set_permanent') return 'Acceso permanente habilitado manualmente por el administrador.';
	if (operation === 'unset_permanent') return 'Acceso permanente quitado manualmente por el administrador.';
	if (operation === 'disable_business_access') return 'Acceso pausado manualmente por el administrador.';
	if (operation === 'enable_business_access') return 'Acceso reanudado manualmente por el administrador.';
	if (operation === 'archive_business') return 'Consultorio archivado manualmente por el administrador.';
	if (operation === 'reactivate_business') return 'Consultorio reactivado manualmente por el administrador.';
	return null;
};
