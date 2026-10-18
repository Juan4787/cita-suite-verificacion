import type { BusinessContext } from '$lib/access/contracts';
import { getBusinessAccessState } from '$lib/access/commercial-access';

export const businessId = 'a6400000-0000-4000-8000-000000000001';
export const patientId = 'a6400000-0000-4000-8000-000000000002';
export const userId = 'a6400000-0000-4000-8000-000000000003';
export function patientContext(): BusinessContext {
 const access = getBusinessAccessState({ business_id: businessId, commercial_access_enabled: true,
  is_permanent: true, subscription_status: 'active' });
 access.allowedCapabilities.canManagePatientFiles = false;
 return { role: 'owner', canManage: true, canOperate: true, access, business: {
  id: businessId, name: 'Synthetic patient projection', slug: 'synthetic-patient-projection', industry: 'other',
  phone: null, email: null, address: null, address_instructions: null, maps_url: null, logo_url: null,
  timezone: 'UTC', public_booking_enabled: true, whatsapp_enabled: false, allow_same_day_booking: true,
  min_booking_notice_minutes: 0, max_booking_days_ahead: 60, cancellation_policy: null, is_active: true
 } };
}

