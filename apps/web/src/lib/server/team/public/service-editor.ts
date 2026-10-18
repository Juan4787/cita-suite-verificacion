import { logServerFailure } from '$lib/server/platform/logging';
import { writeAuditLog } from '$lib/server/platform/audit';
import type { CitaSupabaseClient } from '$lib/types/database';
import { isDefaultServiceName } from './default-services';
import { formatPriceLabel } from '$lib/utils/money-input';
import {
	parsePositiveInt,
	MIN_SERVICE_DURATION_MINUTES,
	MAX_SERVICE_DURATION_MINUTES
} from '$lib/team/professional-form';
import type { SaveResult } from './professional-editor';

export async function updateProfessionalService(
	supabase: CitaSupabaseClient,
	businessId: string,
	userId: string,
	form: FormData
): Promise<SaveResult<{ message: string }>> {
	const serviceId = String(form.get('service_id') ?? '').trim();
	if (!serviceId)
		return {
			ok: false,
			status: 400,
			message: 'No pudimos identificar el servicio. Cerrá el editor y volvé a abrirlo.'
		};

	const { data: currentService, error: serviceError } = await supabase
		.from('services')
		.select('id, name, updated_at')
		.eq('business_id', businessId)
		.eq('id', serviceId)
		.maybeSingle();
	if (serviceError)
		return { ok: false, status: 503, message: 'No pudimos cargar el servicio. Volvé a intentar.' };
	if (!currentService) {
		logServerFailure('Error buscando servicio para editar', serviceError);
		return {
			ok: false,
			status: 404,
			message: 'Ese servicio ya no está disponible. Cerrá el editor y recargá la página.'
		};
	}

	const expectedVersion = String(form.get('service_updated_at') ?? currentService.updated_at);
	if (expectedVersion !== currentService.updated_at)
		return {
			ok: false,
			status: 409,
			message: 'El servicio cambió. Cerrá el editor y recargá antes de guardar.'
		};
	const instructions = String(form.get('patient_instructions') ?? '').trim();
	const reminderDescription = String(form.get('public_reminder_description') ?? '').trim();
	if (instructions.length > 2000 || reminderDescription.length > 180)
		return {
			ok: false,
			status: 400,
			message: 'Acortá las indicaciones o el texto del aviso antes de guardar.'
		};
	const isDefault = isDefaultServiceName(String(currentService.name ?? ''));
	const name = isDefault ? String(currentService.name) : String(form.get('name') ?? '').trim();
	const duration = parsePositiveInt(form.get('duration_minutes'));
	const bufferBefore = Number(form.get('buffer_before_minutes') ?? 0);
	const bufferAfter = Number(form.get('buffer_after_minutes') ?? 0);
	const priceLabel = formatPriceLabel(String(form.get('price_label') ?? ''));
	if (!name)
		return { ok: false, status: 400, message: 'El nombre del servicio es obligatorio.' };
	if (duration < MIN_SERVICE_DURATION_MINUTES || duration > MAX_SERVICE_DURATION_MINUTES) {
		return {
			ok: false,
			status: 400,
			message: 'La duración debe estar entre 5 y 480 minutos.'
		};
	}
	if (
		!Number.isInteger(bufferBefore) ||
		!Number.isInteger(bufferAfter) ||
		bufferBefore < 0 ||
		bufferBefore > 480 ||
		bufferAfter < 0 ||
		bufferAfter > 480
	) {
		return {
			ok: false,
			status: 400,
			message: 'Los márgenes deben estar entre 0 y 480 minutos.'
		};
	}

	const { data: updatedService, error } = await supabase
		.from('services')
		.update({
			name,
			description: String(form.get('description') ?? '').trim() || null,
			...(form.has('patient_instructions') ? { patient_instructions: instructions || null } : {}),
			...(form.has('public_reminder_description')
				? { public_reminder_description: reminderDescription || null }
				: {}),
			duration_minutes: duration,
			buffer_before_minutes: bufferBefore,
			buffer_after_minutes: bufferAfter,
			price_label: priceLabel || null,
			is_public: isDefault || form.get('is_public') === 'true',
			is_active: isDefault || form.get('is_active') === 'true',
			updated_at: new Date().toISOString()
		})
		.eq('business_id', businessId)
		.eq('id', serviceId)
		.eq('updated_at', expectedVersion)
		.select('id')
		.maybeSingle();
	if (!error && !updatedService)
		return {
			ok: false,
			status: 409,
			message: 'El servicio cambió. Cerrá el editor y recargá antes de guardar.'
		};
	if (error || !updatedService) {
		logServerFailure('Error actualizando servicio', error);
		return {
			ok: false,
			status: 500,
			message: 'No pudimos guardar el servicio. Revisá los datos e intentá nuevamente.'
		};
	}

	await writeAuditLog(supabase, {
		businessId: businessId,
		userId,
		action: 'service.updated_from_professional',
		entityType: 'service',
		entityId: serviceId,
		metadata: { name, duration_minutes: duration }
	});

	return { ok: true, data: { message: 'Servicio guardado.' } };
}

/** Creation and assignment are one SQL effect; no orphan-service fallback. */
export async function createProfessionalService(
	supabase: CitaSupabaseClient,
	businessId: string,
	professionalId: string,
	form: FormData
): Promise<SaveResult<{ serviceId: string }>> {
	const name = String(form.get('name') ?? '').trim();
	const duration = parsePositiveInt(form.get('duration_minutes'), 30);
	const price = formatPriceLabel(String(form.get('price_label') ?? ''));
	if (!name) return { ok: false, status: 400, message: 'El nombre del servicio es obligatorio.' };
	if (duration < MIN_SERVICE_DURATION_MINUTES || duration > MAX_SERVICE_DURATION_MINUTES)
		return { ok: false, status: 400, message: 'La duración debe estar entre 5 y 480 minutos.' };
	const serviceId = crypto.randomUUID();
	const { data, error } = await supabase.rpc('create_professional_service_safely', {
		p_business_id: businessId,
		p_professional_id: professionalId,
		p_service_id: serviceId,
		p_name: name,
		p_duration_minutes: duration,
		p_price_label: price
	});
	if (error) {
		logServerFailure('team.service.create.failed', error);
		return {
			ok: false,
			status: 500,
			message:
				'No pudimos confirmar la creación. Revisá los servicios antes de volver a intentarlo.'
		};
	}
	if (data !== serviceId)
		return {
			ok: false,
			status: 500,
			message:
				'No pudimos confirmar la creación. Revisá los servicios antes de volver a intentarlo.'
		};
	return { ok: true, data: { serviceId } };
}
