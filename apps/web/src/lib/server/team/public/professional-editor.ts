import { isUuid } from '@cita-suite/shared/uuid';
import {listBusinessRoleAccess} from '$lib/server/access/public/team-access';
import { boolFromForm, scheduleBlocksFromForm, professionalSchedulePayload } from '$lib/team/professional-form';
import type { BusinessContext } from '$lib/access/contracts';
import { parsePriceAdjustments } from '$lib/scheduling/price-contracts';
import { previewMonthlyPrices, formatQuotedPrice, monthForTimezone } from '$lib/booking/pricing';
import { isDefaultServiceName } from './default-services';
import {
	professionalRuleScope,
	professionalExceptionType,
	type ProfessionalEditorData
} from '$lib/team/professional-editor';
import { logServerFailure } from '$lib/server/platform/logging';
import { readJson } from '$lib/contracts/json';
import { parseAvailabilityExceptionInterval } from './availability-exceptions';
import { idsFromForm } from '$lib/team/professional-form';
import { replaceProfessionalScheduleBlocks } from './availability-rules';
import {
	findProfessionalByEmail,
	humanProfessionalEmailConflict,
	normalizeProfessionalEmail
} from './professionals';
import type { NormalizedScheduleBlock } from '$lib/utils/schedule-blocks';
import type { CitaSupabaseClient } from '$lib/types/database';

export type SaveResult<T = unknown> =
	| { ok: true; data?: T }
	| {
			ok: false;
			status: 400 | 403 | 404 | 409 | 500 | 503;
			message: string;
			exceptionConflict?: boolean;
	  };

type OdontoSupabase = CitaSupabaseClient;

export const getPendingProfessionalAccountEmail = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string
) => {
 const members=await listBusinessRoleAccess(supabase,businessId);
 const pending=members.find(item=>item.status==='pending'&&item.professional_id===professionalId);
 return pending?.email.trim().toLowerCase()||null;
};

export const saveProfessionalProfile = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string,
	form: FormData,
	options: { accountLinkPending?: boolean } = {}
): Promise<SaveResult<{ email: string | null }>> => {
	const name = String(form.get('name') ?? '').trim();
	if (!name) return { ok: false, status: 400, message: 'El nombre es obligatorio.' };
	const isAvailable = boolFromForm(form, 'is_available');
	const email = normalizeProfessionalEmail(form.get('email'));
	const existingProfessional = await findProfessionalByEmail(
		supabase,
		businessId,
		email,
		professionalId
	);
	if (existingProfessional) {
		return {
			ok: false,
			status: 400,
			message: humanProfessionalEmailConflict(existingProfessional)
		};
	}

	const { data: updatedProfessional, error } = await supabase
		.from('professionals')
		.update({
			name,
			specialty: String(form.get('specialty') ?? '').trim() || null,
			phone: String(form.get('phone') ?? '').trim() || null,
			email,
			...(options.accountLinkPending
				? { is_public: false }
				: { is_public: isAvailable, is_active: isAvailable }),
			updated_at: new Date().toISOString()
		})
		.eq('business_id', businessId)
		.eq('id', professionalId)
		.select('id')
		.maybeSingle();

	if (error) {
		logServerFailure('Error actualizando profesional', error);
		return {
			ok: false,
			status: 500,
			message: error.message?.includes('PROFESSIONAL_EMAIL_ALREADY_EXISTS')
				? 'Ese correo ya está cargado en otro profesional.'
				: 'No se pudo actualizar el profesional.'
		};
	}
	if (!updatedProfessional) {
		return {
			ok: false,
			status: 409,
			message:
				'El perfil profesional cambió o ya no está disponible. Recargá la página y volvé a intentar.'
		};
	}

	return { ok: true, data: { email } };
};

export const saveProfessionalServices = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string,
	form: FormData
): Promise<SaveResult<{ serviceIds: string[] }>> => {
	const serviceIds = idsFromForm(form, 'service_id');
	const { error } = await supabase.rpc('save_professional_editor', {
		p_business_id: businessId,
		p_professional_id: professionalId,
		p_expected_revision: Number(form.get('availability_revision')),
		p_profile: null,
		p_service_ids: serviceIds,
		p_blocks: null,
		p_exception_request_id: null,
		p_exception_items: null,
		p_ack_existing: false
	});
	if (error)
		return {
			ok: false,
			status: 409,
			message: error.message.includes('SCHEDULE_CHANGED')
				? 'La configuración cambió. Recargá la página antes de guardar; no se aplicó ningún cambio.'
				: 'No pudimos guardar las prestaciones. Revisá la selección y volvé a intentar.'
		};
	return { ok: true, data: { serviceIds } };
};

export const saveProfessionalWeeklyRules = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string,
	form: FormData
): Promise<SaveResult<{ blocks: NormalizedScheduleBlock[] }>> => {
	const scheduleBlocks = scheduleBlocksFromForm(form);
	if (!scheduleBlocks.ok) return scheduleBlocks;

	try {
		await replaceProfessionalScheduleBlocks(supabase, {
			businessId,
			professionalId,
			blocks: scheduleBlocks.blocks,
			expectedRevision: Number(form.get('availability_revision'))
		});
	} catch (replaceError) {
		logServerFailure('Error guardando horarios', replaceError);
		return {
			ok: false,
			status: 500,
			message:
				replaceError instanceof Object &&
				'message' in replaceError &&
				String(replaceError.message).includes('SCHEDULE_CHANGED')
					? 'Los horarios cambiaron. Recargá la página antes de guardar.'
					: 'Revisá las franjas y las prestaciones. No se guardó ningún horario.'
		};
	}

	return { ok: true, data: { blocks: scheduleBlocks.blocks } };
};

export type PreparedException = {
	professional_id: string | null;
	type: string;
	starts_at: string;
	ends_at: string;
	reason: string | null;
	service_ids: string[];
};

export const createAvailabilityException = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string,
	timeZone: string,
	form: FormData,
	dryRun = false
): Promise<
	SaveResult<{
		id: null;
		professionalId: string | null;
		type: string;
		periodMode: 'single' | 'range';
		startDate: string;
		endDate: string;
		items?: PreparedException[];
	}>
> => {
	const target = String(form.get('applies_to')) === 'business' ? null : professionalId;
	const type = String(form.get('type') ?? '');
	const mode = String(form.get('period_mode') ?? 'single');
	let dates: string[] = [];
	try {
		dates =
			mode === 'multiple'
				? JSON.parse(String(form.get('dates') ?? '[]'))
				: [String(form.get('date') ?? '')];
	} catch {
		return { ok: false, status: 400, message: 'Revisá las fechas seleccionadas.' };
	}
	if (
		!Array.isArray(dates) ||
		dates.length < 1 ||
		dates.length > 366 ||
		dates.some((date) => typeof date !== 'string')
	)
		return { ok: false, status: 400, message: 'Elegí entre una y 366 fechas válidas.' };
	const intervals = [];
	for (const date of [...new Set(dates)]) {
		const interval = parseAvailabilityExceptionInterval({
			type,
			periodMode: mode === 'multiple' && type === 'blocked' ? 'range' : mode,
			date,
			dateFrom: mode === 'multiple' ? date : String(form.get('date_from') ?? ''),
			dateTo: mode === 'multiple' ? date : String(form.get('date_to') ?? ''),
			timeRange: String(form.get('time_range') ?? ''),
			timeZone
		});
		if (!interval.ok) return { ok: false, status: 400, message: interval.message };
		intervals.push(interval);
	}
	const items = intervals.map((interval) => ({
		professional_id: target,
		type,
		starts_at: interval.startsAt.toISOString(),
		ends_at: interval.endsAt.toISOString(),
		reason: String(form.get('reason') ?? '').trim() || null,
		service_ids: form.getAll('exception_service_ids').map(String)
	}));
	if (type === 'blocked' && form.get('ack_existing_appointments') !== 'true') {
		for (const interval of intervals) {
			let query = supabase
				.from('appointment_professionals')
				.select('appointment_id', { count: 'exact', head: true })
				.eq('business_id', businessId)
				.in('status', ['reserved', 'confirmed', 'reschedule_requested'])
				.lt('starts_at', interval.endsAt.toISOString())
				.gt('ends_at', interval.startsAt.toISOString());
			if (target) query = query.eq('professional_id', target);
			const { count, error } = await query;
			if (error)
				return {
					ok: false,
					status: 500,
					message: 'No pudimos revisar los turnos existentes. Probá nuevamente.'
				};
			if (count)
				return {
					ok: false,
					status: 409,
					exceptionConflict: true,
					message: `Hay turnos ya reservados en las fechas elegidas. El bloqueo no los cancela. Revisá la agenda y confirmá que querés bloquear nuevos turnos.`
				};
		}
	}
	if (dryRun)
		return {
			ok: true,
			data: {
				id: null,
				professionalId: target,
				type,
				periodMode: mode === 'range' ? 'range' : 'single',
				startDate: intervals[0].startDate,
				endDate: intervals.at(-1)!.endDate,
				items
			}
		};
	const { error } = await supabase.rpc('create_availability_exception_batch', {
		p_business_id: businessId,
		p_expected_revision: Number(form.get('availability_revision')),
		p_request_id: String(form.get('exception_request_id') ?? ''),
		p_items: items,
		p_ack_existing: form.get('ack_existing_appointments') === 'true'
	});
	if (error)
		return {
			ok: false,
			status: 409,
			exceptionConflict: error.message.includes('SCHEDULE_EXISTING_APPOINTMENTS'),
			message: error.message.includes('SCHEDULE_EXISTING_APPOINTMENTS')
				? 'Hay turnos ya reservados en las fechas elegidas. Revisá la agenda y confirmá el bloqueo de nuevas reservas.'
				: error.message.includes('SCHEDULE_CHANGED')
					? 'Los horarios cambiaron. Recargá la página antes de guardar.'
					: 'No pudimos guardar las fechas. Revisá horarios, prestaciones y motivo; no se aplicó el lote.'
		};
	return {
		ok: true,
		data: {
			id: null,
			professionalId: target,
			type,
			periodMode: mode === 'range' ? 'range' : 'single',
			startDate: intervals[0].startDate,
			endDate: intervals.at(-1)!.endDate
		}
	};
};

export async function saveProfessionalEditor(
	supabase: CitaSupabaseClient,
	businessId: string,
	professionalId: string,
	timeZone: string,
	form: FormData
): Promise<SaveResult<{ message: string }>> {
	const savedSections: string[] = [];
	let profile: null | Record<string, unknown> = null;
	let blocks: NormalizedScheduleBlock[] | null = null;
	let items: PreparedException[] | null = null;
	if (boolFromForm(form, 'save_profile')) {
		const name = String(form.get('name') ?? '').trim();
		if (!name)
			return {
				ok: false,
				status: 400,
				message: 'El nombre es obligatorio. No se guardó ningún cambio.'
			};
		const email = normalizeProfessionalEmail(form.get('email'));
		const existing = await findProfessionalByEmail(supabase, businessId, email, professionalId);
		if (existing)
			return { ok: false, status: 400, message: humanProfessionalEmailConflict(existing) };
		const pending = await getPendingProfessionalAccountEmail(supabase, businessId, professionalId);
		profile = {
			name,
			specialty: String(form.get('specialty') ?? '').trim(),
			phone: String(form.get('phone') ?? '').trim(),
			email,
			is_public: pending ? false : boolFromForm(form, 'is_available'),
			...(pending ? {} : { is_active: boolFromForm(form, 'is_available') })
		};
		savedSections.push('perfil');
	}
	if (boolFromForm(form, 'save_schedule')) {
		const parsed = scheduleBlocksFromForm(form);
		if (!parsed.ok) return parsed;
		blocks = parsed.blocks;
		savedSections.push('horarios');
	}
	if (boolFromForm(form, 'save_exception')) {
		const prepared = await createAvailabilityException(
			supabase,
			businessId,
			professionalId,
			timeZone,
			form,
			true
		);
		if (!prepared.ok) return prepared;
		items = prepared.data?.items ?? [];
		savedSections.push('disponibilidad');
	}
	const serviceIds = boolFromForm(form, 'save_services') ? idsFromForm(form, 'service_id') : null;
	if (serviceIds) savedSections.push('servicios');
	if (!savedSections.length) return { ok: true, data: { message: 'No había cambios pendientes.' } };
	const { error } = await supabase.rpc('save_professional_editor', {
		p_business_id: businessId,
		p_professional_id: professionalId,
		p_expected_revision: Number(form.get('availability_revision')),
		p_profile: readJson(profile, 'professionalEditor.profile'),
		p_service_ids: serviceIds,
		p_blocks:blocks?professionalSchedulePayload(blocks):null,
		p_exception_request_id: items ? String(form.get('exception_request_id')) : null,
		p_exception_items: readJson(items, 'professionalEditor.exceptions'),
		p_ack_existing: form.get('ack_existing_appointments') === 'true'
	});
	if (error)
		return {
			ok: false,
			status: 409,
			exceptionConflict: error.message.includes('SCHEDULE_EXISTING_APPOINTMENTS'),
			message: error.message.includes('SCHEDULE_CHANGED')
				? 'La configuración cambió. Recargá la página antes de guardar; no se aplicó ningún cambio.'
				: error.message.includes('SCHEDULE_EXISTING_APPOINTMENTS')
					? 'Hay turnos existentes. Revisá la agenda y confirmá el bloqueo; no se guardó ningún cambio.'
					: 'Revisá el perfil, las prestaciones y los horarios. No se guardó ningún cambio.'
		};
	return { ok: true, data: { message: `Guardado: ${savedSections.join(', ')}.` } };
}

export async function loadProfessionalEditor(
	supabase: CitaSupabaseClient,
	business: BusinessContext,
	userId: string,
	professionalId: string,
	tab: string
): Promise<SaveResult<ProfessionalEditorData>> {
	if (!isUuid(professionalId)) return { ok: false, status: 404, message: 'Profesional no encontrado' };
	const businessId = business.business.id;
	const { data: revisionRow, error: revisionError } = await supabase
		.from('businesses')
		.select('booking_availability_revision')
		.eq('id', businessId)
		.single();
	if (revisionError)
		return { ok: false, status: 503, message: 'No pudimos cargar los horarios. Volvé a intentar.' };

	const { data: professional, error: professionalError } = await supabase
		.from('professionals')
		.select('id, name, specialty, phone, email, is_active, is_public')
		.eq('business_id', businessId)
		.eq('id', professionalId)
		.maybeSingle();
	if (professionalError)
		return {
			ok: false,
			status: 503,
			message: 'No pudimos cargar el profesional. Volvé a intentar.'
		};
	if (!professional) return { ok: false, status: 404, message: 'Profesional no encontrado' };

	const [
		{ data: services, error: servicesError },
		{ data: assignments, error: assignmentsError },
		{ data: rules, error: rulesError },
		{ data: exceptions, error: exceptionsError },
		pendingAccountEmail
	] = await Promise.all([
		supabase
			.from('services')
			.select(
				'id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_label, is_active, is_public, sort_order, updated_at, patient_instructions, public_reminder_description'
			)
			.eq('business_id', businessId)
			.order('sort_order')
			.order('name'),
		supabase
			.from('professional_services')
			.select('service_id')
			.eq('business_id', businessId)
			.eq('professional_id', professionalId),
		supabase
			.from('availability_rules')
			.select(
				'id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active, created_at, service_scope, rule_services:availability_rule_services(service_id)'
			)
			.eq('business_id', businessId)
			.eq('professional_id', professionalId)
			.order('weekday')
			.order('start_time'),
		supabase
			.from('availability_exceptions')
			.select(
				'id, professional_id, starts_at, ends_at, type, reason, exception_services:availability_exception_services(service_id)'
			)
			.eq('business_id', businessId)
			.or(`professional_id.eq.${professionalId},professional_id.is.null`)
			.order('starts_at', { ascending: false })
			.limit(80),
		getPendingProfessionalAccountEmail(supabase, businessId, professionalId)
	]);
	if (servicesError || assignmentsError || rulesError || exceptionsError)
		return {
			ok: false,
			status: 503,
			message: 'No pudimos cargar toda la configuración. Volvé a intentar.'
		};
	const { data: pricePolicies, error: priceError } = await supabase
		.from('service_price_policies')
		.select('*,service_price_monthly_adjustments(month,kind,percentage)')
		.eq('business_id', businessId)
		.or(`professional_id.eq.${professional.id},professional_id.is.null`);
	if (priceError)
		return {
			ok: false,
			status: 503,
			message: 'No pudimos cargar los aranceles. Volvé a intentar.'
		};
	const currentMonth = monthForTimezone(new Date(), business.business.timezone);
	const currentPriceLabels: Record<string, string> = {};
	for (const service of services ?? []) {
		const policy =
			(pricePolicies ?? []).find(
				(row) => row.service_id === service.id && row.professional_id === professional.id
			) ??
			(pricePolicies ?? []).find(
				(row) => row.service_id === service.id && row.professional_id === null
			);
		if (policy) {
			try {
				const [quote] = previewMonthlyPrices(
					String(policy.base_amount),
					String(policy.monthly_percentage),
					String(policy.rounding_unit),
					policy.base_month.slice(0, 7),
					policy.first_adjustment_month.slice(0, 7),
					parsePriceAdjustments(policy.service_price_monthly_adjustments),
					1,
					currentMonth
				);
				currentPriceLabels[service.id] = formatQuotedPrice({
					amount: quote.amount,
					currency: policy.currency
				});
			} catch {
				currentPriceLabels[service.id] = 'Revisar configuración de arancel';
			}
		}
	}
	const defaultServiceIds = (services ?? [])
		.filter((service) => isDefaultServiceName(String(service.name ?? '')))
		.map((service) => String(service.id));

	return {
		ok: true,
		data: {
			context: business,
			availabilityRevision: Number(revisionRow.booking_availability_revision),
			exceptionRequestId: crypto.randomUUID(),
			professional,
			services: services ?? [],
			currentPriceLabels,
			assignedServiceIds: (assignments ?? []).map((item) => String(item.service_id)),
			defaultServiceIds,
			rules: (rules ?? []).map((rule) => ({
				...rule,
				service_scope: professionalRuleScope(rule.service_scope)
			})),
			exceptions: (exceptions ?? []).map((item) => ({
				...item,
				type: professionalExceptionType(item.type)
			})),
			appointmentCount: null,
			clinicalEntryCount: null,
			followUpCount: null,
			dependencyCountsDeferred: true,
			tab: tab,
			userId,
			pendingAccountEmail,
			demo: false
		}
	};
}
