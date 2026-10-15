import { describe, expect, it, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	createSupabaseServerClient: vi.fn(),
	getAuthUserId: vi.fn(),
	resolveActiveBusiness: vi.fn(),
	supabase: {
		from: vi.fn(),
		rpc: vi.fn()
	},
	admin: {
		from: vi.fn(),
		rpc: vi.fn()
	}
}));

vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getAuthUserId: mocks.getAuthUserId
}));

vi.mock('$lib/server/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));

const { actions } = await import('./+page.server');
const { resolvePatientPermissions } = await import('$lib/server/patient-permissions');

const businessId = '00000000-0000-4000-8000-000000000001';
const ownerId = '00000000-0000-4000-8000-000000000002';
const patientId = '00000000-0000-4000-8000-000000000003';

const allCapabilities = {
	canViewExistingPatients: true,
	canViewExistingClinicalNotes: true,
	canViewExistingCosts: true,
	canCreatePatient: true,
	canEditPatient: true,
	canCreateAppointment: true,
	canEditAppointment: true,
	canCancelAppointment: true,
	canRescheduleAppointment: true,
	canUsePublicBooking: true,
	canManageServices: true,
	canManageProfessionals: true,
	canManageAvailability: true,
	canCreateClinicalEntry: true,
	canEditClinicalEntry: true,
	canManagePatientFiles: true,
	canManageUsers: true,
	canViewSubscription: true
};

const makeEvent = (formData = new FormData(), options: { enhanced?: boolean } = {}) =>
	({
		request: new Request('http://localhost/odonto/pacientes/test', {
			method: 'POST',
			headers: options.enhanced ? { 'x-sveltekit-action': 'true' } : undefined,
			body: formData
		}),
		params: { id: patientId },
		locals: { auth: { access_token: 'test-token' } },
		fetch,
		cookies: {}
	}) as any;

const expectRedirectToPatient = async (promise: unknown, tab: 'historial' | 'datos') => {
	try {
		await promise;
		throw new Error('Expected redirect');
	} catch (err) {
		expect(err).toMatchObject({
			status: 303,
			location: `/odonto/pacientes/${patientId}?tab=${tab}`
		});
	}
};

const makeQueryBuilder = ({
	result = { data: null, error: null },
	maybeSingleResult,
	rangeResult
}: {
	result?: any;
	maybeSingleResult?: any;
	rangeResult?: any;
} = {}) => {
	const builder: any = {
		select: vi.fn(() => builder),
		eq: vi.fn(() => builder),
		neq: vi.fn(() => builder),
		order: vi.fn(() => builder),
		limit: vi.fn(() => builder),
		range: vi.fn(() => Promise.resolve(rangeResult ?? result)),
		maybeSingle: vi.fn(() => Promise.resolve(maybeSingleResult ?? result)),
		update: vi.fn(() => builder),
		insert: vi.fn(() => Promise.resolve(result)),
		upsert: vi.fn(() => Promise.resolve(result)),
		then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) =>
			Promise.resolve(result).then(resolve, reject)
	};
	return builder;
};

const mockAdminBuilders = (builders: any[]) => {
	const calls: { table: string; builder: any }[] = [];
	mocks.admin.from.mockImplementation((table: string) => {
		const builder = builders.shift();
		if (!builder) throw new Error(`No mock builder for ${table}`);
		calls.push({ table, builder });
		return builder;
	});
	return calls;
};

const makeProfessionalContext = () => {
	mocks.resolveActiveBusiness.mockResolvedValue({
		business: { id: businessId },
		role: 'professional',
		access: { canEnterApp: true, canUseBusiness: true, allowedCapabilities: { ...allCapabilities } }
	});
};

describe('patient detail clinical-file permissions', () => {
	it('keeps restricted owner read-only access and hides files entirely from restricted professionals', () => {
		const restrictedCapabilities = {
			...allCapabilities,
			canManagePatientFiles: false
		};
		const restrictedAccess = {
			canEnterApp: true,
			canUseBusiness: false,
			allowedCapabilities: restrictedCapabilities
		};

		expect(
			resolvePatientPermissions({ role: 'owner', access: restrictedAccess } as any)
		).toMatchObject({
			canViewRadiographs: true,
			canUploadRadiographs: false,
			canViewRadiographTrash: true,
			canTrashRadiographs: false
		});
		expect(
			resolvePatientPermissions({ role: 'professional', access: restrictedAccess } as any)
		).toMatchObject({
			canViewRadiographs: false,
			canUploadRadiographs: false,
			canViewRadiographTrash: false,
			canTrashRadiographs: false
		});
	});
});

describe('patient detail migrated actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createSupabaseServerClient.mockResolvedValue(mocks.supabase);
		mocks.createSupabaseAdminClient.mockResolvedValue(mocks.admin);
		mocks.getAuthUserId.mockResolvedValue(ownerId);
		mocks.admin.rpc.mockResolvedValue({ data: [{ patient_id: patientId }], error: null });
		mocks.resolveActiveBusiness.mockResolvedValue({
			business: { id: businessId },
			role: 'owner',
			access: { canEnterApp: true, canUseBusiness: true, allowedCapabilities: { ...allCapabilities } }
		});
	});

	it('creates clinical entries through the safe RPC instead of direct table writes', async () => {
		const savedEntry = {
			id: 'entry-1',
			patient_id: patientId,
			created_at: '2026-06-05T12:30:00.000Z',
			entry_type: 'Consulta',
			description: 'Control clinico',
			teeth: '11',
			internal_note: 'nota interna',
			created_by_user_id: ownerId,
			locked_after: '2026-06-06T12:30:00.000Z',
			amount: 12000
		};
		mocks.supabase.rpc.mockResolvedValue({ data: savedEntry, error: null });

		const form = new FormData();
		form.set('entry_type', 'Consulta');
		form.set('description', 'Control clinico');
		form.set('created_at', '2026-06-05T09:30');
		form.set('teeth', '11');
		form.set('amount', '12.000');
		form.set('internal_note', 'nota interna');

		const result = await actions.add_entry!(makeEvent(form, { enhanced: true }));

		expect(mocks.supabase.rpc).toHaveBeenCalledWith('create_clinical_entry_with_result_safely', {
			p_business_id: businessId,
			p_patient_id: patientId,
			p_entry_type: 'Consulta',
			p_description: 'Control clinico',
			p_created_at: expect.any(String),
			p_teeth: '11',
			p_internal_note: 'nota interna',
			p_amount: 12000
		});
		expect(result).toEqual({ savedEntry });
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('keeps the redirect fallback for clinical entry submissions without JavaScript', async () => {
		mocks.supabase.rpc.mockResolvedValue({
			data: {
				id: 'entry-1',
				patient_id: patientId,
				created_at: '2026-06-05T12:30:00.000Z',
				entry_type: 'Consulta',
				description: 'Control clinico',
				teeth: null,
				internal_note: null,
				created_by_user_id: ownerId,
				locked_after: '2026-06-06T12:30:00.000Z',
				amount: null
			},
			error: null
		});

		const form = new FormData();
		form.set('entry_type', 'Consulta');
		form.set('description', 'Control clinico');
		form.set('created_at', '2026-06-05T09:30');

		await expectRedirectToPatient(actions.add_entry!(makeEvent(form)), 'historial');
	});

	it('returns a specific patient error when the clinical entry RPC rejects the patient scope', async () => {
		mocks.supabase.rpc.mockResolvedValue({ data: null, error: { message: 'PATIENT_NOT_FOUND' } });

		const form = new FormData();
		form.set('entry_type', 'Consulta');
		form.set('description', 'Control clinico');
		form.set('created_at', '2026-06-05T09:30');

		const result = (await actions.add_entry!(makeEvent(form))) as any;

		expect(result.status).toBe(404);
		expect(result.data.message).toBe('Paciente no encontrado en este consultorio.');
		expect(mocks.supabase.rpc).toHaveBeenCalledWith(
			'create_clinical_entry_with_result_safely',
			expect.any(Object)
		);
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('returns a specific permission error when the clinical entry RPC denies write access', async () => {
		mocks.supabase.rpc.mockResolvedValue({ data: null, error: { message: 'CLINICAL_ENTRY_DENIED' } });

		const form = new FormData();
		form.set('entry_type', 'Consulta');
		form.set('description', 'Control clinico');
		form.set('created_at', '2026-06-05T09:30');

		const result = (await actions.add_entry!(makeEvent(form))) as any;

		expect(result.status).toBe(403);
		expect(result.data.message).toBe('Tu rol no permite modificar la historia clinica de este paciente.');
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('archives patients through the safe RPC instead of direct table updates', async () => {
		mocks.supabase.rpc.mockResolvedValue({ error: null });

		try {
			await actions.archive_patient!(makeEvent());
			throw new Error('Expected redirect');
		} catch (err) {
			expect(err).toMatchObject({
				status: 303,
				location: '/odonto/pacientes?estado=archivados'
			});
		}

		expect(mocks.supabase.rpc).toHaveBeenCalledWith('set_patient_archive_state_safely', {
			p_business_id: businessId,
			p_patient_id: patientId,
			p_archived: true
		});
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('maps a stale archive target to a patient-not-found response', async () => {
		mocks.supabase.rpc.mockResolvedValue({ error: { message: 'PATIENT_NOT_FOUND' } });

		const result = (await actions.archive_patient!(makeEvent())) as any;

		expect(result.status).toBe(404);
		expect(result.data.message).toBe('Paciente no encontrado.');
	});

	it('maps archive permission failures without returning a server error', async () => {
		mocks.supabase.rpc.mockResolvedValue({ error: { message: 'PATIENT_ARCHIVE_DENIED' } });

		const result = (await actions.unarchive_patient!(makeEvent())) as any;

		expect(result.status).toBe(403);
		expect(result.data.message).toBe('No tenés permiso para archivar este paciente.');
	});

	it('updates clinical entries through the safe RPC instead of direct table writes', async () => {
		mocks.supabase.rpc.mockResolvedValue({ data: null, error: null });

		const form = new FormData();
		form.set('entry_id', 'entry-1');
		form.set('entry_type', 'Tratamiento');
		form.set('description', 'Evolucion controlada');
		form.set('created_at', '2026-06-05T10:00');
		form.set('teeth', '21');
		form.set('amount', '18.500');
		form.set('internal_note', 'seguimiento');

		await expectRedirectToPatient(actions.update_entry!(makeEvent(form)), 'historial');

		expect(mocks.supabase.rpc).toHaveBeenCalledWith('update_clinical_entry_safely', {
			p_business_id: businessId,
			p_patient_id: patientId,
			p_entry_id: 'entry-1',
			p_entry_type: 'Tratamiento',
			p_description: 'Evolucion controlada',
			p_teeth: '21',
			p_internal_note: 'seguimiento',
			p_amount: 18500
		});
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('unarchives patients through the safe RPC', async () => {
		mocks.supabase.rpc.mockResolvedValue({ error: null });

		try {
			await actions.unarchive_patient!(makeEvent());
			throw new Error('Expected redirect');
		} catch (err) {
			expect(err).toMatchObject({
				status: 303,
				location: '/odonto/pacientes'
			});
		}

		expect(mocks.supabase.rpc).toHaveBeenCalledWith('set_patient_archive_state_safely', {
			p_business_id: businessId,
			p_patient_id: patientId,
			p_archived: false
		});
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('does not attempt direct destructive patient deletion', async () => {
		const result = (await actions.delete_patient!(makeEvent())) as any;

		expect(result.status).toBe(403);
		expect(result.data.message).toContain('no se eliminan directamente');
		expect(mocks.supabase.from).not.toHaveBeenCalled();
		expect(mocks.supabase.rpc).not.toHaveBeenCalled();
	});

	it('archives a professional patient only on the professional link', async () => {
		makeProfessionalContext();
		const updateBuilder = makeQueryBuilder({ result: { data: { id: 'link-1' }, error: null } });
		mockAdminBuilders([
			makeQueryBuilder({
				maybeSingleResult: {
					data: { professional_id: 'prof-1', professionals: { name: 'Dra. Test' } },
					error: null
				}
			}),
			makeQueryBuilder({
				maybeSingleResult: { data: { id: 'link-1', archived_at: null }, error: null }
			}),
			updateBuilder
		]);

		try {
			await actions.archive_patient!(makeEvent());
			throw new Error('Expected redirect');
		} catch (err) {
			expect(err).toMatchObject({
				status: 303,
				location: '/odonto/pacientes?estado=archivados'
			});
		}

		expect(mocks.supabase.rpc).not.toHaveBeenCalledWith('set_patient_archive_state_safely', expect.any(Object));
		expect(updateBuilder.update).toHaveBeenCalledWith(
			expect.objectContaining({
				archived_by: ownerId,
				archived_at: expect.any(String)
			})
		);
		expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'link-1');
	});

	it('shows a human deletion message for professionals instead of attempting deletion', async () => {
		makeProfessionalContext();

		const result = (await actions.delete_patient!(makeEvent())) as any;

		expect(result.status).toBe(403);
		expect(result.data.message).toBe('Para eliminar un paciente, consultá al dueño del consultorio.');
		expect(mocks.supabase.from).not.toHaveBeenCalled();
		expect(mocks.supabase.rpc).not.toHaveBeenCalled();
		expect(mocks.admin.from).not.toHaveBeenCalled();
	});

	it('lets a linked professional edit patient data and records a visible change event', async () => {
		makeProfessionalContext();
		const eventInsertBuilder = makeQueryBuilder({ result: { error: null } });
		mockAdminBuilders([
			makeQueryBuilder({
				maybeSingleResult: {
					data: { professional_id: 'prof-1', professionals: { name: 'Dra. Test' } },
					error: null
				}
			}),
			makeQueryBuilder({
				maybeSingleResult: { data: { id: 'link-1', archived_at: null }, error: null }
			}),
			makeQueryBuilder({
				maybeSingleResult: {
					data: {
						full_name: 'Paciente Original',
						dni: null,
						phone: null,
						email: null,
						birth_date: null,
						address: null,
						insurance: null,
						insurance_plan: null,
						updated_at: '2026-08-31T12:00:00.000Z'
					},
					error: null
				}
			}),
			makeQueryBuilder({
				maybeSingleResult: {
					data: {
						allergies: null,
						medication: null,
						background: null,
						updated_at: '2026-08-31T12:00:00.000Z'
					},
					error: null
				}
			}),
			eventInsertBuilder
		]);

		const form = new FormData();
		form.set('full_name', 'Paciente Nuevo');
		form.set('phone', '112233');

		await expectRedirectToPatient(actions.update_patient!(makeEvent(form)), 'datos');

		expect(mocks.admin.rpc).toHaveBeenCalledWith(
			'update_patient_with_clinical_profile_safely',
			expect.objectContaining({
			p_actor_id: ownerId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_full_name: 'Paciente Nuevo',
			p_phone: '112233',
			p_update_clinical_profile: true,
			p_expected_patient_updated_at: '2026-08-31T12:00:00.000Z',
			p_expected_clinical_profile_updated_at: '2026-08-31T12:00:00.000Z'
		})
		);
		expect(eventInsertBuilder.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				business_id: businessId,
				patient_id: patientId,
				changed_by_user_id: ownerId,
				changed_by_professional_id: 'prof-1',
				changed_by_name: 'Dra. Test',
				changed_fields: ['nombre', 'teléfono'],
				summary: 'Se modificó: nombre y teléfono.'
			})
		);
	});

	it('does not report success when the patient disappeared between read and update', async () => {
		mocks.admin.rpc.mockResolvedValue({ data: null, error: { message: 'PATIENT_UPDATE_CONFLICT' } });
		mockAdminBuilders([
			makeQueryBuilder({
				maybeSingleResult: {
					data: {
						full_name: 'Paciente Original',
						dni: null,
						phone: null,
						email: null,
						birth_date: null,
						address: null,
						insurance: null,
						insurance_plan: null,
						updated_at: '2026-08-31T12:00:00.000Z'
					},
					error: null
				}
			}),
			makeQueryBuilder({
				maybeSingleResult: {
					data: { allergies: null, medication: null, background: null, updated_at: '2026-08-31T12:00:00.000Z' },
					error: null
				}
			})
		]);

		const form = new FormData();
		form.set('full_name', 'Paciente Nuevo');
		const result = (await actions.update_patient!(makeEvent(form))) as any;

		expect(result.status).toBe(409);
		expect(result.data.message).toContain('cambió mientras la editabas');
		expect(mocks.admin.rpc).toHaveBeenCalledWith(
			'update_patient_with_clinical_profile_safely',
			expect.any(Object)
		);
	});

	it('rejects a form based on a stale patient version before mutating either record', async () => {
		mockAdminBuilders([
			makeQueryBuilder({
				maybeSingleResult: {
					data: {
						full_name: 'Paciente Original',
						dni: null,
						phone: null,
						email: null,
						birth_date: null,
						address: null,
						insurance: null,
						insurance_plan: null,
						updated_at: '2026-08-31T12:00:00.000Z'
					},
					error: null
				}
			}),
			makeQueryBuilder({ maybeSingleResult: { data: null, error: null } })
		]);

		const form = new FormData();
		form.set('full_name', 'Paciente Nuevo');
		form.set('expected_patient_updated_at', '2026-08-31T11:00:00.000Z');
		const result = (await actions.update_patient!(makeEvent(form))) as any;

		expect(result.status).toBe(409);
		expect(result.data.message).toContain('cambió mientras la editabas');
		expect(mocks.admin.rpc).not.toHaveBeenCalled();
	});

	it('does not report success when the clinical profile loses its optimistic race', async () => {
		mocks.admin.rpc.mockResolvedValue({ data: null, error: { message: 'PATIENT_UPDATE_CONFLICT' } });
		mockAdminBuilders([
			makeQueryBuilder({
				maybeSingleResult: {
					data: {
						full_name: 'Paciente Original',
						dni: null,
						phone: null,
						email: null,
						birth_date: null,
						address: null,
						insurance: null,
						insurance_plan: null,
						updated_at: '2026-08-31T12:00:00.000Z'
					},
					error: null
				}
			}),
			makeQueryBuilder({
				maybeSingleResult: {
					data: { allergies: null, medication: null, background: null, updated_at: '2026-08-31T12:00:00.000Z' },
					error: null
				}
			})
		]);

		const form = new FormData();
		form.set('full_name', 'Paciente Nuevo');
		form.set('allergies', 'Penicilina');
		const result = (await actions.update_patient!(makeEvent(form))) as any;

		expect(result.status).toBe(409);
		expect(result.data.message).toContain('cambió mientras la editabas');
	});
});
