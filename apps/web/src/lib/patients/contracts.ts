import type { Database, Json } from '@cita-suite/shared';
import type { BusinessIndustry, BusinessRole } from '$lib/access/contracts';
import type { Patient, PatientRadiograph } from '$lib/types';

export type PatientPermissions = {
	canReadClinicalHistory: boolean;
	canReadClinicalProfile: boolean;
	canEditClinicalProfile: boolean;
	canViewCosts: boolean;
	canEditPatient: boolean;
	canArchivePatient: boolean;
	canCreateClinicalEntry: boolean;
	canEditClinicalEntry: boolean;
	canCreateAppointment: boolean;
	canViewRadiographs: boolean;
	canUploadRadiographs: boolean;
	canViewRadiographTrash: boolean;
	canTrashRadiographs: boolean;
	canExportPatientData: boolean;
};
export type PatientHistoryEntry = {
	id: string;
	created_at: string;
	entry_type: string;
	description: string;
	title?: string;
	teeth?: string | null;
	internal_note?: string | null;
	amount?: number | null;
	created_by_user_id?: string | null;
	locked_after?: string | null;
};
export type PatientChangeEvent = {
	id: string;
	summary: string;
	changed_by_name: string;
	created_at: string;
	changed_fields?: Json;
};
export type PatientFailureFeedback = {
	duplicate?: boolean;
	duplicateField?: 'dni';
	existingId?: string;
	currentPatientUpdatedAt?: string;
	currentClinicalProfileUpdatedAt?: string;
};
export type PatientFormState = PatientFailureFeedback & { message?: string; savedEntry?: unknown };
export type PatientAppointment = Pick<
	Database['public']['Tables']['appointments']['Row'],
	| 'id'
	| 'starts_at'
	| 'ends_at'
	| 'status'
	| 'source'
	| 'service_name_snapshot'
	| 'professional_name_snapshot'
>;
export type PatientDetailViewData = {
	patient: Omit<Patient, 'custom_fields'> & {
		custom_fields?: unknown;
		professional_archived_at?: string | null;
		clinical_profile_patient_reported?: boolean;
		clinical_profile_updated_at?: string | null;
		booking_age?: { years: number; as_of: string } | null;
		booking_extra_fields?: { label: string; value: string | boolean }[];
	};
	entries: PatientHistoryEntry[];
	appointments: PatientAppointment[];
	radiographs: PatientRadiograph[];
	changeEvents?: PatientChangeEvent[];
	changeEventsDeferred?: boolean;
	role?: BusinessRole;
	currentUserId?: string | null;
	clinicalTodayISO: string;
	businessTimeZone?: string;
	bookingInformationEnabled?: boolean;
	businessIndustry?: BusinessIndustry;
	hasMoreEntries?: boolean;
	permissions: PatientPermissions;
	documentUploads: 'available' | 'paused' | 'unavailable' | 'not_permitted';
	followUpParticipates: boolean;
	followUpCanAssign: boolean;
	followUpTodayISO: string;
	demo?: boolean;
};
