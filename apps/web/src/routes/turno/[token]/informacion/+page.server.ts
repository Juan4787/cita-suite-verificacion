import { randomUUID } from 'node:crypto';
import { fail, error, isHttpError } from '@sveltejs/kit';
import { informationContext, informationErrorMessage, loadBookingInformation } from '$lib/server/patients/public/booking-information';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import { intakeAnswersFromForm } from '$lib/server/sites/public/booking-integrations';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  try {
    const { admin, token } = await informationContext(event);
    const info = await loadBookingInformation(admin, token);
    return { info, token, requestKey: randomUUID() };
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    error(404, informationErrorMessage(cause));
  }
};

export const actions: Actions = {
  save: async (event) => {
    try {
      const { admin, token } = await informationContext(event);
      const form = await readBoundedBookingForm(event.request);
      const info = await loadBookingInformation(admin, token);
      const answers = intakeAnswersFromForm({ intakeFields: info.schema }, form);
      const { error: cause } = await admin.rpc('submit_public_booking_information', {
        p_token: token, p_request_key: String(form.get('request_key') ?? ''), p_schema_hash: String(form.get('schema_hash') ?? ''),
        p_expected_version: String(form.get('version') ?? ''), p_answers: answers, p_comment: String(form.get('comment') ?? '').trim()
      });
      if (cause) throw cause;
      return { saved: true, message: 'La información quedó guardada para la profesional.' };
    } catch (cause) {
      if (isHttpError(cause)) throw cause;
      return fail(400, { saved: false, message: informationErrorMessage(cause) });
    }
  }
};
