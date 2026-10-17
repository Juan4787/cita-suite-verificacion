// Synthetic contract fixtures only. Never imported by production code.
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const scope = { businessId: id(1), scope: 'public' as const };
export const catalog = () => ({
	schema_version: 2, business_id: id(1), scope: 'public', configuration_revision: 4, generated_at: '2026-10-17T12:00:00Z',
	business: { timezone: 'America/Argentina/Buenos_Aires', max_booking_days_ahead: 90, min_booking_notice_minutes: 60,
		is_active: true, public_booking_enabled: true },
	services: [{ id: id(2), business_id: id(1), name: 'Synthetic service', description: null, price_label: null, duration_minutes: 30,
		buffer_before_minutes: 15, buffer_after_minutes: 10, is_active: true, is_public: true, sort_order: 0 }],
	professionals: [{ id: id(3), name: 'Synthetic professional', specialty: null, avatar_url: null, is_active: true, is_public: true, sort_order: 0 }],
	assignments: [{ service_id: id(2), professional_id: id(3) }],
	rules: [{ id: id(4), professional_id: id(3), weekday: 1, start_time: '09:00:00', end_time: '19:00:00',
		slot_interval_minutes: 30, break_minutes: 15, is_active: true, service_scope: 'restricted', allowed_service_ids: [] }]
});
export const expectedWindow = { ...scope, configurationRevision: 4, fromDate: '2026-10-19', toDate: '2026-11-02', professionalIds: [id(3)] };
export const window = () => ({
	schema_version: 2, complete: true, business_id: id(1), scope: 'public', configuration_revision: 4,
	generated_at: '2026-10-17T12:00:00Z', from_date: '2026-10-19', to_date: '2026-11-02', professional_ids: [id(3)],
	counts: { exceptions: 0, blocks: 1 }, exceptions: [],
	blocks: [{ id: id(5), appointment_id: id(6), professional_id: id(3), starts_at: '2026-10-19T09:30:00Z', ends_at: '2026-10-19T10:00:00Z',
		base_blocking_starts_at: '2026-10-19T09:15:00Z', base_blocking_ends_at: '2026-10-19T10:10:00Z',
		blocking_starts_at: '2026-10-19T09:15:00Z', blocking_ends_at: '2026-10-19T10:25:00Z' }]
});

