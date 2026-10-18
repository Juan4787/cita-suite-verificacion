export type PatientFailureKind = 'invalid' | 'forbidden' | 'missing' | 'conflict' | 'unavailable';
import type { PatientFailureFeedback } from '$lib/patients/contracts';

/** Domain failure; routes decide how to represent it over HTTP. */
export class PatientOperationError extends Error {
	readonly kind: PatientFailureKind;
	readonly feedback: PatientFailureFeedback;
	constructor(kind: PatientFailureKind, message: string, feedback: PatientFailureFeedback = {}) {
		super(message);
		this.name = 'PatientOperationError';
		this.kind = kind;
		this.feedback = feedback;
	}
}

export const COMMERCIAL_RESTRICTED_MESSAGE =
	'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
