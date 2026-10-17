import { browser } from '$app/environment';
import { isRecord, InvalidDataContractError } from '$lib/contracts/json';
import { parsePatientListData, type PatientListData } from '$lib/contracts/patient-list';
import {
	acceptPatientListSnapshot,
	getCurrentVerifiedPatientRevision,
	getCachedPatientList,
	setCachedPatientList,
	verifyPatientRevision
} from '$lib/client/patient-list-cache';
import { normalizePatientListQuery } from '$lib/utils/patient-list-query';
import { error as kitError, type LoadEvent } from '@sveltejs/kit';
import type { PageLoad } from './$types';

const fetchPatientList = async (
	fetcher: LoadEvent['fetch'],
	showArchived: boolean,
	query: string
): Promise<PatientListData> => {
	const params = new URLSearchParams();
	if (showArchived) params.set('estado', 'archivados');
	if (query) params.set('q', query);
	const suffix = params.size > 0 ? `?${params.toString()}` : '';
	const response = await fetcher(`/odonto/pacientes/lista${suffix}`, {
		headers: { accept: 'application/json' },
		cache: 'no-store'
	});
	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}
	if (!response.ok) {
		const message = isRecord(payload) && typeof payload.message === 'string' ? payload.message.trim() : '';
		throw kitError(response.status, message || 'No se pudieron cargar los pacientes.');
	}
	try {
		return parsePatientListData(payload, { showArchived, query });
	} catch (error) {
		if (error instanceof InvalidDataContractError)
			throw kitError(503, 'No pudimos cargar la lista completa de pacientes. Volvé a intentar.');
		throw error;
	}
};

export const load: PageLoad = async ({ fetch, url, depends, parent }) => {
	depends('app:patients');
	const showArchived = url.searchParams.get('estado') === 'archivados';
	const query = normalizePatientListQuery(url.searchParams.get('q'));

	if (!browser) return fetchPatientList(fetch, showArchived, query);

	const layoutData = await parent();
	const businessId = String(layoutData?.activeBusiness?.business?.id ?? '').trim();
	if (!businessId || businessId === 'demo-business') {
		return fetchPatientList(fetch, showArchived, query);
	}

	const currentRevision = getCurrentVerifiedPatientRevision(businessId);
	if (currentRevision) {
		const cached = getCachedPatientList({
			cacheScope: currentRevision.cacheScope,
			showArchived,
			query,
			revision: currentRevision.revision
		});
		if (cached) return parsePatientListData(cached, { businessId, showArchived, query });
	} else {
		try {
			const revision = await verifyPatientRevision(fetch, businessId);
			if (revision.cacheable && revision.cacheScope && revision.revision) {
				const cached = getCachedPatientList({
					cacheScope: revision.cacheScope,
					showArchived,
					query,
					revision: revision.revision
				});
				if (cached) return parsePatientListData(cached, { businessId, showArchived, query });
			}
		} catch {
			// Sin una verificación válida nunca se reutiliza memoria: se pide una lista fresca.
		}
	}

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const data = await fetchPatientList(fetch, showArchived, query);
		if (!data.cacheable) return data;
		if (data.businessId === businessId && acceptPatientListSnapshot(data)) {
			setCachedPatientList(data);
			return data;
		}
	}

	throw kitError(
		503,
		'La lista de pacientes cambió mientras se actualizaba. Esperá un momento y volvé a intentar.'
	);
};
