import { isUuid } from '@cita-suite/shared/uuid';
import { InvalidDataContractError, readArray, readChoice, readRecord, readText } from '$lib/contracts/json';
import { formatInTimeZone } from '$lib/utils/format';
import { zonedDate } from '$lib/availability/calculate';

export const SLOT_RELEASE_REASONS = {
 patient_cancelled: 'Canceló la persona',
 practice_cancelled: 'Canceló el consultorio',
 deposit_expired: 'Venció la seña',
 rescheduled: 'Se reprogramó'
} as const;
const REASONS = ['patient_cancelled', 'practice_cancelled', 'deposit_expired', 'rescheduled'] as const;
export type SlotRelease = {
 id: string; appointmentId: string; professionalId: string; serviceId: string; professionalName: string;
 startsAt: string; endsAt: string; releasedAt: string; reason: keyof typeof SLOT_RELEASE_REASONS;
};
export type SlotReleaseWindow = { days: number; page: number; offset: number };
export type SlotReleaseListView = { items: SlotRelease[] | null; days: number; page: number; truncated: boolean };
export const SLOT_RELEASE_PAGE_SIZE = 50;
export const slotReleaseWindow = (params: URLSearchParams): SlotReleaseWindow => {
 const integer = (key: string, fallback: number, max: number) => {
  const raw = params.get(key) ?? '';
  const value = /^\d{1,4}$/.test(raw) ? Number(raw) : 0;
  return value >= 1 && value <= max ? value : fallback;
 };
 const days = integer('dias_liberados', 14, 60);
 const page = integer('pagina_liberados', 1, 1001);
 return { days, page, offset: (page - 1) * SLOT_RELEASE_PAGE_SIZE };
};
const uuid = (value: unknown, field: string) => {
 const text = readText(value, field);
 if (!isUuid(text)) throw new InvalidDataContractError(field);
 return text;
};
const instant = (value: unknown, field: string) => {
 const text = readText(value, field);
 if (!Number.isFinite(Date.parse(text))) throw new InvalidDataContractError(field);
 return text;
};
export const parseSlotReleaseRows = (value: unknown): SlotRelease[] => {
 const rows = readArray(value, 'slotReleases');
 if (rows.length > SLOT_RELEASE_PAGE_SIZE + 1) throw new InvalidDataContractError('slotReleases.limit');
 const ids = new Set<string>();
 return rows.map(value => {
  const row = readRecord(value, 'slotRelease');
  const id = uuid(row.id, 'slotRelease.id');
  if (ids.has(id)) throw new InvalidDataContractError('slotRelease.duplicate');
  ids.add(id);
  const startsAt = instant(row.starts_at, 'slotRelease.startsAt');
  const endsAt = instant(row.ends_at, 'slotRelease.endsAt');
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new InvalidDataContractError('slotRelease.interval');
  return { id, startsAt, endsAt,
   appointmentId: uuid(row.appointment_id, 'slotRelease.appointmentId'),
   professionalId: uuid(row.professional_id, 'slotRelease.professionalId'),
   serviceId: uuid(row.service_id, 'slotRelease.serviceId'),
   professionalName: readText(row.professional_name, 'slotRelease.professionalName'),
   releasedAt: instant(row.released_at, 'slotRelease.releasedAt'),
   reason: readChoice(row.reason, REASONS, 'slotRelease.reason')
  };
 });
};
export const slotReleaseHref = (release: SlotRelease, timezone: string): string => {
 const query = new URLSearchParams({ date: zonedDate(new Date(release.startsAt), timezone),
  professional_id: release.professionalId, service_id: release.serviceId,
  hora: formatInTimeZone(release.startsAt, timezone).timeLabel });
 return `/odonto/agenda?${query}`;
};
