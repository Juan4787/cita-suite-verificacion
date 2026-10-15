import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/demo-store';
import { normalizePhoneE164, normalizePhoneRaw } from '$lib/server/phone';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId,
	isJwtExpired
} from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
import {
	getPatientUniqueConflictField,
	getPatientWriteConflictMessage,
	isLegacyPatientNameConflict,
	PATIENT_UNIQUE_CONFLICT_MESSAGES,
	type PatientUniqueField
} from '$lib/server/patient-identity';
import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions } from './$types';

type PatientDatabaseError = {
	code?: string | null;
	message?: string | null;
	details?: string | null;
	hint?: string | null;
};

const getCreatePatientErrorMessage = (error: PatientDatabaseError) => {
	const message = (error?.message ?? '').toLowerCase();
	if (error?.code === '42501' || message.includes('row-level security')) {
		return 'No se pudo crear el paciente porque tu sesión no tiene permisos. Cerrá sesión y volvé a ingresar.';
	}
	if (error?.code === 'PGRST303' || message.includes('jwt expired')) {
		return 'Tu sesión expiró. Volvé a iniciar sesión.';
	}
	const conflictMessage = getPatientWriteConflictMessage(error);
	if (conflictMessage) return conflictMessage;
	if (error?.code === '23502') {
		return 'Faltan datos obligatorios para crear el paciente.';
	}
	if (error?.code === '22P02') {
		return 'El DNI o el teléfono tienen un formato inválido.';
	}
	return 'No se pudo crear el paciente. Intentá de nuevo.';
};

const getCreatePatientStatus = (error: PatientDatabaseError) => {
	const message = (error?.message ?? '').toLowerCase();
	if (error?.code === '42501' || message.includes('row-level security')) return 403;
	if (error?.code === 'PGRST303' || message.includes('jwt expired')) return 401;
	if (
		error?.code === '23505' ||
		getPatientUniqueConflictField(error) ||
		isLegacyPatientNameConflict(error)
	) {
		return 409;
	}
	if (error?.code === '23502' || error?.code === '22P02') return 400;
	return 500;
};

const isJwtExpiredError = (error: { code?: string | null; message?: string | null }) => {
	const message = (error?.message ?? '').toLowerCase();
	return error?.code === 'PGRST303' || message.includes('jwt expired');
};


const duplicatePatientResult = ({
	field,
	existingId,
	full_name,
	dni,
	phone
}: {
	field: PatientUniqueField;
	existingId: string;
	full_name: string;
	dni: string;
	phone: string;
}) => ({
	duplicate: true,
	duplicateField: field,
	message: PATIENT_UNIQUE_CONFLICT_MESSAGES[field],
	existingId,
	full_name,
	dni,
	phone
});

const findExistingPatientByDni = async ({
	admin,
	businessId,
	dni
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	dni: string;
}): Promise<{ id: string; field: PatientUniqueField } | null> => {
	if (dni) {
		const { data, error } = await admin
			.from('patients')
			.select('id')
			.eq('business_id', businessId)
			.eq('dni', dni)
			.limit(1)
			.maybeSingle();
		if (error) throw error;
		if (data?.id) return { id: String(data.id), field: 'dni' };
	}

	return null;
};

const ensureProfessionalPatientLink = async ({
	fetch,
	businessId,
	userId,
	patientId
}: {
	fetch: typeof globalThis.fetch;
	businessId: string;
	userId: string;
	patientId: string;
}) => {
	const admin = await createSupabaseAdminClient('odonto', fetch);
	const { data: professionalUser, error: professionalUserError } = await admin
		.from('professional_users')
		.select('professional_id')
		.eq('business_id', businessId)
		.eq('user_id', userId)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (professionalUserError) throw professionalUserError;
	const professionalId = professionalUser?.professional_id ? String(professionalUser.professional_id) : null;
	if (!professionalId) throw new Error('PROFESSIONAL_LINK_REQUIRED');

	const { data: existingLink, error: existingLinkError } = await admin
		.from('professional_patient_links')
		.select('id, is_active')
		.eq('business_id', businessId)
		.eq('professional_id', professionalId)
		.eq('patient_id', patientId)
		.order('is_active', { ascending: false })
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (existingLinkError) throw existingLinkError;

	if (existingLink?.id) {
		const { data: updatedLink, error } = await admin
			.from('professional_patient_links')
			.update({
				is_active: true,
				source: 'manual',
				disabled_by: null,
				disabled_at: null,
				disabled_reason: null,
				updated_at: new Date().toISOString()
			})
			.eq('id', existingLink.id)
			.select('id')
			.maybeSingle();
		if (error) throw error;
		if (!updatedLink) throw new Error('PROFESSIONAL_PATIENT_LINK_NOT_FOUND');
		return;
	}

	const { error: insertError } = await admin.from('professional_patient_links').insert({
		business_id: businessId,
		professional_id: professionalId,
		patient_id: patientId,
		source: 'manual',
		created_by: userId
	});

	if (!insertError) return;
	if (insertError.code !== '23505') throw insertError;

	const { data: activatedLink, error: activateError } = await admin
		.from('professional_patient_links')
		.update({
			is_active: true,
			source: 'manual',
			disabled_by: null,
			disabled_at: null,
			disabled_reason: null,
			updated_at: new Date().toISOString()
		})
		.eq('business_id', businessId)
		.eq('professional_id', professionalId)
		.eq('patient_id', patientId)
		.select('id')
		.maybeSingle();
	if (activateError) throw activateError;
	if (!activatedLink) throw new Error('PROFESSIONAL_PATIENT_LINK_NOT_FOUND');
};

const handleCreatePatient = async ({
	request,
	locals,
	fetch,
	cookies
}: {
	request: Request;
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: import('@sveltejs/kit').Cookies;
}) => {
	try {
		if (!locals.auth) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const form = await request.formData();
		const full_name = String(form.get('full_name') ?? '').trim();
		const dni = String(form.get('dni') ?? '').trim();
		const phoneInput = String(form.get('phone') ?? '');
		const phone = normalizePhone(phoneInput).trim();
		const phone_raw = normalizePhoneRaw(phoneInput);
		const phone_e164 = normalizePhoneE164(phoneInput);

		if (!full_name) {
			return fail(400, { message: 'Nombre y apellido son obligatorios' });
		}

		if (env.DEMO_MODE === 'true') {
			const demoPatients = readDemoDb().patients;
			const existingByDni = dni ? demoPatients.find((patient) => patient.dni === dni) : null;
			if (existingByDni) {
				return duplicatePatientResult({
					field: 'dni',
					existingId: existingByDni.id,
					full_name,
					dni,
					phone
				});
			}

			let createdId: string | null = null;

			updateDemoDb((db) => {
				const now = new Date().toISOString();
				const id = newId('p');
				db.patients.unshift({
					id,
					full_name,
					dni: dni || null,
					phone: phone || null,
					email: null,
					birth_date: null,
					address: null,
					allergies: null,
					medication: null,
					background: null,
					insurance: null,
					custom_fields: null,
					archived_at: null,
					last_entry_at: null,
					created_at: now,
					updated_at: now
				});
				createdId = id;
			});

			if (!createdId) {
				return fail(500, {
					message: 'No se pudo crear el paciente. Intentá de nuevo.',
					full_name,
					dni,
					phone
				});
			}

			throw redirect(303, `/odonto/pacientes/${createdId}`);
		}

		let supabase;
		try {
			supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		} catch (err) {
			console.error('Error creando cliente Supabase:', err);
			return fail(500, {
				message: 'Error de conexión con la base de datos. Intentá de nuevo.',
				full_name,
				dni,
				phone
			});
		}

		const refreshSessionIfNeeded = async () => {
			if (!locals.auth) return false;
			if (!isJwtExpired(locals.auth.access_token)) return true;
			const { data, error } = await supabase.auth.refreshSession({
				refresh_token: locals.auth.refresh_token
			});
			if (error || !data.session) {
				return false;
			}
			const session = data.session;
			const cookieOptions = {
				path: '/',
				httpOnly: true,
				secure: !dev,
				sameSite: 'lax' as const,
				maxAge: 60 * 60 * 24 * 7
			};
			cookies.set('sb-module', locals.auth.module, cookieOptions);
			cookies.set('sb-access-token', session.access_token, cookieOptions);
			cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);
			locals.auth = {
				module: locals.auth.module,
				access_token: session.access_token,
				refresh_token: session.refresh_token
			};
			return true;
		};

		const refreshed = await refreshSessionIfNeeded();
		if (!refreshed) {
			return fail(401, {
				message: 'Tu sesión expiró. Volvé a iniciar sesión.',
				full_name,
				dni,
				phone
			});
		}

		const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const context = await resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies,
			membershipCache: 'fresh'
		});
		if (!context) {
			return fail(500, { message: 'No se pudo resolver el negocio activo.', full_name, dni, phone });
		}
		if (!context.access.allowedCapabilities.canCreatePatient) {
			return fail(403, {
				message: 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.',
				full_name,
				dni,
				phone
			});
		}

		let admin;
		const returnDuplicatePatient = async (existingPatient: { id: string; field: PatientUniqueField }) => {
			if (context.role === 'professional') {
				try {
					await ensureProfessionalPatientLink({
						fetch,
						businessId: context.business.id,
						userId: ownerId,
						patientId: existingPatient.id
					});
				} catch (linkError) {
					console.error('Error vinculando paciente duplicado al profesional', linkError);
					return fail(500, {
						message: `${PATIENT_UNIQUE_CONFLICT_MESSAGES[existingPatient.field]} No pudimos mostrar esa ficha en tu lista profesional; intentá de nuevo.`,
						existingId: existingPatient.id,
						full_name,
						dni,
						phone
					});
				}
			}

			return duplicatePatientResult({
				field: existingPatient.field,
				existingId: existingPatient.id,
				full_name,
				dni,
				phone
			});
		};

		try {
			admin = await createSupabaseAdminClient('odonto', fetch);
			const existingPatient = await findExistingPatientByDni({
				admin,
				businessId: context.business.id,
				dni
			});
			if (existingPatient) {
				return returnDuplicatePatient(existingPatient);
			}
		} catch (duplicateLookupError) {
			console.error('Error verificando duplicados de paciente', duplicateLookupError);
			return fail(500, {
				message:
					'No pudimos comprobar si el DNI ya está asociado a otra ficha. Intentá de nuevo antes de crear el paciente.',
				full_name,
				dni,
				phone
			});
		}

		const patientId = crypto.randomUUID();
		let { error } = await supabase
			.from('patients')
			.insert({
				id: patientId,
				owner_id: ownerId,
				business_id: context.business.id,
				full_name,
				dni: dni || null,
				phone: phone || null,
				phone_raw,
				phone_e164
			});

		if (error && isJwtExpiredError(error)) {
			const refreshed = await refreshSessionIfNeeded();
			if (refreshed) {
				const retry = await supabase
					.from('patients')
					.insert({
						id: patientId,
						owner_id: ownerId,
						business_id: context.business.id,
						full_name,
						dni: dni || null,
						phone: phone || null,
						phone_raw,
						phone_e164
					});
				error = retry.error;
			}
		}

		if (error) {
			const conflictField = getPatientUniqueConflictField(error ?? {});
			if (conflictField) {
				try {
					const existingPatient = await findExistingPatientByDni({
						admin,
						businessId: context.business.id,
						dni
					});
					if (existingPatient) {
						return returnDuplicatePatient(existingPatient);
					}
				} catch (conflictLookupError) {
					console.error('Error recuperando ficha en conflicto', conflictLookupError);
				}
			}
			console.error('Error creando paciente:', error);
			return fail(getCreatePatientStatus(error ?? {}), {
				message: getCreatePatientErrorMessage(error ?? {}),
				full_name,
				dni,
				phone
			});
		}

		if (context.role === 'professional') {
			try {
				await ensureProfessionalPatientLink({
					fetch,
					businessId: context.business.id,
					userId: ownerId,
					patientId
				});
			} catch (linkError) {
				console.error('Error vinculando paciente al profesional', linkError);
				try {
					await admin
						.from('patients')
						.delete()
						.eq('business_id', context.business.id)
						.eq('id', patientId);
				} catch (cleanupError) {
					console.error('Error limpiando paciente sin vinculo profesional', cleanupError);
				}
				return fail(500, {
					message: 'No se pudo vincular el paciente al profesional. Intentá de nuevo.',
					full_name,
					dni,
					phone
				});
			}
		}

		throw redirect(303, `/odonto/pacientes/${patientId}`);
	} catch (err) {
		// Re-throw redirects (they use throw in SvelteKit)
		if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
			throw err;
		}
		console.error('Error inesperado en create_patient:', err);
		return fail(500, {
			message: 'Error interno del servidor. Intentá de nuevo.',
			full_name: '',
			dni: '',
			phone: ''
		});
	}
};

export const actions: Actions = {
	create_patient: handleCreatePatient
};
