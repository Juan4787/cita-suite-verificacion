import type { CitaSupabaseClient } from '$lib/types/database';
import { InvalidDataContractError } from '$lib/contracts/json';
import { availabilityDateWindows, availabilityProfessionalGroups } from '$lib/availability/windows';
import { parseAvailabilityCatalog, parseAvailabilityWindow, type AvailabilityCatalog, type AvailabilityScope } from '$lib/availability/contracts';
import type { IntegratedAvailabilityRows } from '$lib/availability/rows';

export async function loadAvailabilityCatalog(client: CitaSupabaseClient, businessId: string, scope: AvailabilityScope): Promise<AvailabilityCatalog> {
	const result = await client.rpc('get_availability_catalog', { p_business_id: businessId, p_public: scope === 'public' });
	if (result.error) throw result.error;
	return parseAvailabilityCatalog(result.data, { businessId, scope });
}

/** One already loaded catalog, fixed windows/groups, sequential SQL calls.
 * Fail the requested result as a whole; never turn a missing fragment into free
 * space, recursively split by payload size or restart an unrelated horizon.
 */
export async function loadAvailabilityWindowRows(client: CitaSupabaseClient, catalog: AvailabilityCatalog, input: {
	serviceId: string | null;
	professionalIds: readonly string[];
	fromDate: string;
	toDate: string;
}): Promise<Pick<IntegratedAvailabilityRows, 'exceptions' | 'blocks'> & { generatedAt: string }> {
	const groups = [...availabilityProfessionalGroups(input.professionalIds)];
	const known = new Set(catalog.professionals.map(professional => professional.id));
	if (groups.some(group => group.some(id => !known.has(id)))) throw new InvalidDataContractError('availability.selection');
	if (input.serviceId !== null && !catalog.services.some(service => service.id === input.serviceId))
		throw new InvalidDataContractError('availability.service');
	const exceptions = new Map<string, IntegratedAvailabilityRows['exceptions'][number]>();
	const blocks = new Map<string, IntegratedAvailabilityRows['blocks'][number]>();
	let generatedAt: string | null = null;
	for (const window of availabilityDateWindows(input.fromDate, input.toDate)) {
		for (const group of groups) {
			const result = await client.rpc('get_availability_window', {
				p_business_id: catalog.business_id, p_public: catalog.scope === 'public', p_service_id: input.serviceId,
				p_professional_ids: group, p_from_date: window.fromDate, p_to_date: window.toDate,
				p_configuration_revision: catalog.configuration_revision
			});
			if (result.error) throw result.error;
			const fragment = parseAvailabilityWindow(result.data, {
				businessId: catalog.business_id, scope: catalog.scope, configurationRevision: catalog.configuration_revision,
				fromDate: window.fromDate, toDate: window.toDate, professionalIds: group
			});
			if (generatedAt === null || Date.parse(fragment.generated_at) < Date.parse(generatedAt)) generatedAt = fragment.generated_at;
			for (const row of fragment.exceptions) {
				const previous = exceptions.get(row.id);
				if (previous && JSON.stringify(previous) !== JSON.stringify(row))
					throw new InvalidDataContractError('availability.exceptionChangedBetweenWindows');
				exceptions.set(row.id, row);
			}
			for (const row of fragment.blocks) {
				const previous = blocks.get(row.id);
				if (previous && JSON.stringify(previous) !== JSON.stringify(row))
					throw new InvalidDataContractError('availability.blockChangedBetweenWindows');
				blocks.set(row.id, row);
			}
		}
	}
	return { exceptions: [...exceptions.values()], blocks: [...blocks.values()], generatedAt: generatedAt ?? catalog.generated_at };
}
