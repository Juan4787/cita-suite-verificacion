import { env } from '$env/dynamic/private';
import { error, fail, redirect } from '@sveltejs/kit';
import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/access/public/business';
import { createSupabaseServerClient } from '$lib/server/platform/supabase';
import { logServerFailure } from '$lib/server/platform/logging';
import { isRecord } from '$lib/contracts/json';
import { DEFAULT_APPOINTMENT_EMAIL_PREFERENCES } from '$lib/scheduling/email-policy';
import { loadAppointmentEmailPolicy, parseAppointmentEmailPolicyForm, saveAppointmentEmailPolicy } from '$lib/server/scheduling/public/email-policy';
import { loadBusinessEmailStatus, type BusinessEmailStatus } from '$lib/server/scheduling/public/email-status';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
 if (!locals.auth) redirect(303, '/login');
 if (env.DEMO_MODE === 'true') return { demo: true, context: demoBusinessContext(), policy: { ...DEFAULT_APPOINTMENT_EMAIL_PREFERENCES, revision: 1, sender_verified: false }, status: null as BusinessEmailStatus | null };
 const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
 const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
 if (!context?.canManage) error(403, 'Sólo la dueña o la administración pueden configurar los correos del consultorio.');
 try {
  const policy = await loadAppointmentEmailPolicy(supabase, context.business.id);
  // The status is informative: its failure must not hide the preferences.
  const status = await loadBusinessEmailStatus(supabase, context.business.id).catch((cause: unknown) => {
   logServerFailure('Error cargando el estado de los correos', cause);
   return null;
  });
  return { demo: false, context, policy, status };
 }
 catch (cause) { logServerFailure('Error cargando preferencias de correo', cause); error(503, 'No pudimos cargar la configuración de correo. Volvé a intentar en unos segundos.'); }
};

export const actions: Actions = {
 save: async ({ locals, fetch, cookies, request }) => {
  if (!locals.auth) redirect(303, '/login');
  if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
  const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
  const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
  if (!context?.canManage) error(403, 'Sólo la dueña o la administración pueden configurar los correos del consultorio.');
  const form = await request.formData();
  let input: ReturnType<typeof parseAppointmentEmailPolicyForm>;
  try { input = parseAppointmentEmailPolicyForm(form); }
  catch { return fail(400, { message: 'Revisá las opciones elegidas y volvé a guardar.' }); }
  try {
   await saveAppointmentEmailPolicy(supabase, context.business.id, input);
   return { success: true, message: 'Se guardaron las preferencias de correo.' };
  } catch (cause) {
   logServerFailure('Error guardando preferencias de correo', cause);
   const raw = isRecord(cause) && typeof cause.message === 'string' ? cause.message : '';
   const changed = /\bEMAIL_POLICY_CHANGED\b/.test(raw);
   const forbidden = /\bEMAIL_POLICY_FORBIDDEN\b/.test(raw);
   return fail(changed ? 409 : forbidden ? 403 : 503, {
    values: input.settings, expectedRevision: input.expectedRevision, changed,
    message: changed ? 'Otra persona cambió la configuración. Recargala y revisá las opciones antes de guardar.'
     : forbidden ? 'Tu permiso para configurar el consultorio ya no está vigente. Volvé a ingresar o contactá a la dueña.'
     : 'No pudimos confirmar el cambio. Podés volver a guardar las mismas opciones o recargar para comprobar su estado.'
   });
  }
 }
};
