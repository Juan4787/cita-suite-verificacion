import type { CitaSupabaseClient } from '$lib/types/database';
import type { BusinessContext } from '$lib/access/contracts';
import { loadClinicalUploadAvailability, type ClinicalUploadAvailability } from './clinical-files';
import { readClinicalEntryAmount } from './clinical-entry-costs';
import { bookingInformationEnabled } from './booking-information';
import { resolvePatientPermissions } from './patient-permissions';
import { businessTodayISO, roleParticipatesInFollowUps, roleSeesAllFollowUps } from './follow-ups';
import { parsePatientBookingProfile, readPatientBookingAge } from '$lib/patients/booking-profile';
import { ACTIVE_APPOINTMENT_STATUSES } from '$lib/utils/appointment-visibility';
import { getProfessionalForUser as getCurrentProfessional } from '$lib/server/team/public/professionals';
import { logServerFailure } from '$lib/server/platform/logging';
import type { PatientDetailViewData } from '$lib/patients/contracts';

const ENTRIES_PAGE_SIZE = 30;
export class PatientDetailReadError extends Error {
	readonly kind: 'not_found' | 'unavailable';
	constructor(kind: 'not_found' | 'unavailable') {
		super('Patient detail read failed');
		this.kind = kind;
	}
}

/** Authorized patient projection; HTTP params/cookies and status translation belong to the route. */
export async function readPatientDetail({
	patientId,
	supabase,
	admin,
	context,
	currentUserId
}: {
	patientId: string;
	supabase: CitaSupabaseClient;
	admin: CitaSupabaseClient;
	context: BusinessContext;
	currentUserId: string | null;
}): Promise<PatientDetailViewData> {
	const permissions = resolvePatientPermissions(context);
	const nowIso = new Date().toISOString();
	const documentUploads: Promise<ClinicalUploadAvailability> = permissions.canUploadRadiographs
		? loadClinicalUploadAvailability(admin, context.business.id)
		: Promise.resolve('not_permitted');
	const currentProfessional =
		context.role === 'professional'
			? await getCurrentProfessional({
					admin,
					businessId: context.business.id,
					userId: currentUserId ?? ''
				}).catch((err) => {
					logServerFailure('patient.professional.read.failed', err);
					throw new PatientDetailReadError('unavailable');
				})
			: null;

	const [
		{ data: patient, error: patientError },
		{ data: clinicalProfile, error: clinicalProfileError },
		{ data: entries, error: entriesError },
		{ data: appointments, error: appointmentsError },
		{ data: professionalLink, error: professionalLinkError }
	] = await Promise.all([
		supabase
			.from('patients')
			.select(
				'id, full_name, dni, phone, email, birth_date, address, insurance, insurance_plan, archived_at, created_at, updated_at'
			)
			.eq('id', patientId)
			.eq('business_id', context.business.id)
			.maybeSingle(),
		permissions.canReadClinicalProfile
			? supabase
					.from('patient_clinical_profiles')
					.select('allergies, medication, background, custom_fields, updated_at, updated_by')
					.eq('patient_id', patientId)
					.eq('business_id', context.business.id)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null }),
		permissions.canReadClinicalHistory
			? supabase
					.from('clinical_entries')
					.select(
						'id, created_at, entry_type, description, teeth, internal_note, created_by_user_id, locked_after, clinical_entry_costs(amount)'
					)
					.eq('patient_id', patientId)
					.eq('business_id', context.business.id)
					.is('archived_at', null)
					.order('created_at', { ascending: false })
					.order('id', { ascending: false })
					.limit(ENTRIES_PAGE_SIZE + 1)
			: Promise.resolve({ data: [], error: null }),
		supabase
			.from('appointments')
			.select(
				'id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot'
			)
			.eq('patient_id', patientId)
			.eq('business_id', context.business.id)
			.in('status', [...ACTIVE_APPOINTMENT_STATUSES])
			.gte('starts_at', nowIso)
			.order('starts_at', { ascending: true })
			.limit(12),
		context.role === 'professional' && currentProfessional
			? admin
					.from('professional_patient_links')
					.select('id, archived_at')
					.eq('business_id', context.business.id)
					.eq('patient_id', patientId)
					.eq('professional_id', currentProfessional.id)
					.eq('is_active', true)
					.limit(1)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null })
	]);

	if (patientError) {
		logServerFailure('patient.read.failed', patientError);
		throw new PatientDetailReadError('unavailable');
	}
	if (!patient) {
		throw new PatientDetailReadError('not_found');
	}

	// These reads form the editable projection. A failed profile/history/link
	// cannot become a blank field, empty history or unarchived personal record.
	const failures = [
		['patient.profile.read.failed', clinicalProfileError],
		['patient.history.read.failed', entriesError],
		['patient.appointments.read.failed', appointmentsError],
		['patient.professional_link.read.failed', professionalLinkError]
	] as const;
	for (const [operation, cause] of failures) if (cause) logServerFailure(operation, cause);
	if (failures.some(([, cause]) => cause)) throw new PatientDetailReadError('unavailable');

	const safeEntries = entries ?? [];
	const entriesWithCosts = safeEntries.map((entry) => ({
		...entry,
		amount: permissions.canViewCosts ? readClinicalEntryAmount(entry.clinical_entry_costs) : null,
		clinical_entry_costs: undefined
	}));
	const hasMoreEntries = entriesWithCosts.length > ENTRIES_PAGE_SIZE;
	const bookingProfile = parsePatientBookingProfile(clinicalProfile?.custom_fields);

	return {
		patient: {
			...patient,
			allergies: clinicalProfile?.allergies ?? null,
			medication: clinicalProfile?.medication ?? null,
			background: clinicalProfile?.background ?? null,
			custom_fields: clinicalProfile?.custom_fields ?? null,
			booking_extra_fields: bookingProfile.fields,
			booking_age: readPatientBookingAge(clinicalProfile?.custom_fields),
			clinical_profile_updated_at: clinicalProfile?.updated_at ?? null,
			clinical_profile_patient_reported:
				bookingInformationEnabled() &&
				clinicalProfile?.updated_by === null &&
				bookingProfile.reportedAtMs !== null &&
				bookingProfile.reportedAtMs === Date.parse(clinicalProfile.updated_at),
			professional_archived_at:
				context.role === 'professional' ? (professionalLink?.archived_at ?? null) : null
		},
		businessTimeZone: context.business.timezone,
		businessIndustry: context.business.industry,
		bookingInformationEnabled: bookingInformationEnabled(),
		entries: hasMoreEntries ? entriesWithCosts.slice(0, ENTRIES_PAGE_SIZE) : entriesWithCosts,
		appointments: appointments ?? [],
		radiographs: [],
		hasMoreEntries,
		changeEvents: [],
		changeEventsDeferred: true,
		role: context.role,
		currentUserId: currentUserId,
		permissions,
		documentUploads: await documentUploads,
		followUpParticipates: roleParticipatesInFollowUps(context.role),
		followUpCanAssign: roleSeesAllFollowUps(context.role),
		followUpTodayISO: businessTodayISO(context.business.timezone),
		clinicalTodayISO: businessTodayISO(context.business.timezone),
		demo: false
	};
}
