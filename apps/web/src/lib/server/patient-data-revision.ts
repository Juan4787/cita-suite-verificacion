import { isBusinessRole, type BusinessRole } from '$lib/server/business';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

type RevisionRow = {
	patients_revision?: number | string | null;
	realtime_topic_token?: string | null;
};

type ViewerRevisionRow = {
	business_id?: string | null;
	patients_revision?: number | string | null;
	realtime_topic?: string | null;
	viewer_role?: string | null;
	can_create_patient?: boolean | null;
};

export type PatientDataRevision = {
	cacheable: boolean;
	revision: string | null;
	topic: string | null;
};

export type ViewerPatientDataRevision = PatientDataRevision & {
	businessId: string;
	role: BusinessRole;
	canCreatePatient: boolean;
};

const unavailableRevision = (): PatientDataRevision => ({
	cacheable: false,
	revision: null,
	topic: null
});

const isMissingRevisionInfrastructure = (error: { code?: string | null; message?: string | null }) => {
	const message = String(error.message ?? '').toLowerCase();
	return (
		error.code === '42P01' ||
		error.code === 'PGRST205' ||
		(message.includes('business_data_revisions') && message.includes('not found'))
	);
};

const normalizeRevision = (value: number | string | null | undefined) => {
	const normalized = String(value ?? '').trim();
	return /^\d+$/.test(normalized) ? normalized : null;
};

const toRevision = (row: RevisionRow | null): PatientDataRevision => {
	const revision = normalizeRevision(row?.patients_revision);
	const token = String(row?.realtime_topic_token ?? '').trim();
	if (!revision || !token) return unavailableRevision();
	return {
		cacheable: true,
		revision,
		topic: `business-data:${token}`
	};
};

const selectRevision = async (admin: SupabaseClient, businessId: string) => {
	const { data, error } = await admin
		.from('business_data_revisions')
		.select('patients_revision, realtime_topic_token')
		.eq('business_id', businessId)
		.maybeSingle();
	if (error) throw error;
	return (data as RevisionRow | null) ?? null;
};

export const getPatientDataRevision = async (
	admin: SupabaseClient,
	businessId: string
): Promise<PatientDataRevision> => {
	try {
		const existing = await selectRevision(admin, businessId);
		if (existing) return toRevision(existing);

		const { data, error } = await admin
			.from('business_data_revisions')
			.insert({ business_id: businessId })
			.select('patients_revision, realtime_topic_token')
			.single();
		if (!error) return toRevision((data as RevisionRow | null) ?? null);
		if (error.code !== '23505') throw error;

		return toRevision(await selectRevision(admin, businessId));
	} catch (error) {
		if (isMissingRevisionInfrastructure(error as { code?: string; message?: string })) {
			return unavailableRevision();
		}
		throw error;
	}
};

export const getViewerPatientDataRevision = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<ViewerPatientDataRevision> => {
	const { data, error } = await supabase
		.rpc('get_patient_data_revision', { p_business_id: businessId })
		.maybeSingle();
	if (error) throw error;
	const row = (data as ViewerRevisionRow | null) ?? null;
	const returnedBusinessId = String(row?.business_id ?? '').trim();
	const revision = normalizeRevision(row?.patients_revision);
	const topic = String(row?.realtime_topic ?? '').trim();
	const role = String(row?.viewer_role ?? '').trim();
	if (
		returnedBusinessId !== businessId ||
		!revision ||
		!topic.startsWith('business-data:') ||
		!isBusinessRole(role)
	) {
		throw new Error('PATIENT_REVISION_INVALID_RESPONSE');
	}
	return {
		businessId,
		cacheable: true,
		revision,
		topic,
		role,
		canCreatePatient: row?.can_create_patient === true
	};
};

export const patientDataCacheScope = ({
	userId,
	businessId,
	role,
	canCreatePatient
}: {
	userId: string;
	businessId: string;
	role: BusinessRole;
	canCreatePatient: boolean;
}) =>
	createHash('sha256')
		.update(`${userId}:${businessId}:${role}:${canCreatePatient ? 'create' : 'read'}`)
		.digest('base64url')
		.slice(0, 32);
