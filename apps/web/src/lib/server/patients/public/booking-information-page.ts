import { isUuid } from '@cita-suite/shared/uuid';
import { randomUUID } from 'node:crypto';
import { fail, error, isHttpError, redirect } from '@sveltejs/kit';
import { informationContext, informationErrorMessage, loadBookingInformation } from '$lib/server/patients/public/booking-information';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import { intakeAnswersFromForm } from '$lib/server/sites/public/booking-integrations';
import { isRecord } from '$lib/contracts/json';
import type { Actions, RequestEvent } from '@sveltejs/kit';
import type { PublicInformationFeedback } from '$lib/patients/public-booking-information';
import type { CitaSupabaseClient } from '$lib/types/database';

// The tab names the practice, as every other page of the patient does. Two reads without side effects; the name is
// not essential, so a failure leaves a title that names no one instead of closing the page.
const practiceName = async (admin: CitaSupabaseClient, token: string, legacy: boolean) => {
  try {
    const { data: access } = await admin.rpc('resolve_appointment_management_access', { p_token: token, p_legacy: legacy });
    if (!isRecord(access) || typeof access.business_id !== 'string') return null;
    const { data } = await admin.from('businesses').select('name').eq('id', access.business_id).maybeSingle();
    return typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : null;
  } catch {
    return null;
  }
};

export const createPublicInformationPage = (legacy: boolean) => {
const load = async (event: RequestEvent) => {
  try {
    const { admin, token } = await informationContext(event);
    const [info, businessName] = await Promise.all([loadBookingInformation(admin, token, legacy), practiceName(admin, token, legacy)]);
    const base = `/${legacy ? 'turno' : 'gestion'}/${token}`;
    return { info, businessName, token, requestKey: randomUUID(), managementUrl: base, documentsUrl: `${base}/documentos` };
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    error(404, informationErrorMessage(cause));
  }
};

const actions = {
  save: async (event) => {
    let submitted: PublicInformationFeedback['submitted'];
    let summary: string;
    try {
      const { admin, token } = await informationContext(event);
      const form = await readBoundedBookingForm(event.request);
      const info = await loadBookingInformation(admin, token, legacy);
      const answers = intakeAnswersFromForm({ intakeFields: info.schema }, form);
      submitted = { answers, comment: String(form.get('comment') ?? '').trim(), requestKey: String(form.get('request_key') ?? ''),
        schemaHash: String(form.get('schema_hash') ?? ''), version: String(form.get('version') ?? '') };
      const { data: savedId, error: cause } = await admin.rpc('submit_public_booking_information', {
        p_token: token, p_legacy: legacy, p_request_key: submitted.requestKey, p_schema_hash: submitted.schemaHash,
        p_expected_version: submitted.version, p_answers: answers, p_comment: submitted.comment
      });
      if (cause) throw cause;
      if (!isUuid(savedId)) throw new Error('BOOKING_INFORMATION_RESULT_UNCERTAIN');
      summary = `/${legacy ? 'turno' : 'gestion'}/${token}?informacion=guardada`;
    } catch (cause) {
      if (isHttpError(cause)) throw cause;
      return fail(400, { saved: false, message: informationErrorMessage(cause), ...(submitted ? { submitted } : {}) });
    }
    // Back to the summary the patient came from, which says it was saved. Also without JavaScript.
    redirect(303, summary);
  }
} satisfies Actions;

return { load, actions };
};
