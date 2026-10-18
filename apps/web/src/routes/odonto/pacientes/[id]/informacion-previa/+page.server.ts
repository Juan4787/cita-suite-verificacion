import { error } from '@sveltejs/kit';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { resolvePatientPermissions } from '$lib/server/patients/public/patient-permissions';
import { bookingInformationEnabled, privateInformationHeaders } from '$lib/server/patients/public/booking-information';
import { parsePublicPatientFields } from '@cita-suite/shared/booking-integration';
import { isRecord, readRecord } from '$lib/contracts/json';
import type { PageServerLoad } from './$types';

function displayProfileValue(value: unknown): string {
 if (value === null || value === undefined) return 'Sin registrar';
 if (isRecord(value)) { const entry = value; return 'years' in entry ? `${entry.years} años (al ${entry.as_of})` : 'value' in entry ? String(entry.value) : JSON.stringify(value); }
 return typeof value === 'boolean' ? value ? 'Sí' : 'No' : String(value);
}

export const load: PageServerLoad = async (event) => {
  event.setHeaders(privateInformationHeaders);
  const context = await getOdontoContext(event);
  if (!bookingInformationEnabled()) error(503, 'La información previa todavía no está habilitada.');
  if (!resolvePatientPermissions(context.business).canReadClinicalProfile) error(403, 'Tu usuario no puede consultar información clínica.');
  const businessId = context.business.business.id;
  const results = await Promise.all([
    context.supabase.from('patients').select('id,full_name').eq('business_id', businessId).eq('id', event.params.id).maybeSingle(),
    context.supabase.from('appointment_intake_responses').select('appointment_id,schema_snapshot,answers,free_comment,created_at').eq('business_id', businessId).eq('patient_id', event.params.id).order('created_at', { ascending: false }).limit(50),
    context.supabase.from('appointment_intake_submissions').select('id,appointment_id,schema_snapshot,answers,free_comment,profile_changes,created_at').eq('business_id', businessId).eq('patient_id', event.params.id).order('sequence_no', { ascending: false }).limit(50)
  ]);
  if (results.some(result => result.error)) error(503, 'No pudimos cargar la información. Volvé a intentar en unos minutos.');
  if (!results[0].data) error(404, 'No encontramos la ficha o tu usuario no puede verla.');
  const history = [...(results[1].data ?? []).filter(row => !(results[2].data ?? []).some(submission => submission.appointment_id === row.appointment_id)).map(row => ({ ...row, id: row.appointment_id, profile_changes: {} })), ...(results[2].data ?? [])].sort((a,b) => b.created_at.localeCompare(a.created_at));
  return { patient: results[0].data, timezone: context.business.business.timezone,
    history: history.map((row) => {
      const schema = parsePublicPatientFields(row.schema_snapshot);
      const answers = readRecord(row.answers, 'intakeHistory.answers');
      const changes = readRecord(row.profile_changes, 'intakeHistory.profileChanges');
      const before = changes.before === undefined ? {} : readRecord(changes.before, 'intakeHistory.before');
      const after = changes.after === undefined ? {} : readRecord(changes.after, 'intakeHistory.after');
      return { id: row.id, created_at: row.created_at, comment: row.free_comment,
        changes: Object.entries(after).map(([key, value]) => ({
          label: (schema.find(field => field.patientField === key) ?? schema.find(field => field.id === key))?.label ?? 'Dato del perfil',
          before: displayProfileValue(before[key]), after: displayProfileValue(value)
        })),
        responses: schema.map(field => ({ label: field.label, value: answers[field.id] === undefined ? 'Sin responder' : typeof answers[field.id] === 'boolean' ? answers[field.id] ? 'Sí' : 'No' : String(answers[field.id]) }))
      };
    }),
    limited: results.slice(1).some(result => (Array.isArray(result.data) ? result.data.length : 0) === 50) };
};
