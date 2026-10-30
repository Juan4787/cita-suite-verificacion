import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_DEPOSIT_POLICY,
	DEPOSIT_LIST_LIMIT,
	DepositError,
	getDepositErrorCode,
	getDepositErrorMessage,
	getDepositErrorStatus,
	loadDepositList,
	loadDepositTermsForSlots,
	openDepositReminder,
	saveDepositPolicy,
	setAppointmentDeposit
} from '$lib/server/scheduling/public/deposits';

const BUSINESS = '00000000-0000-4000-8000-0000000000b1';
const APPOINTMENT = '00000000-0000-4000-8000-0000000000a1';

const rpcClient = (result: { data: unknown; error: unknown }) => {
	const calls: Array<{ name: string; args: unknown }> = [];
	const rpc = vi.fn((name: string, args: unknown) => {
		calls.push({ name, args });
		const pending = Promise.resolve(result);
		return Object.assign(pending, { single: () => pending });
	});
	return { client: { rpc } as never, calls, rpc };
};

describe('registro de la seña', () => {
	it('no consulta la base con un identificador mal formado', async () => {
		const { client, rpc } = rpcClient({ data: null, error: null });
		await expect(
			setAppointmentDeposit(client, { businessId: BUSINESS, appointmentId: 'no-uuid', action: 'paid', expectedRevision: 1 })
		).rejects.toMatchObject({ code: 'DEPOSIT_NOT_FOUND' });
		await expect(
			setAppointmentDeposit(client, { businessId: BUSINESS, appointmentId: APPOINTMENT, action: 'paid', expectedRevision: 0 })
		).rejects.toMatchObject({ code: 'DEPOSIT_CHANGED' });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('manda la acción con la revisión leída y devuelve el estado de la seña y del turno', async () => {
		const { client, calls } = rpcClient({ data: { status: 'paid', revision: 4, appointment_status: 'confirmed' }, error: null });
		await expect(
			setAppointmentDeposit(client, {
				businessId: BUSINESS,
				appointmentId: APPOINTMENT,
				action: 'paid',
				expectedRevision: 3,
				note: '  comprobante por WhatsApp  '
			})
		).resolves.toEqual({ status: 'paid', revision: 4, appointmentStatus: 'confirmed' });
		expect(calls).toEqual([
			{
				name: 'set_appointment_deposit',
				args: {
					p_business_id: BUSINESS,
					p_appointment_id: APPOINTMENT,
					p_action: 'paid',
					p_expected_revision: 3,
					p_note: 'comprobante por WhatsApp'
				}
			}
		]);
	});

	it('traduce cada regla de la base y nunca adivina una que no conoce', async () => {
		for (const code of ['DEPOSIT_CHANGED', 'DEPOSIT_APPOINTMENT_CLOSED', 'DEPOSIT_FORBIDDEN'] as const) {
			const { client } = rpcClient({ data: null, error: { message: code, code: 'P0001' } });
			await expect(
				setAppointmentDeposit(client, { businessId: BUSINESS, appointmentId: APPOINTMENT, action: 'paid', expectedRevision: 1 })
			).rejects.toMatchObject({ code });
		}
		const { client } = rpcClient({ data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } });
		await expect(
			setAppointmentDeposit(client, { businessId: BUSINESS, appointmentId: APPOINTMENT, action: 'paid', expectedRevision: 1 })
		).rejects.toMatchObject({ code: 'DEPOSIT_UNEXPECTED' });
	});

	it('reconoce la regla de confirmación entera, sin confundirla con otra que la contenga', () => {
		expect(getDepositErrorCode({ message: 'APPOINTMENT_DEPOSIT_PENDING' })).toBe('APPOINTMENT_DEPOSIT_PENDING');
		expect(getDepositErrorCode({ message: 'XAPPOINTMENT_DEPOSIT_PENDING' })).toBeNull();
		expect(getDepositErrorCode({ details: 'DEPOSIT_POLICY_INVALID' })).toBe('DEPOSIT_POLICY_INVALID');
		expect(getDepositErrorMessage('APPOINTMENT_DEPOSIT_PENDING')).toContain('Confirmar seña');
		expect(getDepositErrorStatus('DEPOSIT_CHANGED')).toBe(409);
		expect(getDepositErrorStatus('DEPOSIT_FORBIDDEN')).toBe(403);
		expect(new DepositError('DEPOSIT_NOT_FOUND').code).toBe('DEPOSIT_NOT_FOUND');
	});
});

describe('política de señas', () => {
	it('envía la política completa con los nombres de la base y devuelve la revisión nueva', async () => {
		const { client, calls } = rpcClient({ data: 2, error: null });
		await expect(
			saveDepositPolicy(client, {
				businessId: BUSINESS,
				expectedRevision: 1,
				policy: { ...DEFAULT_DEPOSIT_POLICY, enabled: true, fixedAmount: 40000, transferDetails: null, excludedServiceIds: [] }
			})
		).resolves.toBe(2);
		expect(calls[0]).toEqual({
			name: 'save_deposit_policy',
			args: {
				p_business_id: BUSINESS,
				p_settings: {
					enabled: true,
					auto_cancel_enabled: false,
					amount_mode: 'fixed',
					fixed_amount: 40000,
					percentage: null,
					request_days: 7,
					deadline_hours: 48,
					min_payment_hours: 24,
					transfer_details: '',
					applies_to_manual: true,
					excluded_service_ids: []
				},
				p_expected_revision: 1
			}
		});
	});

	it('una versión ajena es un conflicto explícito', async () => {
		const { client } = rpcClient({ data: null, error: { message: 'DEPOSIT_POLICY_CHANGED' } });
		await expect(
			saveDepositPolicy(client, { businessId: BUSINESS, expectedRevision: 1, policy: DEFAULT_DEPOSIT_POLICY })
		).rejects.toMatchObject({ code: 'DEPOSIT_POLICY_CHANGED' });
	});
});

describe('apertura del pedido de seña por WhatsApp', () => {
	it('no consulta la base con un identificador mal formado', async () => {
		const { client, rpc } = rpcClient({ data: null, error: null });
		await expect(
			openDepositReminder(client, { businessId: BUSINESS, appointmentId: 'no-es-uuid', reopen: false })
		).rejects.toMatchObject({ code: 'DEPOSIT_NOT_FOUND' });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('pasa a la base si la persona confirmó volver a abrirlo', async () => {
		for (const reopen of [false, true]) {
			const { client, calls } = rpcClient({ data: { previously_opened_at: null, opened_at: '2026-11-10T12:00:00+00:00' }, error: null });
			await expect(openDepositReminder(client, { businessId: BUSINESS, appointmentId: APPOINTMENT, reopen })).resolves.toEqual({
				previouslyOpenedAt: null
			});
			expect(calls[0]).toEqual({
				name: 'open_appointment_deposit_reminder',
				args: { p_business_id: BUSINESS, p_appointment_id: APPOINTMENT, p_reopen: reopen }
			});
		}
	});

	it('una segunda apertura sin confirmar y una seña ya resuelta son conflictos con su propio mensaje', async () => {
		for (const code of ['DEPOSIT_REMINDER_ALREADY_OPENED', 'DEPOSIT_NOT_PENDING'] as const) {
			const { client } = rpcClient({ data: null, error: { message: code } });
			await expect(
				openDepositReminder(client, { businessId: BUSINESS, appointmentId: APPOINTMENT, reopen: false })
			).rejects.toMatchObject({ code });
			expect(getDepositErrorStatus(code)).toBe(409);
			expect(getDepositErrorMessage(code)).not.toMatch(/cancelado/);
		}
	});
});

describe('condiciones antes de reservar', () => {
	const input = (slotStartsAt: string[]) => ({
		businessId: BUSINESS,
		serviceId: APPOINTMENT,
		slotStartsAt,
		source: 'public_booking' as const,
		priceQuote: { amount: 115000 }
	});

	it('pide todos los horarios del día de una vez y responde con las claves del turnero', async () => {
		const { client, calls } = rpcClient({
			data: [
				{ starts_at: '2026-11-20T13:00:00+00:00', required: true, amount: 40000, due_at: '2026-11-18T13:00:00+00:00', auto_cancel: true },
				{ starts_at: '2026-11-20T14:00:00+00:00', required: false, amount: null, due_at: null, auto_cancel: null }
			],
			error: null
		});
		await expect(
			loadDepositTermsForSlots(client, input(['2026-11-20T13:00:00.000Z', '2026-11-20T14:00:00.000Z']))
		).resolves.toEqual({
			'2026-11-20T13:00:00.000Z': { amount: 40000, dueAt: '2026-11-18T13:00:00+00:00', autoCancel: true }
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			name: 'get_deposit_terms_for_slots',
			args: { p_starts_at: ['2026-11-20T13:00:00.000Z', '2026-11-20T14:00:00.000Z'], p_price_quote: { amount: 115000 } }
		});
	});

	it('sin horarios no consulta nada', async () => {
		const { client, calls } = rpcClient({ data: [], error: null });
		await expect(loadDepositTermsForSlots(client, input([]))).resolves.toEqual({});
		expect(calls).toHaveLength(0);
	});

	it('una respuesta incompleta, con un horario ajeno o con un monto inválido es un error, no un resultado parcial', async () => {
		const slot = '2026-11-20T13:00:00.000Z';
		for (const data of [
			[],
			[{ starts_at: '2026-11-21T13:00:00+00:00', required: false }],
			[{ starts_at: slot, required: true, amount: 0, due_at: '2026-11-18T13:00:00+00:00', auto_cancel: true }],
			[{ starts_at: slot, required: true, amount: 40000.5, due_at: '2026-11-18T13:00:00+00:00', auto_cancel: true }],
			[{ starts_at: slot, required: true, amount: 40000, due_at: null, auto_cancel: true }]
		]) {
			const { client } = rpcClient({ data, error: null });
			await expect(loadDepositTermsForSlots(client, input([slot]))).rejects.toBeDefined();
		}
	});

	it('un horario repetido se pide una sola vez', async () => {
		const { client, calls } = rpcClient({
			data: [{ starts_at: '2026-11-20T13:00:00+00:00', required: false }],
			error: null
		});
		await loadDepositTermsForSlots(client, input(['2026-11-20T13:00:00.000Z', '2026-11-20T13:00:00.000Z']));
		expect(calls[0]).toMatchObject({ args: { p_starts_at: ['2026-11-20T13:00:00.000Z'] } });
	});

	it('el error de la base se propaga', async () => {
		const { client } = rpcClient({ data: null, error: { message: 'DEPOSIT_TERMS_INVALID' } });
		await expect(loadDepositTermsForSlots(client, input(['2026-11-20T13:00:00.000Z']))).rejects.toBeDefined();
	});
});

describe('lista de señas', () => {
	const now = new Date('2026-11-10T12:00:00.000Z');
	const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
	const row = (id: string, overrides: Record<string, unknown> = {}, appointmentStatus = 'reserved') => ({
		appointment_id: id,
		status: 'pending',
		amount: 40000,
		currency: 'ARS',
		request_from: at(-1),
		due_at: at(72),
		auto_cancel: true,
		waived_reason: null,
		recorded_at: null,
		reminder_opened_at: null,
		reminder_opened_by: null,
		expired_at: null,
		revision: 1,
		appointments: { id, starts_at: at(120), status: appointmentStatus, confirmation_token: `token-${id}`, professional_id: `professional-${id}`, service_id: `service-${id}`, patients: { id: `patient-${id}`, full_name: `Paciente ${id}`, phone_e164: '+5493421112222' } },
		...overrides
	});
	const listClient = (rows: unknown[]) => {
		const calls: Array<[string, unknown[]]> = [];
		const builder: Record<string, unknown> = {};
		for (const method of ['select', 'eq', 'gt', 'or', 'order', 'limit']) {
			builder[method] = (...args: unknown[]) => {
				calls.push([method, args]);
				return method === 'limit' ? Promise.resolve({ data: rows, error: null }) : builder;
			};
		}
		return { client: { from: () => builder } as never, calls };
	};

	it('ubica cada seña en su sección y deja afuera las que no piden nada', async () => {
		const { client, calls } = listClient([
			row('a'),
			row('b', { due_at: at(10) }),
			row('c', { status: 'expired', expired_at: at(-24) }, 'cancelled'),
			row('d', {}, 'cancelled')
		]);
		const result = await loadDepositList(client, BUSINESS, now);
		expect(result.truncated).toBe(false);
		expect(result.items.map((item) => [item.appointment.id, item.section])).toEqual([
			['a', 'to_request'],
			['b', 'due_soon'],
			['c', 'cancelled']
		]);
		expect(result.items[0]).toMatchObject({
			appointment: { token: 'token-a', status: 'reserved', professionalId: 'professional-a', serviceId: 'service-a' },
			patient: { name: 'Paciente a', phoneE164: '+5493421112222' }
		});
		const filter = calls.find(([method]) => method === 'or')?.[1][0];
		expect(filter).toBe(`status.eq.pending,and(status.eq.expired,expired_at.gte."${new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString()}")`);
		expect(calls).toContainEqual(['eq', ['business_id', BUSINESS]]);
		// Turns that already started are left out by the query, not only by the sections.
		expect(calls).toContainEqual(['gt', ['appointments.starts_at', now.toISOString()]]);
		expect(calls).toContainEqual(['limit', [DEPOSIT_LIST_LIMIT + 1]]);
	});

	it('dice quién abrió el pedido por WhatsApp', async () => {
		const opener = '00000000-0000-4000-8000-0000000000c1';
		const { client } = listClient([row('a', { reminder_opened_at: at(-2), reminder_opened_by: opener })]);
		const result = await loadDepositList(client, BUSINESS, now);
		expect(result.items[0]).toMatchObject({ reminderOpenedBy: opener, deposit: { reminder_opened_at: at(-2) } });
	});

	it('si hay más señas que el límite lo dice, en vez de mostrar una parte como si fuera todo', async () => {
		const rows = Array.from({ length: DEPOSIT_LIST_LIMIT + 1 }, (_, index) => row(`r${index}`));
		const result = await loadDepositList(listClient(rows).client, BUSINESS, now);
		expect(result.truncated).toBe(true);
		expect(result.items).toHaveLength(DEPOSIT_LIST_LIMIT);
	});

	it('una fila mal formada es un error, nunca una seña omitida en silencio', async () => {
		await expect(loadDepositList(listClient([row('x', { amount: -5 })]).client, BUSINESS, now)).rejects.toThrow();
	});
});
