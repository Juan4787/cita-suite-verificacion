export type PatientExportPermissionContext = {
	role?: string | null;
	assistance?: unknown;
	access?: {
		canEnterApp?: boolean | null;
	} | null;
};

/**
 * Capacidad visual liviana. El backend y PostgreSQL repiten la autorizacion
 * con la membresia directa vigente en cada operacion.
 */
export const canExportPatientDataFromContext = (
	context: PatientExportPermissionContext | null | undefined
): boolean =>
	Boolean(
		context &&
			(context.role === 'owner' || context.role === 'admin') &&
			!context.assistance &&
			context.access?.canEnterApp
	);
