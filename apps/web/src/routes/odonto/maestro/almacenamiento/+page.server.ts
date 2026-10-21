import { isUuid } from '@cita-suite/shared/uuid';
import { error, fail, redirect } from '@sveltejs/kit';
import { createSupabaseAdminClient, isMasterEmail } from '$lib/server/platform/supabase';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import { parseStorageMegabytes } from '$lib/clinical-storage-units';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

async function masterContext(event: RequestEvent) {
	const user = event.locals.verifiedUser;
	if (!event.locals.auth || !user) throw redirect(303, '/login');
	if (!isMasterEmail(user.email)) error(403, 'Tu usuario no puede administrar el espacio de Cita Suite.');
	return { user, admin: await createSupabaseAdminClient('odonto', event.fetch) };
}

export const load: PageServerLoad = async event => {
	const { admin } = await masterContext(event);
	const after = event.url.searchParams.get('after');
	if (after && !isUuid(after)) error(400, 'La página solicitada no es válida. Volvé al inicio de la lista.');
	let query = admin.from('clinical_business_storage_budget')
		.select('business_id,max_bytes,used_bytes,reserved_bytes,uploads_enabled,policy_revision,business:businesses!inner(id,name)')
		.order('business_id').limit(51);
	if (after) query = query.gt('business_id', after);
	const [global, accounts] = await Promise.all([
		admin.from('clinical_storage_budget').select('max_bytes,used_bytes,reserved_bytes,default_business_max_bytes,uploads_enabled,policy_revision').eq('singleton', true).single(),
		query
	]);
	if (global.error || !global.data || accounts.error || !accounts.data)
		error(503, 'No pudimos consultar el espacio para documentos. Volvé a intentar.');
	return { budget: global.data, accounts: accounts.data.slice(0, 50),
		next: accounts.data.length > 50 ? accounts.data[49].business_id : null, after };
};

async function savePolicy(event: RequestEvent, defaults: boolean) {
	const { user, admin } = await masterContext(event);
	const form = await readBoundedBookingForm(event.request);
	const target = defaults ? 'defaults' : String(form.get('business_id') ?? '');
	const values = { megabytes: String(form.get('megabytes') ?? '').slice(0, 40), enabled: form.get('uploads_enabled') === 'true' };
	const invalid = (status: number, message: string, field: 'megabytes' | null = null) => fail(status, { saved: false, target, values, field, message });
	const bytes = parseStorageMegabytes(values.megabytes);
	const versionText = String(form.get('policy_revision') ?? '');
	const revision = Number(versionText);
	if (!bytes) return invalid(400, 'Revisá el límite en MB. Usá coma para decimales y no agregues puntos.', 'megabytes');
	if (!/^[1-9]\d{0,9}$/.test(versionText) || !Number.isSafeInteger(revision) || revision > 2147483647 || (!defaults && !isUuid(target)))
		return invalid(400, 'La configuración ya no es válida. Recargá para revisar los valores actuales antes de guardar.');
	const response = defaults
		? await admin.rpc('set_clinical_storage_defaults', { p_actor_id: user.id, p_default_business_max_bytes: bytes,
			p_uploads_enabled: values.enabled, p_expected_revision: revision })
		: await admin.rpc('set_business_clinical_storage_policy', { p_actor_id: user.id, p_business_id: target,
			p_max_bytes: bytes, p_uploads_enabled: values.enabled, p_expected_revision: revision });
	if (response.error) {
		if (response.error.message.includes('CLINICAL_STORAGE_COMMITTED'))
			return invalid(409, 'Ese límite es menor que el espacio utilizado y las cargas pendientes. Aumentalo para guardar.', 'megabytes');
		if (response.error.message.includes('CLINICAL_STORAGE_POLICY_CHANGED'))
			return invalid(409, 'Otra persona cambió esta configuración. Recargá para revisar los valores actuales antes de guardar.');
		return invalid(503, 'No pudimos guardar el límite. Tus cambios se conservan; probá de nuevo.');
	}
	return { saved: true, target, values: null, field: null, message: defaults
		? 'Configuración general guardada. Los límites existentes se conservaron.'
		: 'Configuración del consultorio guardada. Los documentos y las cargas pendientes se conservaron.' };
}
export const actions: Actions = {
	defaults: event => savePolicy(event, true),
	business: event => savePolicy(event, false)
};
