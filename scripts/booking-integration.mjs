import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { normalizeBookingOrigin, parseBookingIntakeFields, parseBookingModalityWindows, BOOKING_MODALITIES, BOOKING_THEMES } from '../packages/shared/src/booking-integration.ts';
import { getBusinessAccessState } from '../apps/web/src/lib/server/commercial-access.ts';
// Node >=22.23. Default operation is read-only. Credentials never enter the
// config JSON or output. Creation and activation are separate explicit commands.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const action = args[0];
const file = args[1];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function required(condition, message) { if (!condition)
    throw new Error(message); }
function ids(value, max) {
    required(Array.isArray(value) && value.length > 0 && value.length <= max && value.every((id) => typeof id === 'string' && uuid.test(id)) && new Set(value).size === value.length, 'Completá los identificadores reales y explícitos de servicios y profesionales.');
    return value;
}
function dbError(error) { if (error)
    throw new Error('La consulta al servicio no se pudo completar. No se confirmó ningún cambio. Revisá la conexión y repetí la verificación.'); }
try {
    required(['check', 'create-disabled', 'activate', 'deactivate'].includes(action) && file && args.length <= 4, 'Uso: node scripts/booking-integration.mjs check|create-disabled|activate|deactivate archivo.json [clave_publica] [revision_esperada]');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    required(config && typeof config === 'object' && !Array.isArray(config) && Object.keys(config).every((key) => ['businessId', 'name', 'theme', 'allowedOrigins', 'serviceIds', 'professionalIds', 'modalities', 'videoInstructions', 'intakeFields', 'modalityWindows', 'isDefault'].includes(key)), 'La configuración contiene campos desconocidos.');
    required(uuid.test(config.businessId) && typeof config.name === 'string' && config.name.trim().length > 0 && config.name.length <= 120, 'Completá el consultorio real y el nombre de la integración.');
    required(BOOKING_THEMES.includes(config.theme) && typeof config.isDefault === 'boolean', 'Elegí un tema soportado y definí si es el perfil público del consultorio.');
    const local = process.env.BOOKING_INTEGRATION_ALLOW_LOCAL === 'true';
    required(Array.isArray(config.allowedOrigins) && config.allowedOrigins.length > 0 && config.allowedOrigins.length <= 20, 'Indicá los dominios exactos de la web.');
    const origins = config.allowedOrigins.map((origin) => typeof origin === 'string' ? normalizeBookingOrigin(origin, local) : null);
    required(origins.every(Boolean) && new Set(origins).size === origins.length, 'Hay dominios inválidos o repetidos; no se permiten rutas ni comodines.');
    required(Array.isArray(config.modalities) && config.modalities.length > 0 && config.modalities.length <= 2 && config.modalities.every((value) => BOOKING_MODALITIES.includes(value)) && new Set(config.modalities).size === config.modalities.length, 'Definí las modalidades habilitadas.');
    required(config.videoInstructions === null || (typeof config.videoInstructions === 'string' && config.videoInstructions.length <= 1000), 'Las indicaciones virtuales son inválidas.');
    required(!config.modalities.includes('video') || config.videoInstructions?.trim(), 'La atención virtual necesita instrucciones reales para el paciente.');
    const fields = parseBookingIntakeFields(config.intakeFields);
    const windows = parseBookingModalityWindows(config.modalityWindows);
    const payload = { business_id: config.businessId, name: config.name.trim(), theme: config.theme, allowed_origins: origins, allowed_service_ids: ids(config.serviceIds, 500), allowed_professional_ids: ids(config.professionalIds, 16), allowed_modalities: config.modalities, video_instructions: config.videoInstructions?.trim() || null, intake_schema: fields, modality_windows: windows, is_default: config.isDefault };
    required(windows.every((window) => config.modalities.includes(window.modality) && (!window.professionalId || config.professionalIds.includes(window.professionalId))), 'Una franja refiere a una modalidad o profesional fuera de este perfil.');
    try {
        process.loadEnvFile(root + '.env');
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    const endpoint = process.env.ODONTO_SUPABASE_URL;
    const secret = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
    required(endpoint && secret, 'Falta la configuración privada del servicio en el entorno.');
    const supabase = createClient(endpoint, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const business = await supabase.from('businesses').select('id,name,timezone,created_at,is_active,public_booking_enabled,max_booking_days_ahead').eq('id', config.businessId).single();
    dbError(business.error);
    const subscription = await supabase.from('business_subscriptions').select('*').eq('business_id', config.businessId).maybeSingle();
    dbError(subscription.error);
    const services = await supabase.from('services').select('id,name,is_public,is_active').eq('business_id', config.businessId).in('id', config.serviceIds);
    dbError(services.error);
    const professionals = await supabase.from('professionals').select('id,name,is_public,is_active').eq('business_id', config.businessId).in('id', config.professionalIds);
    dbError(professionals.error);
    const bindings = await supabase.from('professional_services').select('professional_id,service_id').eq('business_id', config.businessId).in('service_id', config.serviceIds).in('professional_id', config.professionalIds);
    dbError(bindings.error);
    const problems = [];
    if (!business.data.is_active || !business.data.public_booking_enabled)
        problems.push('El consultorio debe tener habilitada la reserva pública.');
    if (!getBusinessAccessState(subscription.data, { businessCreatedAt: business.data.created_at }).allowedCapabilities.canUsePublicBooking)
        problems.push('El consultorio necesita acceso comercial habilitado.');
    if (services.data.length !== config.serviceIds.length || services.data.some((row) => !row.is_active || !row.is_public))
        problems.push('Todos los servicios deben pertenecer al consultorio y estar activos y públicos.');
    if (professionals.data.length !== config.professionalIds.length || professionals.data.some((row) => !row.is_active || !row.is_public || !row.name.trim()))
        problems.push('Todos los profesionales deben pertenecer al consultorio y estar activos y públicos.');
    for (const id of config.serviceIds)
        if (!bindings.data.some((row) => row.service_id === id))
            problems.push('Un servicio no tiene un profesional asignado dentro del perfil.');
    for (const id of config.professionalIds) {
        const rules = await supabase.from('availability_rules').select('id', { count: 'exact', head: true }).eq('business_id', config.businessId).eq('professional_id', id).eq('is_active', true);
        dbError(rules.error);
        const extras = await supabase.from('availability_exceptions').select('id', { count: 'exact', head: true }).eq('business_id', config.businessId).eq('professional_id', id).eq('type', 'extra_available').gt('ends_at', new Date().toISOString());
        dbError(extras.error);
        if (!rules.count && !extras.count)
            problems.push('Un profesional no tiene horarios de atención configurados.');
    }
    const existing = await supabase.from('booking_integrations').select('*').eq('business_id', config.businessId).eq('name', payload.name).maybeSingle();
    dbError(existing.error);
    console.log(JSON.stringify({ targetHost: new URL(endpoint).host, consultorio: business.data.name, timezone: business.data.timezone, servicios: services.data.map((row) => row.name), profesionales: professionals.data.map((row) => row.name), perfil: payload, existingKey: existing.data?.public_key ?? null, existingRevision: existing.data?.revision ?? null, readinessProblems: problems }, null, 2));
    if (action === 'check') {
        if (problems.length)
            process.exitCode = 2;
    }
    else if (action === 'create-disabled') {
        required(args.length === 2 && !existing.data, 'La integración ya existe o hay argumentos adicionales. Usá check y conservá su clave estable.');
        const created = await supabase.from('booking_integrations').insert({ ...payload, is_active: false }).select('public_key,revision,is_active').single();
        dbError(created.error);
        console.log('Creada y deshabilitada: ' + JSON.stringify(created.data));
    }
    else {
        const key = args[2];
        const revision = Number(args[3]);
        required(existing.data && key === existing.data.public_key && Number.isSafeInteger(revision) && revision === Number(existing.data.revision), 'La clave y la revisión deben coincidir con la configuración revisada. Ejecutá check nuevamente.');
        required(isDeepStrictEqual(Object.fromEntries(Object.keys(payload).map((key) => [key, existing.data[key]])), payload), 'El archivo no coincide con la configuración guardada. Revisá el perfil antes de cambiar su estado.');
        required(action === 'deactivate' || problems.length === 0, 'No se puede activar mientras haya requisitos pendientes.');
        const changed = await supabase.from('booking_integrations').update({ is_active: action === 'activate' }).eq('id', existing.data.id).eq('revision', revision).select('public_key,revision,is_active').maybeSingle();
        dbError(changed.error);
        required(changed.data, 'La configuración cambió durante la operación. Verificá su estado antes de repetir.');
        console.log('Estado verificado: ' + JSON.stringify(changed.data));
    }
}
catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
