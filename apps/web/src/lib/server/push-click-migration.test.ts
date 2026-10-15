import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL(
		'../../../../../supabase/migrations/20260824031000_push_device_contract.sql',
		import.meta.url
	),
	'utf8'
);

describe('registro transaccional de interacción con Web Push', () => {
	it('distingue el clic de displayed y de la confirmación manual', () => {
		const functionBody = migration.slice(
			migration.indexOf('create or replace function public.record_push_notification_click'),
			migration.indexOf('revoke all on function public.record_push_notification_click')
		);
		expect(functionBody).toContain('clicked_at = coalesce(delivery.clicked_at, click_time)');
		expect(functionBody).toContain('user_reported_missing_at = null');
		expect(functionBody).not.toContain('user_confirmed_at = click_time');
	});

	it('autentica turno y entrega con el hash del secreto antes de verificar cobertura', () => {
		const functionBody = migration.slice(
			migration.indexOf('create or replace function public.record_push_notification_click'),
			migration.indexOf(
				'revoke all on function public.record_push_notification_click'
			)
		);

		expect(functionBody).toContain('delivery.id = target_delivery_id');
		expect(functionBody).toContain('delivery.appointment_id = target_appointment_id');
		expect(functionBody).toContain(
			'delivery.receipt_token_hash = target_receipt_token_hash'
		);
		expect(functionBody).toContain('subscription.appointment_id = target_appointment_id');
		expect(functionBody).toContain('subscription.detached_at is null');
		expect(functionBody).toContain(
			'last_notification_clicked_at = greatest(device.last_notification_clicked_at, click_time)'
		);
		expect(functionBody).toContain('device.provider_gone_at is null');
		expect(functionBody).not.toContain('subscription.verified_at');
		expect(functionBody).not.toContain('subscription.revoked_at');
	});

	it('no condiciona ni consume los avisos automáticos', () => {
		const functionBody = migration.slice(
			migration.indexOf('create or replace function public.record_push_notification_click'),
			migration.indexOf('revoke all on function public.record_push_notification_click')
		);
		expect(functionBody).not.toContain('claim_due_push_reminders');
		expect(functionBody).not.toContain('push_24h_sent_at =');
		expect(functionBody).not.toContain('push_2h_sent_at =');
		expect(functionBody).not.toContain('push_24h_claimed_at =');
		expect(functionBody).not.toContain('push_2h_claimed_at =');
	});

	it('serializa la respuesta manual y hace prevalecer un clic real', () => {
		const feedbackFunction = migration.slice(
			migration.indexOf('create or replace function public.record_push_test_feedback'),
			migration.indexOf('revoke all on function public.record_push_test_feedback')
		);

		expect(feedbackFunction).toContain("delivery.kind = 'test'");
		expect(feedbackFunction).toContain('delivery.accepted_at is not null');
		expect(feedbackFunction).toContain('for update');
		expect(feedbackFunction).toContain('elsif delivery_clicked_at is null then');
		expect(feedbackFunction).toContain('if delivery_clicked_at is not null then');
		expect(feedbackFunction).toContain('subscription.detached_at is null');
		expect(feedbackFunction).toContain(
			'last_test_confirmed_at = greatest(device.last_test_confirmed_at, feedback_time)'
		);
	});

	it('mantiene la operación privada para el servicio interno', () => {
		expect(migration).toContain('revoke all on function public.record_push_notification_click(');
		expect(migration).toContain('from public, anon, authenticated');
		expect(migration).toContain('to service_role');
		expect(migration).toContain('revoke all on function public.record_push_test_feedback(');
	});
});
