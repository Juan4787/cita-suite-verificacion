import { isUuid } from '@cita-suite/shared/uuid';
import { dev } from '$app/environment';
import { BOOKING_THEMES, normalizeBookingOrigin, parseBookingIntakeFields, parseBookingModalityWindows } from '@cita-suite/shared/booking-integration';

export function bookingProfileConfig(form: FormData) {
  const name = String(form.get('name') ?? '').trim();
  const theme = BOOKING_THEMES.find(value => value === String(form.get('theme') ?? 'cita-suite'));
  const rawOrigins = form.getAll('origins').flatMap(value => String(value).split(/\r?\n/)).map(value => value.trim()).filter(Boolean);
  const origins = rawOrigins.map(value => { const origin = normalizeBookingOrigin(value, dev); if (!origin) throw new Error('Revisá las direcciones de los sitios permitidos.'); return origin; });
  const professional_ids = form.getAll('professional_ids').map(String);
  const service_ids = form.getAll('service_ids').map(String);
  const schema = parseBookingIntakeFields(JSON.parse(String(form.get('intake_schema') ?? '[]')));
  const modality_windows = parseBookingModalityWindows(JSON.parse(String(form.get('modality_windows') ?? '[]')));
  if (!name || name.length > 120 || !theme || origins.length > 20 || origins.some(value => !value) || new Set(origins).size !== origins.length ||
    professional_ids.length > 100 || service_ids.length > 500 || [...professional_ids, ...service_ids].some(v => !isUuid(v))) throw new Error('Revisá el nombre, los sitios permitidos y las opciones seleccionadas.');
  return { name, theme, origins, professional_ids, service_ids, intake_schema: schema, modality_windows,
    modalities: form.get('video') === 'true' ? ['in_person', 'video'] : ['in_person'],
    video_instructions: String(form.get('video_instructions') ?? '').trim(), active: form.get('active') === 'true',
    default: form.get('default') === 'true' };
}
