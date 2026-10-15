import { json, error } from '@sveltejs/kit';
import { resolveBookingIntegrationRequest } from '$lib/server/booking-integration-request';
import {formatQuotedPrice} from '$lib/booking/pricing';
import { canUsePublicBusiness } from '$lib/server/public-booking';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  try {
  const { supabase, integration } = await resolveBookingIntegrationRequest(event);
  const origin = event.request.headers.get('origin');
  if (origin && !integration.allowedOrigins.includes(origin)) error(403, 'Este sitio no está habilitado para consultar las prestaciones.');
  if (!integration.isActive || !(await canUsePublicBusiness(supabase, integration.businessId))) error(404, 'Las reservas todavía no están disponibles.');
  const { data, error: cause } = await supabase.rpc('get_public_booking_catalogue', { p_integration_id: integration.id });
  if (cause) error(503, 'No pudimos cargar las prestaciones. Volvé a intentar en unos minutos.');
  const {data:labels,error:priceError}=await supabase.rpc('get_public_service_price_labels' as never,{p_business_id:integration.businessId,p_service_ids:integration.serviceIds,p_professional_ids:integration.professionalIds} as never);if(priceError)error(503,'No pudimos comprobar los aranceles. Volvé a intentar.');const labelMap=new Map(((labels??[]) as any[]).map(item=>[item.id,item]));for(const service of (data as any).services??[]){const label=labelMap.get(service.id);if(label)service.price_label=label.mixed?'Arancel según profesional y fecha':`${label.minimum!==label.maximum?'Desde ':''}${formatQuotedPrice({amount:Number(label.minimum),currency:label.currency})}`;}
  return json(data, {
    headers: { ...(origin ? { 'access-control-allow-origin': origin } : {}), vary: 'Origin', 'cache-control': 'public, max-age=60, s-maxage=60', 'x-content-type-options': 'nosniff' }
  });
  } catch (cause) { event.setHeaders({ 'cache-control': 'no-store' }); throw cause; }
};
