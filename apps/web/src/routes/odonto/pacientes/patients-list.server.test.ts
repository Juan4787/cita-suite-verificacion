import { describe, expect, it, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	createSupabaseServerClient: vi.fn(),
	getAuthUserId: vi.fn(),
	isJwtExpired: vi.fn(),
	resolveActiveBusiness: vi.fn(),
	supabase: {
		auth: {
			refreshSession: vi.fn()
		},
		from: vi.fn()
	},
	admin: {
		from: vi.fn()
	}
}));

vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getAuthUserId: mocks.getAuthUserId,
	isJwtExpired: mocks.isJwtExpired
}));

vi.mock('$lib/server/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));

const { actions } = await import('./+page.server');

const businessId = '00000000-0000-4000-8000-000000000001';
const professionalUserId = '00000000-0000-4000-8000-000000000002';
const professionalId = '00000000-0000-4000-8000-000000000003';
const patientId = '00000000-0000-4000-8000-000000000004';

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

const makeEvent = (formData = new FormData()) =>
	({
		request: new Request('http://localhost/odonto/pacientes', {
			method: 'POST',
			body: formData
		}),
		locals: {
			auth: {
				module: 'odonto',
				access_token: 'test-token',
				refresh_token: 'refresh-token'
			}
		},
		fetch,
		cookies: {
			set: vi.fn()
		}
	}) as any;

const chain = <T extends Record<string, unknown>>(extra: T) => {
	const builder: Record<string, any> = { ...extra };
	for (const method of ['select', 'eq', 'order', 'limit', 'range']) {
		builder[method] = vi.fn(() => builder);
	}
	return builder;
};

describe('patients create action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createSupabaseServerClient.mockResolvedValue(mocks.supabase);
		mocks.createSupabaseAdminClient.mockResolvedValue(mocks.admin);
		mocks.getAuthUserId.mockResolvedValue(professionalUserId);
		mocks.isJwtExpired.mockReturnValue(false);
		mocks.resolveActiveBusiness.mockResolvedValue({
			business: { id: businessId },
			role: 'professional',
			access: { allowedCapabilities: { ...allCapabilities } }
		});
	});

	it('links a patient created by a professional before redirecting to the patient detail', async () => {
		let insertedPatientId: string | null = null;
		const patientInsertBuilder = {
			insert: vi.fn(async (payload: { id?: string }) => {
				insertedPatientId = payload?.id ?? null;
				return { error: null };
			})
		};
		mocks.supabase.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientInsertBuilder;
			throw new Error(`Unexpected table ${table}`);
		});

		const professionalUserBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: { professional_id: professionalId }, error: null }))
		});
		const professionalPatientLinkBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: null, error: null })),
			insert: vi.fn(async () => ({ error: null }))
		});
		const patientLookupBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: null, error: null }))
		});
		mocks.admin.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientLookupBuilder;
			if (table === 'professional_users') return professionalUserBuilder;
			if (table === 'professional_patient_links') return professionalPatientLinkBuilder;
			throw new Error(`Unexpected admin table ${table}`);
		});

		const form = new FormData();
		form.set('full_name', 'Paciente Profesional');
		form.set('phone', '+54 9 11 5555-5555');

		try {
			await actions.create_patient!(makeEvent(form));
			throw new Error('Expected redirect');
		} catch (err: any) {
			expect(err).toMatchObject({
				status: 303,
				location: `/odonto/pacientes/${insertedPatientId}`
			});
		}

		expect(insertedPatientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		expect(professionalPatientLinkBuilder.insert).toHaveBeenCalledWith({
			business_id: businessId,
			professional_id: professionalId,
			patient_id: insertedPatientId,
			source: 'manual',
			created_by: professionalUserId
		});
	});

	it('creates a different patient even when the full name is exactly the same', async () => {
		let insertedPatientId: string | null = null;
		const patientInsertBuilder = {
			insert: vi.fn(async (payload: { id?: string }) => {
				insertedPatientId = payload?.id ?? null;
				return { error: null };
			})
		};
		mocks.supabase.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientInsertBuilder;
			throw new Error(`Unexpected table ${table}`);
		});

		const patientLookupBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: null, error: null }))
		});
		const professionalUserBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: { professional_id: professionalId }, error: null }))
		});
		const professionalPatientLinkBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: null, error: null })),
			insert: vi.fn(async () => ({ error: null }))
		});
		mocks.admin.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientLookupBuilder;
			if (table === 'professional_users') return professionalUserBuilder;
			if (table === 'professional_patient_links') return professionalPatientLinkBuilder;
			throw new Error(`Unexpected admin table ${table}`);
		});

		const form = new FormData();
		form.set('full_name', 'Juan Carlos Ramírez');
		form.set('phone', '+54 9 11 4444-4444');

		try {
			await actions.create_patient!(makeEvent(form));
			throw new Error('Expected redirect');
		} catch (err: any) {
			expect(err).toMatchObject({
				status: 303,
				location: `/odonto/pacientes/${insertedPatientId}`
			});
		}

		expect(insertedPatientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		expect(patientInsertBuilder.insert).toHaveBeenCalledWith(
			expect.objectContaining({ full_name: 'Juan Carlos Ramírez' })
		);
		expect(patientLookupBuilder.select).not.toHaveBeenCalled();
		expect(patientLookupBuilder.range).not.toHaveBeenCalled();
	});

	it('crea otra ficha cuando el teléfono ya pertenece a una persona distinta', async () => {
		let insertedPatientId: string | null = null;
		const patientInsertBuilder = {
			insert: vi.fn(async (payload: { id?: string }) => {
				insertedPatientId = payload?.id ?? null;
				return { error: null };
			})
		};
		mocks.supabase.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientInsertBuilder;
			throw new Error(`Unexpected table ${table}`);
		});

		const patientLookupBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: { id: patientId }, error: null }))
		});
		const professionalUserBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: { professional_id: professionalId }, error: null }))
		});
		const professionalPatientLinkBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: null, error: null })),
			insert: vi.fn(async () => ({ error: null }))
		});
		mocks.admin.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientLookupBuilder;
			if (table === 'professional_users') return professionalUserBuilder;
			if (table === 'professional_patient_links') return professionalPatientLinkBuilder;
			throw new Error(`Unexpected admin table ${table}`);
		});

		const form = new FormData();
		form.set('full_name', 'Otra persona');
		form.set('phone', '+54 9 11 5555-5555');

		try {
			await actions.create_patient!(makeEvent(form));
			throw new Error('Expected redirect');
		} catch (err: any) {
			expect(err).toMatchObject({
				status: 303,
				location: `/odonto/pacientes/${insertedPatientId}`
			});
		}

		expect(insertedPatientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		expect(patientInsertBuilder.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				full_name: 'Otra persona',
				phone_e164: '+5491155555555'
			})
		);
		expect(professionalPatientLinkBuilder.insert).toHaveBeenCalledWith({
			business_id: businessId,
			professional_id: professionalId,
			patient_id: insertedPatientId,
			source: 'manual',
			created_by: professionalUserId
		});
	});

	it('crea un paciente con rol owner sin requerir vínculo profesional', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue({
			business: { id: businessId },
			role: 'owner',
			access: { allowedCapabilities: { ...allCapabilities } }
		});

		let insertedPatientId: string | null = null;
		const patientInsertBuilder = {
			insert: vi.fn(async (payload: { id?: string }) => {
				insertedPatientId = payload?.id ?? null;
				return { error: null };
			})
		};
		mocks.supabase.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientInsertBuilder;
			throw new Error(`Unexpected table ${table}`);
		});

		const patientLookupBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: null, error: null }))
		});
		const professionalPatientLinkBuilder = chain({
			insert: vi.fn(async () => ({ error: null }))
		});
		mocks.admin.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientLookupBuilder;
			if (table === 'professional_patient_links') return professionalPatientLinkBuilder;
			throw new Error(`Unexpected admin table ${table}`);
		});

		const form = new FormData();
		form.set('full_name', 'Roberto');
		form.set('dni', '4125789');
		form.set('phone', '3652697');

		try {
			await actions.create_patient!(makeEvent(form));
			throw new Error('Expected redirect');
		} catch (err: any) {
			expect(err).toMatchObject({
				status: 303,
				location: `/odonto/pacientes/${insertedPatientId}`
			});
		}

		expect(insertedPatientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		expect(patientInsertBuilder.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				id: insertedPatientId,
				full_name: 'Roberto',
				dni: '4125789',
				business_id: businessId
			})
		);
		// Owner does not create professional patient links
		expect(professionalPatientLinkBuilder.insert).not.toHaveBeenCalled();
	});
});
