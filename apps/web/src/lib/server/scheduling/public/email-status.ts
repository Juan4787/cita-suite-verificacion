// What the practice can see and decide about its email. Facts stay separate, so the screen never
// implies that sending works: a preference, a prepared sender and an accepted message are different.
import { readBoolean, readChoice, readFiniteNumber, readNullableText, readRecord, readText } from '$lib/contracts/json';
import type { AppointmentEmailDelivery } from '$lib/scheduling/email-policy';
import type { CitaSupabaseClient } from '$lib/types/database';

export const EMAIL_DOMAIN_STATES = ['unprovisioned', 'dns_pending', 'verified', 'failed', 'disabled'] as const;
export const EMAIL_DELIVERY_STATES = ['pending', 'sending', 'retry', 'accepted', 'delivered', 'uncertain', 'failed', 'bounced', 'complained', 'discarded'] as const;
export const EMAIL_PURPOSES = ['booking_receipt', 'reschedule_receipt', 'cancellation_receipt', 'deposit_request', 'reminder_72h', 'reminder_24h'] as const;

export const parseBusinessEmailStatus = (value: unknown) => {
 const row = readRecord(value, 'email.status');
 return {
  domainState: readChoice(row.domain_state, EMAIL_DOMAIN_STATES, 'email.status.domain'),
  fromAddress: readNullableText(row.from_address, 'email.status.from'),
  ready: readBoolean(row.ready, 'email.status.ready'),
  producerEnabled: readBoolean(row.producer_enabled, 'email.status.producer'),
  paused: readBoolean(row.paused, 'email.status.paused'),
  used24h: readFiniteNumber(row.used_24h, 'email.status.used'),
  dailyLimit: readFiniteNumber(row.daily_limit, 'email.status.limit'),
  needsReview: readFiniteNumber(row.needs_review, 'email.status.review'),
  failed7d: readFiniteNumber(row.failed_7d, 'email.status.failed')
 };
};
export type BusinessEmailStatus = ReturnType<typeof parseBusinessEmailStatus>;

export const loadBusinessEmailStatus = async (supabase: CitaSupabaseClient, businessId: string) => {
 const { data, error } = await supabase.rpc('get_business_email_status', { p_business_id: businessId });
 if (error) throw error;
 return parseBusinessEmailStatus(data);
};

export const parseAppointmentEmailDeliveries = (value: unknown): AppointmentEmailDelivery[] => {
 if (!Array.isArray(value)) throw new Error('email.deliveries');
 return value.map((entry) => {
  const row = readRecord(entry, 'email.delivery');
  return {
   id: readText(row.id, 'email.delivery.id'),
   purpose: readChoice(row.purpose, EMAIL_PURPOSES, 'email.delivery.purpose'),
   state: readChoice(row.state, EMAIL_DELIVERY_STATES, 'email.delivery.state'),
   recipient: readNullableText(row.recipient, 'email.delivery.recipient'),
   createdAt: readText(row.created_at, 'email.delivery.created'),
   acceptedAt: readNullableText(row.accepted_at, 'email.delivery.accepted'),
   deliveredAt: readNullableText(row.delivered_at, 'email.delivery.delivered'),
   discardReason: readNullableText(row.discard_reason, 'email.delivery.discard')
  };
 });
};
export const loadAppointmentEmailDeliveries = async (supabase: CitaSupabaseClient, businessId: string, appointmentId: string) => {
 const { data, error } = await supabase.rpc('list_appointment_email_deliveries', { p_business_id: businessId, p_appointment_id: appointmentId });
 if (error) throw error;
 return parseAppointmentEmailDeliveries(data);
};

export const resolveAppointmentEmailDelivery = async (supabase: CitaSupabaseClient, businessId: string, deliveryId: string, decision: 'resend' | 'dismiss') => {
 const { error } = await supabase.rpc('resolve_appointment_email_delivery', { p_business_id: businessId, p_delivery_id: deliveryId, p_decision: decision });
 if (error) throw error;
};
