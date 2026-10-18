import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { json, error } from '@sveltejs/kit';
import { resolveBookingIntegrationRequest } from '$lib/server/sites/public/booking-integration-request';
import { parseServicePriceLabels } from '$lib/scheduling/price-contracts';
import { parsePublicCatalogue } from '$lib/sites/catalogue';
import { canUsePublicBusiness } from '$lib/server/scheduling/public/public-booking';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  try {
  const { integration } = await resolveBookingIntegrationRequest(event);
  const supabase = await createSupabaseAdminClient('odonto', event.fetch);
  const origin = event.request.headers.get('origin');
  if (origin && !integration.allowedOrigins.includes(origin)) error(403, 'Este sitio no está habilitado para consultar las prestaciones.');
  if (!integration.isActive || !(await canUsePublicBusiness(supabase, integration.businessId))) error(404, 'Las reservas todavía no están disponibles.');
  const { data, error: cause } = await supabase.rpc('get_public_booking_catalogue', { p_integration_id: integration.id });
  if (cause) error(503, 'No pudimos cargar las prestaciones. Volvé a intentar en unos minutos.');
  const catalogue = parsePublicCatalogue(data);
  const { data: labels, error: priceError } = await supabase.rpc('get_public_service_price_labels', {
    p_business_id: integration.businessId, p_service_ids: integration.serviceIds, p_professional_ids: integration.professionalIds
  });
  if (priceError) error(503, 'No pudimos comprobar los aranceles. Volvé a intentar.');
  const labelMap = parseServicePriceLabels(labels);
  for (const service of catalogue.services) {
    const label = labelMap.get(service.id);
    if (label !== undefined) service.price_label = label;
  }
  return json(catalogue, {
    headers: { ...(origin ? { 'access-control-allow-origin': origin } : {}), vary: 'Origin', 'cache-control': 'public, max-age=60, s-maxage=60', 'x-content-type-options': 'nosniff' }
  });
  } catch (cause) { event.setHeaders({ 'cache-control': 'no-store' }); throw cause; }
};
