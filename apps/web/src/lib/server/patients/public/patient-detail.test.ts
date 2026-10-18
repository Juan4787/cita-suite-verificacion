import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import type { BusinessContext } from '$lib/access/contracts';
import { getBusinessAccessState } from '$lib/access/commercial-access';
import { readPatientDetail } from './patient-detail';

const businessId = 'a6400000-0000-4000-8000-000000000001';
const patientId = 'a6400000-0000-4000-8000-000000000002';
const userId = 'a6400000-0000-4000-8000-000000000003';
function context(): BusinessContext {
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

describe('authorized patient detail projection with typed SDK and simulated HTTP', () => {
 it('returns an authoritative empty history and defers documents without requesting metadata, grants or originals', async () => {
  const requests: URL[] = [];
  const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
   auth: { persistSession: false, autoRefreshToken: false },
   global: { fetch: async input => {
    const url = new URL(input instanceof Request ? input.url : String(input)); requests.push(url);
    const table = url.pathname.split('/').at(-1);
    if (table === 'patients') return Response.json({ id: patientId, full_name: 'Synthetic patient',
     dni: null, phone: null, email: null, birth_date: null, address: null, insurance: null, insurance_plan: null,
     archived_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
    if (table === 'patient_clinical_profiles') return Response.json(null);
    if (table === 'clinical_entries' || table === 'appointments') return Response.json([]);
    throw new Error('Unexpected patient projection request');
   } }
  });
  const result = await readPatientDetail({ patientId, supabase: client, admin: client, context: context(), currentUserId: userId });
  expect(result.patient.id).toBe(patientId);
  expect(result.entries).toEqual([]);
  expect(result.hasMoreEntries).toBe(false);
  expect(result.radiographs).toEqual([]);
  expect(result.permissions.canViewRadiographs).toBe(true);
  expect(result.documentUploads).toBe('not_permitted');
  expect(requests.map(url => url.pathname.split('/').at(-1)).sort()).toEqual([
   'appointments', 'clinical_entries', 'patient_clinical_profiles', 'patients'
  ]);
  expect(requests.every(url => url.searchParams.get('business_id') === 'eq.' + businessId)).toBe(true);
 });
});
