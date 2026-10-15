type AssignmentRow = {
	business_id: string;
	professional_id: string;
	service_id: string;
};

const uniqueIds = (values: string[]) =>
	Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

export const idsFromForm = (form: FormData, key: string) =>
	uniqueIds(form.getAll(key).map((value) => String(value)));

const assertExistingIds = async (
	supabase: any,
	table: 'professionals' | 'services',
	businessId: string,
	ids: string[],
	errorCode: string
) => {
	if (ids.length === 0) return;

	const { data, error } = await supabase
		.from(table)
		.select('id')
		.eq('business_id', businessId)
		.in('id', ids);

	if (error) throw error;

	const foundIds = new Set((data ?? []).map((row: { id: string }) => row.id));
	if (ids.some((id) => !foundIds.has(id))) {
		throw new Error(errorCode);
	}
};

const assertTargetExists = async (
	supabase: any,
	table: 'professionals' | 'services',
	businessId: string,
	targetId: string,
	errorCode: string
) => {
	const { data, error } = await supabase
		.from(table)
		.select('id')
		.eq('business_id', businessId)
		.eq('id', targetId)
		.maybeSingle();

	if (error) throw error;
	if (!data) throw new Error(errorCode);
};

const syncAssignments = async ({
	supabase,
	businessId,
	targetColumn,
	targetId,
	relatedColumn,
	relatedIds
}: {
	supabase: any;
	businessId: string;
	targetColumn: 'professional_id' | 'service_id';
	targetId: string;
	relatedColumn: 'professional_id' | 'service_id';
	relatedIds: string[];
}) => {
	const desiredIds = uniqueIds(relatedIds);
	const { data: currentRows, error: currentError } = await supabase
		.from('professional_services')
		.select(relatedColumn)
		.eq('business_id', businessId)
		.eq(targetColumn, targetId);

	if (currentError) throw currentError;

	const currentIds = new Set<string>(
		(currentRows ?? []).map((row: Record<string, string>) => row[relatedColumn])
	);
	const desiredIdSet = new Set(desiredIds);
	const idsToAdd = desiredIds.filter((id) => !currentIds.has(id));
	const idsToRemove = Array.from(currentIds).filter((id) => !desiredIdSet.has(id));

	if (idsToAdd.length > 0) {
		const rows: AssignmentRow[] = idsToAdd.map((id) => ({
			business_id: businessId,
			professional_id: targetColumn === 'professional_id' ? targetId : id,
			service_id: targetColumn === 'service_id' ? targetId : id
		}));

		const { error } = await supabase
			.from('professional_services')
			.upsert(rows, {
				onConflict: 'business_id,professional_id,service_id',
				ignoreDuplicates: true
			});

		if (error) throw error;
	}

	if (idsToRemove.length > 0) {
		const { error } = await supabase
			.from('professional_services')
			.delete()
			.eq('business_id', businessId)
			.eq(targetColumn, targetId)
			.in(relatedColumn, idsToRemove);

		if (error) throw error;
	}
};

export const setServiceProfessionals = async (
	supabase: any,
	businessId: string,
	serviceId: string,
	professionalIds: string[]
) => {
	await assertTargetExists(supabase, 'services', businessId, serviceId, 'SERVICE_NOT_FOUND');
	await assertExistingIds(
		supabase,
		'professionals',
		businessId,
		professionalIds,
		'INVALID_PROFESSIONAL_ASSIGNMENT'
	);
	await syncAssignments({
		supabase,
		businessId,
		targetColumn: 'service_id',
		targetId: serviceId,
		relatedColumn: 'professional_id',
		relatedIds: professionalIds
	});
};

export const setProfessionalServices = async (
	supabase: any,
	businessId: string,
	professionalId: string,
	serviceIds: string[]
) => {
	await assertTargetExists(supabase, 'professionals', businessId, professionalId, 'PROFESSIONAL_NOT_FOUND');
	await assertExistingIds(supabase, 'services', businessId, serviceIds, 'INVALID_SERVICE_ASSIGNMENT');
	await syncAssignments({
		supabase,
		businessId,
		targetColumn: 'professional_id',
		targetId: professionalId,
		relatedColumn: 'service_id',
		relatedIds: serviceIds
	});
	// La validación previa evita IDs ajenos; repetirla después de la sincronización
	// evita informar guardado si otra pestaña eliminó el profesional durante la
	// operación y las escrituras afectaron cero filas.
	await assertTargetExists(supabase, 'professionals', businessId, professionalId, 'PROFESSIONAL_NOT_FOUND');
};
