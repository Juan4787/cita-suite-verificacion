import { randomUUID } from 'node:crypto';
import { ManagementResultUncertainError } from '../internal/management-contract';
import { isAvailabilityDate } from '$lib/availability/windows';
import { zonedDate } from '$lib/availability/calculate';
import { InvalidDataContractError } from '$lib/contracts/json';
import type { CitaSupabaseClient } from '$lib/types/database';
import type { PatientManagementFeedback, PatientManagementPanelData } from '$lib/scheduling/patient-management-page';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import { logServerFailure } from '$lib/server/platform/logging';
import {
 applyPatientManagementCommand, listPatientManagementSlots, loadPatientManagementView, patientManagementErrorMessage, sameManagementInstant,
 type PatientManagementAccess, type PatientManagementCommand
} from './patient-management';

export const loadPatientManagementScreen = async (client: CitaSupabaseClient, access: PatientManagementAccess, url: URL) => {
 const requestedStart = url.searchParams.get('horario');
 const target = requestedStart && requestedStart.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(requestedStart) &&
  isAvailabilityDate(requestedStart.slice(0, 10)) && Number.isFinite(Date.parse(requestedStart)) ? requestedStart : null;
 const view = await loadPatientManagementView(client, access, target);
 if (!view) return null;
 const { appointment } = view;
 const requestedDate = url.searchParams.get('fecha') ?? '';
 const date = isAvailabilityDate(requestedDate) ? requestedDate : zonedDate(new Date(view.now), appointment.business.timezone);
 const desired = url.searchParams.get('accion');
 const mode = desired === 'cancelar' && appointment.can_cancel ? 'cancel' :
  desired === 'reprogramar' && appointment.can_request_reschedule ? 'reschedule' : 'overview';
 const panel: PatientManagementPanelData = {
  url: `/${access.legacy ? 'turno' : 'gestion'}/${access.token}`, revision: view.revision, operationId: randomUUID(), mode,
  startsAt: appointment.starts_at, timezone: appointment.business.timezone, now: view.now,
  canCancel: appointment.can_cancel, canConfirm: appointment.can_confirm, canReschedule: appointment.can_request_reschedule,
  selfManagementCutoffHours: view.selfManagementCutoffHours ?? null,
  selfManagementCutoffAt: view.selfManagementCutoffAt ?? null,
  selfManagementWindowClosed: view.selfManagementWindowClosed === true,
  depositCreditCutoffHours: view.depositCreditCutoffHours ?? null,
  cancellationDepositOutcome: view.cancellationDepositOutcome ?? null,
  practicePhone: appointment.business.phone ?? null,
  date, slots: [], selectedStart: null, availabilityRevision: null, integrationRevision: view.integration?.revision ?? null,
  durationMinutes: view.durationMinutes, financialTerms: view.financialTerms, financialSummary: view.financialSummary, unavailableMessage: null
 };
 if (mode === 'reschedule') {
  try {
   const selection = await listPatientManagementSlots(client, view, date, date);
   panel.slots = selection.slots.filter(slot => !sameManagementInstant(slot.starts_at, appointment.starts_at))
    .map(slot => ({ starts_at: slot.starts_at, ends_at: slot.ends_at }));
   panel.availabilityRevision = selection.availabilityRevision;
   panel.selectedStart = target ? panel.slots.find(slot => sameManagementInstant(slot.starts_at, target))?.starts_at ?? null : null;
   // After saving, the page reloads with the same address: that time is now the appointment's own.
   const alreadyThere = target !== null && sameManagementInstant(target, appointment.starts_at);
   if (requestedStart && panel.selectedStart === null && !alreadyThere) panel.unavailableMessage = 'Ese horario no está disponible. Elegí otro; tu turno actual se conserva.';
  } catch (error) {
   logServerFailure('Error consultando horarios de autogestión', error);
   panel.unavailableMessage = 'No pudimos consultar los horarios. Tu turno se conserva; volvé a intentar en unos momentos.';
  }
 }
 return { view, panel };
};

type SubmissionResult = PatientManagementFeedback & { result?: Awaited<ReturnType<typeof applyPatientManagementCommand>> };
const field = (form: FormData, name: string): string => {
 const value = form.get(name);
 if (typeof value !== 'string') throw new Error('MANAGEMENT_FORM_INVALID');
 return value;
};
const numeric = (form: FormData, name: string): number => {
 const value = field(form, name);
 if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('MANAGEMENT_FORM_INVALID');
 return Number(value);
};

/** The action is fixed by the server route; identity always comes from its
 * explicit capability channel. No patient-supplied actor, tenant or exclusion.
 */
export const submitPatientManagementAction = async (client: CitaSupabaseClient, access: PatientManagementAccess,
 action: PatientManagementCommand['action'], request: Request): Promise<SubmissionResult> => {
 let submitted: Record<string, string> | undefined;
 try {
  const form = await readBoundedBookingForm(request, []);
  const allowed = new Set(['operation_id', 'expected_revision', ...(action === 'cancel' ? ['confirm_cancel'] : action === 'reschedule' ?
   ['starts_at', 'availability_revision', 'integration_revision', 'financial_terms'] : [])]);
  if ([...form.keys()].some(key => !allowed.has(key))) throw new Error('MANAGEMENT_FORM_INVALID');
  if (action === 'cancel' && form.get('confirm_cancel') !== 'true') throw new Error('MANAGEMENT_FORM_INVALID');
  const input: PatientManagementCommand = { action, operationId: field(form, 'operation_id'), expectedRevision: field(form, 'expected_revision') };
  if (action === 'reschedule') {
   const terms = field(form, 'financial_terms');
   if (terms.length > 8192) throw new Error('MANAGEMENT_FORM_INVALID');
   input.startsAt = field(form, 'starts_at'); input.availabilityRevision = numeric(form, 'availability_revision');
   input.integrationRevision = field(form, 'integration_revision') === '' ? null : numeric(form, 'integration_revision');
   input.financialTerms = JSON.parse(terms);
  }
  submitted = Object.fromEntries([...allowed].map(key => [key, field(form, key)]));
  const result = await applyPatientManagementCommand(client, access, input);
  const message = result.idempotentReplay ? 'Esta acción ya estaba guardada. Revisá el estado actual del turno.' :
   !result.changed ? 'Esta acción no necesitó cambios. Revisá el estado actual del turno.' :
   action === 'cancel' ? 'La cancelación quedó registrada.' : action === 'confirm' ? 'La confirmación quedó registrada.' : 'La reprogramación quedó registrada.';
  return { success: true, message, result };
 } catch (error) {
  logServerFailure('Error en una acción de autogestión', error);
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  const invalidForm = error instanceof InvalidDataContractError || error instanceof SyntaxError || /^(MANAGEMENT_FORM_INVALID|BOOKING_FORM_INVALID)$/.test(raw);
  const knownRejection = !(error instanceof ManagementResultUncertainError) && (invalidForm || raw.startsWith('APPOINTMENT_') ||
   (typeof error === 'object' && error !== null && 'code' in error && error.code === '23P01'));
  return { success: false, action, message: invalidForm ? 'Revisá el turno y sus condiciones antes de confirmar la acción.' : patientManagementErrorMessage(error),
   submitted, retrySameOperation: !!submitted && !knownRejection };
 }
};
