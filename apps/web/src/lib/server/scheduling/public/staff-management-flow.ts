import { isAvailabilityDate } from '$lib/availability/windows';
import { zonedDate } from '$lib/availability/calculate';
import { InvalidDataContractError } from '$lib/contracts/json';
import type { StaffManagementFeedback } from '$lib/scheduling/staff-management';
import type { CitaSupabaseClient } from '$lib/types/database';
import { logServerFailure } from '$lib/server/platform/logging';
import { ManagementResultUncertainError, managementCounter, managementInstant } from '../internal/management-contract';
import { getHumanAppointmentErrorMessage, rescheduleAppointment, updateAppointmentStatus, isAppointmentStatus } from './appointments';
import type { StaffManagementCommand } from './staff-management';

const field = (form: FormData, name: string): string => {
 const value = form.get(name);
 if (typeof value !== 'string') throw new InvalidDataContractError('appointment.management.form');
 return value;
};
export const submitStaffManagementAction = async (reader: CitaSupabaseClient,
 input: { writer: CitaSupabaseClient; business: StaffManagementCommand['business']; appointmentId: string; userId: string },
 action: 'update_status' | 'reschedule', form: FormData): Promise<StaffManagementFeedback & {
 result?: Awaited<ReturnType<typeof rescheduleAppointment>>;
}> => {
 let fields: Record<string, string> | undefined;
 try {
  const names = ['operation_id', 'expected_revision', ...(action === 'reschedule' ?
   ['slot_starts_at', 'availability_revision', 'ignore_break', 'reprogram_date'] : ['status', 'reason', 'confirm_cancel'])];
  fields = Object.fromEntries(names.map(name => [name, field(form, name)]));
  const rawRequester = action === 'reschedule' ? form.get('reschedule_requester') : null;
  const rawKeepCredit = action === 'update_status' ? form.get('keep_deposit_as_credit') : null;
  if (rawRequester !== null && (typeof rawRequester !== 'string' || !['', 'patient', 'practice_or_force_majeure'].includes(rawRequester))) {
   throw new InvalidDataContractError('appointment.management.form');
  }
  if (rawKeepCredit !== null && rawKeepCredit !== 'true' && rawKeepCredit !== 'false' && rawKeepCredit !== '') {
   throw new InvalidDataContractError('appointment.management.form');
  }
  if (typeof rawRequester === 'string' && rawRequester) fields.reschedule_requester = rawRequester;
  if (rawKeepCredit === 'true') fields.keep_deposit_as_credit = 'true';
  const observed = { ...input, operationId: fields.operation_id, expectedRevision: fields.expected_revision };
  let result;
  if (action === 'reschedule') {
   if (!isAvailabilityDate(fields.reprogram_date) || zonedDate(new Date(managementInstant(fields.slot_starts_at)), input.business.timezone) !== fields.reprogram_date ||
    !/^[1-9]\d{0,15}$/.test(fields.availability_revision) || !['true', 'false'].includes(fields.ignore_break))
    throw new InvalidDataContractError('appointment.management.form');
   const rescheduleRequester =
    rawRequester === 'patient' || rawRequester === 'practice_or_force_majeure' ? rawRequester : null;
   result = await rescheduleAppointment(reader, { ...observed, startsAt: fields.slot_starts_at,
    availabilityRevision: managementCounter(Number(fields.availability_revision)), ignoreBreak: fields.ignore_break === 'true',
    ...(rescheduleRequester ? { rescheduleRequester } : {}) });
  } else {
   if (!isAppointmentStatus(fields.status) || fields.status === 'confirmed' || fields.status === 'reserved' ||
    (fields.status === 'cancelled' && fields.confirm_cancel !== 'true')) throw new InvalidDataContractError('appointment.management.form');
   result = await updateAppointmentStatus(reader, { ...observed, status: fields.status, reason: fields.reason.trim() || null,
    ...(rawKeepCredit === 'true' ? { keepDepositAsCredit: true } : {}) });
  }
  return { success: true, result, message: result.idempotentReplay ? 'Esta acción ya estaba guardada. Revisá el estado actual del turno.' :
   !result.changed ? 'El turno ya tenía ese horario; no fue necesario modificarlo.' :
   action === 'reschedule' ? 'La reprogramación quedó registrada.' :
   result.status === 'cancelled' ? 'El turno quedó cancelado.' : 'El cambio del turno quedó registrado.' };
 } catch (error) {
  logServerFailure('Error en una acción del personal', error);
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  // Only an explicit domain/constraint rejection proves that this attempt did
  // not commit. Lost transport or unreadable replies retain the EXACT request.
  const rejected = !(error instanceof ManagementResultUncertainError) && (error instanceof InvalidDataContractError ||
   /^(APPOINTMENT_|DEPOSIT_|SERVICE_|SCHEDULE_|TEAM_|PROFESSIONAL_)/.test(raw) || ['23P01', '23514', '42501'].includes(code));
  return { success: false, message: error instanceof InvalidDataContractError ?
   'Revisá el turno y confirmá la acción desde su detalle antes de continuar.' : rejected ? getHumanAppointmentErrorMessage(error) :
   'No pudimos comprobar el resultado. Reintentá esta misma acción para consultar si quedó guardada.',
   retry: fields && !rejected ? { action, fields } : undefined };
 }
};
