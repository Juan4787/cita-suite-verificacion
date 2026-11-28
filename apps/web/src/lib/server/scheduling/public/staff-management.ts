import { APPOINTMENT_STATUSES } from '@cita-suite/shared/appointment-status';
import { zonedDate, type AvailabilityBusiness } from '$lib/availability/calculate';
import { isAvailabilityDate } from '$lib/availability/windows';
import { InvalidDataContractError, readArray, readChoice, readRecord } from '$lib/contracts/json';
import type { CitaSupabaseClient } from '$lib/types/database';
import { getAvailabilitySelection } from './availability';
import { managementCounter, managementId, managementInstant, managementRevision,
 parseManagementResult, sameManagementInstant } from '../internal/management-contract';

const invalid = (): never => { throw new InvalidDataContractError('appointment.management'); };
type Business = AvailabilityBusiness & { id: string };

/** The displayed interval, team and semantic revision must share one snapshot.
 * No fallback from an incomplete team to a different availability scope. */
export const parseStaffManagementSelection = (value: unknown) => {
 const row = readRecord(value, 'appointment.management');
 const team = readArray(row.appointment_professionals, 'appointment.management.team').map(item => {
  const member = readRecord(item, 'appointment.management.member');
  return { id: managementId(member.professional_id), position: managementCounter(member.position, 0) };
 }).sort((a, b) => a.position - b.position);
 const primary = managementId(row.professional_id);
 if (!team.length || team.length > 100 || new Set(team.map(member => member.id)).size !== team.length || !team.some(member => member.id === primary)) return invalid();
 return { id: managementId(row.id), serviceId: managementId(row.service_id), professionalIds: team.map(member => member.id),
  startsAt: managementInstant(row.starts_at), endsAt: managementInstant(row.ends_at),
  status: readChoice(row.status, APPOINTMENT_STATUSES, 'appointment.management.status'),
  revision: managementRevision(row.appointment_management_revision) };
};
export type StaffManagementSelection = ReturnType<typeof parseStaffManagementSelection>;

export const loadStaffManagementSelection = async (reader: CitaSupabaseClient, businessId: string, appointmentId: string) => {
 managementId(businessId); managementId(appointmentId);
 const { data, error } = await reader.from('appointments')
  .select('id, service_id, professional_id, starts_at, ends_at, status, appointment_management_revision, appointment_professionals(professional_id, position)')
  .eq('business_id', businessId).eq('id', appointmentId).maybeSingle();
 if (error) throw error;
 if (!data) throw new Error('APPOINTMENT_NOT_FOUND');
 return parseStaffManagementSelection(data);
};

export const listStaffManagementSlots = async (reader: CitaSupabaseClient, business: Business,
 appointment: StaffManagementSelection, date: string, ignoreBreak: boolean) => {
 if (!isAvailabilityDate(date) || typeof ignoreBreak !== 'boolean') return invalid();
 if (appointment.status === 'cancelled') throw new Error('APPOINTMENT_CANNOT_RESCHEDULE');
 const selected = await getAvailabilitySelection(reader, { business, readScope: 'internal', publicOnly: false,
  serviceId: appointment.serviceId, professionalIds: appointment.professionalIds,
  fromDate: date, toDate: date, excludeAppointmentId: appointment.id, ignoreBreak });
 if (selected.availabilityRevision === null || selected.durationMinutes === null) throw new Error('APPOINTMENT_AVAILABILITY_CHANGED');
 return selected;
};

export type StaffRescheduleRequester = 'patient' | 'practice_or_force_majeure';

export type StaffManagementCommand = {
 business: Business; actorId: string; appointmentId: string; operationId: string; expectedRevision: string;
 action: 'cancel' | 'confirm' | 'request_reschedule' | 'reschedule';
 startsAt?: string | null; availabilityRevision?: number | null; ignoreBreak?: boolean; reason?: string | null;
 keepDepositAsCredit?: boolean;
 rescheduleRequester?: StaffRescheduleRequester | null;
};

/** Only the backend may dispatch: actor/tenant come from the verified session.
 * SQL rechecks authority, identity and the original expectation under its locks.
 * Recovery precedes mutable preflight and never creates an absent operation. */
export const applyStaffManagementCommand = async (writer: CitaSupabaseClient, reader: CitaSupabaseClient, input: StaffManagementCommand) => {
 managementId(input.business.id); managementId(input.actorId); managementId(input.appointmentId);
 managementId(input.operationId); managementRevision(input.expectedRevision);
 const moving = input.action === 'reschedule';
 const keepCredit = input.keepDepositAsCredit === true;
 const requester = input.rescheduleRequester ?? null;
 if (!['cancel', 'confirm', 'request_reschedule', 'reschedule'].includes(input.action) ||
  (input.ignoreBreak !== undefined && typeof input.ignoreBreak !== 'boolean') ||
  (input.keepDepositAsCredit !== undefined && typeof input.keepDepositAsCredit !== 'boolean') ||
  (requester !== null && requester !== 'patient' && requester !== 'practice_or_force_majeure') ||
  (keepCredit && input.action !== 'cancel') ||
  (requester !== null && !moving) ||
  (input.reason != null && (typeof input.reason !== 'string' || input.reason.length > 500)) ||
  (!moving && (input.startsAt != null || input.availabilityRevision != null || input.ignoreBreak === true)) ||
  (moving && input.reason != null)) return invalid();
 const startsAt = moving ? managementInstant(input.startsAt) : null;
 const args = { p_business_id: input.business.id, p_actor_id: input.actorId, p_appointment_id: input.appointmentId,
  p_operation_id: input.operationId, p_expected_revision: input.expectedRevision, p_action: input.action,
  p_starts_at: startsAt, p_ignore_break: input.ignoreBreak ?? false,
  p_availability_revision: moving ? managementCounter(input.availabilityRevision) : null, p_reason: input.reason ?? null };
 const useDecisionRpc = keepCredit || requester !== null;
 const dispatch = (replayOnly: boolean) =>
  useDecisionRpc
   ? writer.rpc('apply_staff_appointment_management_with_deposit_decision', {
      ...args,
      p_replay_only: replayOnly,
      p_keep_deposit_as_credit: keepCredit,
      p_reschedule_requester: requester
     })
   : writer.rpc('apply_staff_appointment_management', { ...args, p_replay_only: replayOnly });
 const recovered = await dispatch(true);
 if (recovered.error) throw recovered.error;
 if (recovered.data !== null) return parseManagementResult(recovered.data);
 if (moving) {
  const appointment = await loadStaffManagementSelection(reader, input.business.id, input.appointmentId);
  if (appointment.revision !== input.expectedRevision) throw new Error('APPOINTMENT_MANAGEMENT_CHANGED');
  if (!sameManagementInstant(startsAt!, appointment.startsAt)) {
   const date = zonedDate(new Date(startsAt!), input.business.timezone);
   const selection = await listStaffManagementSlots(reader, input.business, appointment, date, args.p_ignore_break);
   if (selection.availabilityRevision !== args.p_availability_revision) throw new Error('APPOINTMENT_AVAILABILITY_CHANGED');
   if (!selection.slots.some(slot => sameManagementInstant(slot.starts_at, startsAt!))) throw new Error('APPOINTMENT_SLOT_UNAVAILABLE');
  }
 }
 const { data, error } = await dispatch(false);
 if (error) throw error;
 return parseManagementResult(data);
};
