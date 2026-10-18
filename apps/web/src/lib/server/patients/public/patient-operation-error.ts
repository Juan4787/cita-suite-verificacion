export type PatientFailureKind = 'invalid' | 'forbidden' | 'missing' | 'conflict' | 'unavailable';

/** Domain failure; routes decide how to represent it over HTTP. */
export class PatientOperationError extends Error {
 readonly kind: PatientFailureKind;
 constructor(kind: PatientFailureKind, message: string) {
  super(message); this.name = 'PatientOperationError'; this.kind = kind;
 }
}

export const COMMERCIAL_RESTRICTED_MESSAGE =
 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
