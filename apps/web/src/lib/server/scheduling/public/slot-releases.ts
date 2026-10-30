import type { CitaSupabaseClient } from '$lib/types/database';
import { isRecord, InvalidDataContractError } from '$lib/contracts/json';
import { parseSlotReleaseRows, SLOT_RELEASE_PAGE_SIZE, type SlotReleaseWindow } from '$lib/scheduling/slot-releases';

export const loadAppointmentSlotReleases = async (supabase: CitaSupabaseClient, businessId: string, window: SlotReleaseWindow) => {
 if (!Number.isInteger(window.days) || window.days < 1 || window.days > 60 || !Number.isInteger(window.page)
  || window.page < 1 || window.page > 1001 || window.offset !== (window.page - 1) * SLOT_RELEASE_PAGE_SIZE) {
  throw new Error('SLOT_RELEASE_WINDOW_INVALID');
 }
 const { data, error } = await supabase.rpc('get_appointment_slot_releases', {
  p_business_id: businessId, p_days: window.days, p_limit: SLOT_RELEASE_PAGE_SIZE + 1, p_offset: window.offset
 });
 if (error) throw error;
 const rows = parseSlotReleaseRows(data);
 return { items: rows.slice(0, SLOT_RELEASE_PAGE_SIZE), truncated: rows.length > SLOT_RELEASE_PAGE_SIZE };
};
export const hideAppointmentSlotRelease = async (supabase: CitaSupabaseClient, businessId: string, releaseId: string): Promise<boolean> => {
 const { data, error } = await supabase.rpc('hide_appointment_slot_release', { p_business_id: businessId, p_release_id: releaseId });
 if (error) throw error;
 if (typeof data !== 'boolean') throw new InvalidDataContractError('hideSlotRelease.result');
 return data;
};
const code = (cause: unknown) => {
 const message = cause instanceof Error ? cause.message : isRecord(cause) && typeof cause.message === 'string' ? cause.message : '';
 return ['SLOT_RELEASE_FORBIDDEN', 'SLOT_RELEASE_NOT_FOUND', 'SLOT_RELEASE_WINDOW_INVALID'].find(value => message.includes(value));
};
export const slotReleaseErrorMessage = (cause: unknown): string => {
 switch (code(cause)) {
  case 'SLOT_RELEASE_FORBIDDEN': return 'No tenés permiso para ocultar horarios en este consultorio.';
  case 'SLOT_RELEASE_NOT_FOUND': return 'Ese aviso ya no está disponible en este consultorio. Recargá la agenda.';
  case 'SLOT_RELEASE_WINDOW_INVALID': return 'No pudimos leer el rango de horarios. Volvé a abrir la agenda.';
  default: return 'No pudimos ocultar el aviso. Probá otra vez en unos segundos.';
 }
};
export const slotReleaseErrorStatus = (cause: unknown): 400 | 403 | 404 | 503 => {
 switch (code(cause)) {
  case 'SLOT_RELEASE_FORBIDDEN': return 403;
  case 'SLOT_RELEASE_NOT_FOUND': return 404;
  case 'SLOT_RELEASE_WINDOW_INVALID': return 400;
  default: return 503;
 }
};
