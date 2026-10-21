import { isUuid } from '@cita-suite/shared/uuid';

type RestrictedClinicalReadContext = {
	role?: string | null;
	commercialStatus?: string | null;
	commercialAccessEnabled?: boolean | null;
	canEnterApp?: boolean | null;
};

const PATIENT_DETAIL_PREFIX = '/odonto/pacientes/';

/**
 * The restricted commercial window is read-only, not archived. Owners and
 * administrators keep a narrow path to existing patient files and trash;
 * every mutation remains guarded by server capabilities and database rules.
 */
export function allowsRestrictedClinicalRead(
	pathname: string,
	context: RestrictedClinicalReadContext
): boolean {
	if (context.role !== 'owner' && context.role !== 'admin') return false;
	if (context.commercialStatus !== 'restricted') return false;
	if (!context.commercialAccessEnabled || !context.canEnterApp) return false;

	return (
		pathname === '/odonto/exportar-datos' ||
		pathname === '/odonto/pacientes' ||
		pathname === '/odonto/pacientes/papelera' ||
		(pathname.startsWith(PATIENT_DETAIL_PREFIX) && isUuid(pathname.slice(PATIENT_DETAIL_PREFIX.length)))
	);
}
