import { dev } from '$app/environment';
import { BOOKING_THEMES, normalizeBookingOrigin, parseBookingIntakeFields, parseBookingModalityWindows } from '@turnos-saas/shared/booking-integration';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function bookingProfileConfig(form: FormData) {
  const name = String(form.get('name') ?? '').trim();
  const theme = String(form.get('theme') ?? 'cita-suite');
  const rawOrigins = form.getAll('origins').flatMap(value => String(value).split(/\r?\n/)).map(value => value.trim()).filter(Boolean);
  const origins = rawOrigins.map(value => normalizeBookingOrigin(value, dev));
  const professional_ids = form.getAll('professional_ids').map(String);
  const service_ids = form.getAll('service_ids').map(String);
  const schema = parseBookingIntakeFields(JSON.parse(String(form.get('intake_schema') ?? '[]')));
  const modality_windows = parseBookingModalityWindows(JSON.parse(String(form.get('modality_windows') ?? '[]')));
  if (!name || name.length > 120 || !BOOKING_THEMES.includes(theme as any) || origins.length > 20 || origins.some(value => !value) || new Set(origins).size !== origins.length ||
    professional_ids.length > 100 || service_ids.length > 500 || [...professional_ids, ...service_ids].some(v => !uuid.test(v))) throw new Error('Revisá el nombre, los sitios permitidos y las opciones seleccionadas.');
  return { name, theme, origins: origins as string[], professional_ids, service_ids, intake_schema: schema, modality_windows,
    modalities: form.get('video') === 'true' ? ['in_person', 'video'] : ['in_person'],
    video_instructions: String(form.get('video_instructions') ?? '').trim(), active: form.get('active') === 'true',
    default: form.get('default') === 'true' };
}
