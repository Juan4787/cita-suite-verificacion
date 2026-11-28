<script lang="ts">
	import type { AppointmentEmailDelivery } from '$lib/scheduling/email-policy';
import {formatQuotedPrice, quotedPriceEstimateNotice} from '$lib/booking/pricing';
	import BackLink from '$lib/components/BackLink.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import { refineDeviceClass, type DeviceClass } from '$lib/device';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { hasAppointmentStarted, isUpcomingActiveAppointment } from '$lib/utils/appointment-visibility';
	import StaffCancelPanel from '$lib/components/appointments/StaffCancelPanel.svelte';
	import { agendaTime, agendaWeekdayLongDate } from '$lib/utils/agenda-dates';
	import { DEPOSIT_STATUS_LABELS, formatDepositAmount, type AppointmentDepositView } from '$lib/scheduling/deposits';
	import { formatInTimeZone } from '$lib/utils/format';
	import type { StaffManagementFeedback } from '$lib/scheduling/staff-management';
	import { formatDepositMoney } from '$lib/scheduling/reschedule-terms';
	import { revealNotice } from '$lib/ui/reveal-notice';
	import { createClientReadiness } from '$lib/client/readiness.svelte';
	import type { PageData } from './$types';
import { BOOKING_MODALITY_LABELS, type BookingModality } from '@cita-suite/shared/booking-integration';

	type Slot = { date: string; time: string; starts_at: string; professional_name: string };
 type SlotBatch = { slots: Slot[]; availabilityRevision: number; durationMinutes: number };
	type AuditLog = {
		id: string;
		user_id: string | null;
		action: string;
		metadata: Record<string, unknown> | null;
		created_at: string;
	};

	let { data, form }: {
		data: {
			context: { canOperate: boolean; role: string; business?: { timezone?: string } };canEditInstructions?:boolean;
			appointment: PageData['appointment'];
   management: PageData['management'];
			deposit: (AppointmentDepositView & { cancelsItself: boolean | null }) | null;
   depositFinancials: PageData['depositFinancials'];
			canRecordDeposit: boolean;
			auditLogs: AuditLog[] | null;
			emailDeliveries: PageData['emailDeliveries'];
			userLabels: Record<string, string>;
			reprogramDate: string;
			minReprogramDate: string;
			reprogramSlots: Slot[];
			reprogramSlotsLoaded?: boolean;
			fromDate: string;
			justRescheduled: boolean;
			justCreated: boolean;
   delivery: PageData['delivery'];
   activationDevice: DeviceClass;
   phoneWarningAcknowledged: boolean;
			demo: boolean;
		};
		form?: StaffManagementFeedback;
	} = $props();

	let refinedActivationDevice = $state<DeviceClass | null>(null);
	const activationDevice = $derived(refinedActivationDevice ?? data.activationDevice);

	onMount(() => {
		// iPadOS puede identificarse como macOS. Antes del clic refinamos el dato
		// del servidor para mantener wa.me en tablets y WhatsApp Web sólo en PC.
		refinedActivationDevice = refineDeviceClass(data.activationDevice, navigator);
	});

	let localFeedback = $state<StaffManagementFeedback | null>(null);
 let feedbackElement = $state<HTMLElement | null>(null);
 const feedback = $derived(localFeedback ?? form);
 const emailPurposeLabels: Record<AppointmentEmailDelivery['purpose'], string> = {
  booking_receipt: 'Comprobante de reserva', reschedule_receipt: 'Comprobante de cambio', cancellation_receipt: 'Comprobante de cancelación',
  deposit_request: 'Pedido de seña', reminder_72h: 'Recordatorio de 72 horas', reminder_24h: 'Recordatorio de 24 horas'
 };
 const emailDiscardLabels: Record<string, string> = {
  no_recipient: 'el paciente no tiene correo', invalid_recipient: 'la dirección no es válida', suppressed: 'esa dirección pidió no recibir correos',
  email_disabled: 'los correos están apagados', expired: 'ya no era útil', superseded_schedule: 'el horario cambió', appointment_cancelled: 'el turno se canceló',
  appointment_started: 'el turno ya empezó', deposit_not_pending: 'la seña ya no está pendiente', covered_by_receipt: 'ya estaba en el comprobante',
  not_cancelled: 'el turno volvió a estar vigente', operator_dismissed: 'lo descartó el consultorio'
 };
 // "Accepted" and "delivered" are what the provider reports. Neither means the patient read it.
 const emailStateLabel = (delivery: AppointmentEmailDelivery) => {
  switch (delivery.state) {
   case 'pending': case 'retry': return 'En cola';
   case 'sending': return 'Enviándose';
   case 'accepted': return 'Aceptado por el proveedor';
   case 'delivered': return 'Entregado al servidor del destinatario';
   case 'uncertain': return 'En comprobación';
   case 'failed': return 'No se pudo enviar';
   case 'bounced': return 'Rebotó: revisá la dirección';
   case 'complained': return 'El destinatario lo marcó como no deseado';
   case 'discarded': return `No se envió: ${emailDiscardLabels[delivery.discardReason ?? ''] ?? 'ya no correspondía'}`;
  }
 };
 $effect(() => { if (feedback?.message) revealNotice(feedbackElement); });
 const canOperate = $derived(data.context.canOperate && !data.demo);
	const isClosed = $derived(data.appointment?.status === 'cancelled');
	const canShowCancelAction = $derived(
		canOperate && !isClosed && data.appointment !== null && isUpcomingActiveAppointment(data.appointment)
	);
	const appointmentStarted = $derived(data.appointment !== null && hasAppointmentStarted(data.appointment));
	const appointmentInProgress = $derived(
		appointmentStarted && data.appointment !== null && Date.parse(data.appointment.ends_at) > Date.now()
	);
	const appointmentProfessionals = $derived(data.appointment?.professionals ?? []);
	const isJoint = $derived(appointmentProfessionals.length > 1);

	const statusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Quiere reprogramar'
	};

	const sourceLabels: Record<string, string> = {
		public_booking: 'Reserva online',
		manual: 'Manual',
		whatsapp_bot: 'WhatsApp',
		admin: 'Administración interna'
	};

	const statusTone: Record<string, string> = {
		reserved: 'ux-badge',
		confirmed: 'ux-badge ux-badge-success',
		cancelled: 'ux-badge ux-badge-danger',
		reschedule_requested: 'ux-badge ux-badge-warning'
	};

	// Hora y fecha en la zona del consultorio, no en la del navegador.
	const timeZone = $derived(data.context.business?.timezone ?? 'America/Argentina/Cordoba');

	// The deposit is part of the status the practice reads (plan, section 4.2, point 5): one label.
	const depositSuffix = $derived(
		data.deposit?.status === 'pending' && data.appointment?.status === 'reserved'
			? ', seña pendiente'
			: data.deposit?.status === 'paid' && data.appointment?.status === 'confirmed'
				? ', seña recibida'
				: ''
	);
	const headerTone = $derived(
		depositSuffix === ', seña pendiente' ? 'ux-badge ux-badge-warning' : (statusTone[data.appointment?.status ?? ''] ?? 'ux-badge')
	);
	const depositTone: Record<string, string> = {
		pending: 'ux-badge ux-badge-warning',
		paid: 'ux-badge ux-badge-success',
		waived: 'ux-badge',
		expired: 'ux-badge ux-badge-danger'
	};
	// Only an active turn changes its deposit; a waiver made by turning the policy off is final.
	const depositActionsAvailable = $derived(
		Boolean(data.deposit && data.canRecordDeposit && !data.demo && data.appointment && data.appointment.status !== 'cancelled')
	);
	const timeOnly = (value: string) => agendaTime(value, timeZone);
	const dateOnly = (value: string) => agendaWeekdayLongDate(value, timeZone);

	const durationText = (appointment: NonNullable<PageData['appointment']>) => {
		const minutes =
			Number(appointment?.duration_minutes_snapshot) ||
			Math.round((new Date(appointment?.ends_at).getTime() - new Date(appointment?.starts_at).getTime()) / 60_000);
		return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
	};

	const metadataValue = (log: AuditLog, key: string) => {
		const value = log.metadata?.[key];
		return typeof value === 'string' ? value : null;
	};

	const auditLabel = (log: AuditLog) => {
		const user = log.user_id ? (data.userLabels[log.user_id] ?? 'Una persona del equipo') : 'Sistema';
		if (log.action === 'appointment.created') return `${user} creó el turno`;
		if (log.action === 'appointment.public_created') return 'El paciente reservó el turno online';
		if (log.action === 'appointment.reschedule_policy_informed') return 'Se informaron las condiciones de reprogramación al reservar';
		if (log.action === 'appointment.management_link_prepared') return `${user} preparó un enlace para compartir el turno`;
		if (log.action === 'reminder.whatsapp_opened') return `${user} abrió el recordatorio por WhatsApp`;
		if (log.action === 'reminder.whatsapp_marked_sent') return `${user} registró que envió el recordatorio por WhatsApp`;
		if (log.action === 'appointment.public_confirmed') return 'El paciente confirmó el turno desde el enlace';
		if (log.action === 'appointment.public_cancelled') return 'El paciente canceló el turno desde el enlace';
		if (log.action === 'appointment.public_reschedule_requested') {
			return 'El paciente pidió reprogramar desde el enlace';
		}
		if (log.action === 'appointment.rescheduled') return `${user} reprogramó el turno`;
		if (log.action === 'appointment.cancelled') return `${user} canceló el turno`;
		if (log.action === 'appointment.confirmed') return `${user} confirmó el turno`;
		if (log.action === 'appointment.reschedule_requested') return `${user} marcó pedido de reprogramación`;
		if (log.action === 'appointment.updated') return `${user} actualizó el turno`;
		if (log.action === 'appointment.deposit_paid') return `${user} confirmó la seña`;
		if (log.action === 'appointment.deposit_waived') return `${user} exceptuó la seña`;
		if (log.action === 'appointment.deposit_reopened') return `${user} deshizo el registro de la seña`;
		if (log.action === 'appointment.slot_release_hidden') return `${user} ocultó un aviso de horario liberado`;
		if (log.action === 'appointment.deposit_reminder_opened') return `${user} abrió el pedido de seña por WhatsApp`;
		if (log.action === 'appointment.deposit_expired') return 'El turno se canceló automáticamente porque no se registró la seña';
  if (log.action === 'appointment.late_deposit_recorded') return `${user} registró dinero recibido después de cancelar`;
  if (log.action === 'appointment.late_deposit_corrected') return `${user} corrigió un registro de dinero posterior a la cancelación`;
		return `${user} registró una actualización del turno`;
	};

	const auditDetail = (log: AuditLog) => {
		if (log.action === 'appointment.rescheduled') {
			const from = metadataValue(log, 'from_starts_at');
			const to = metadataValue(log, 'to_starts_at');
			if (from && to) return `${formatDateTime(from, timeZone)} -> ${formatDateTime(to, timeZone)}`;
		}
		const depositAmount = log.metadata?.amount;
		if (['appointment.deposit_paid', 'appointment.deposit_waived', 'appointment.deposit_reopened'].includes(log.action) && typeof depositAmount === 'number') {
			return `Seña de ${formatDepositAmount(depositAmount)}`;
		}
		const reason = metadataValue(log, 'reason');
		if (reason) return reason;
		const fromStatus = metadataValue(log, 'from_status');
		const toStatus = metadataValue(log, 'to_status');
		if (fromStatus && toStatus) return `${statusLabels[fromStatus] ?? fromStatus} -> ${statusLabels[toStatus] ?? toStatus}`;
		return '';
	};

	const canUseStatusAction = (status: string) => {
		if (isClosed || !data.appointment || data.appointment.status === status) return false;
		return canOperate && !submitting && !feedback?.retry;
	};

	// --- Reprogramar: calendario inline + chips de horario ---
	const parseIso = (iso: string) => {
		const [y, m, d] = iso.split('-').map(Number);
		return { y, m, d };
	};

	const initialReprogramState = (initialData: {
		reprogramDate: string;
		minReprogramDate: string;
		reprogramSlots: Slot[];
		reprogramSlotsLoaded?: boolean;
	}) => ({
		todayIso: initialData.minReprogramDate,
		reprogramDate: initialData.reprogramDate,
		reprogramSlots: initialData.reprogramSlots,
		reprogramSlotsLoaded: Boolean(initialData.reprogramSlotsLoaded),
		initParts: parseIso(initialData.reprogramDate)
	});

	// svelte-ignore state_referenced_locally
	const reprogramInitial = initialReprogramState(data);
	const todayIso = reprogramInitial.todayIso;
	const initParts = reprogramInitial.initParts;

	let selectedDate = $state(reprogramInitial.reprogramDate);
	let viewYear = $state(initParts.y);
	let viewMonth = $state(initParts.m - 1);
	let slotsCache = $state<Record<string, SlotBatch>>({});
	let reprogramOpen = $state(false);
	// Abrir «Reprogramar» pide los horarios desde el navegador. Antes de hidratar, un toque la abría
	// de forma nativa y la hidratación la volvía a cerrar sin pedir nada (`bind:open` impone su
	// estado inicial), así que llega inerte hasta que la página está lista.
	const client = createClientReadiness();
	let loadingSlots = $state(false);
	let slotsError = $state<string | null>(null);
	let slotRequest = 0;
	let selectedSlot = $state('');
	// svelte-ignore state_referenced_locally
	let ignoreBreak = $state(false);
	let submitting = $state(false);

	$effect(() => {
		const nextParts = parseIso(data.reprogramDate);
		selectedDate = data.reprogramDate;
		viewYear = nextParts.y;
		viewMonth = nextParts.m - 1;
		slotsCache = {};
  slotRequest += 1;
		selectedSlot = '';
		slotsError = null;
		loadingSlots = false;
	});

	const weekdayLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

	const currentSlots = $derived(slotsCache[selectedDate]?.slots ?? []);
	const selectedSlotTime = $derived(currentSlots.find((s) => s.starts_at === selectedSlot)?.time ?? '');

	const monthLabel = $derived(
		new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(viewYear, viewMonth, 1))
	);

	const canGoPrev = $derived(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}` > todayIso.slice(0, 7));

	const monthDays = $derived.by(() => {
		const startOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		const cells: ({ day: number; iso: string } | null)[] = [];
		for (let i = 0; i < startOffset; i++) cells.push(null);
		for (let d = 1; d <= daysInMonth; d++) {
			const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
			cells.push({ day: d, iso });
		}
		return cells;
	});

	const selectedDayLabel = $derived.by(() => {
		const { y, m, d } = parseIso(selectedDate);
		return new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(
			new Date(y, m - 1, d)
		);
	});

	const isPast = (iso: string) => iso < todayIso;
	const isToday = (iso: string) => iso === todayIso;
	const isSelected = (iso: string) => iso === selectedDate;

	const loadSlots = async (date: string) => {
		const appointmentId = data.appointment?.id;
		if (!appointmentId || slotsCache[date]) return;
		const request = ++slotRequest;
		loadingSlots = true;
		slotsError = null;
		try {
			const params = new URLSearchParams({
				date,
    expected_revision: data.management?.revision ?? '',
				ignore_break: ignoreBreak ? 'true' : 'false'
			});
			const res = await fetch(
				`/odonto/turnos/${appointmentId}/slots?${params.toString()}`
			);
			const body = await res.json().catch(() => ({}));
			if (request !== slotRequest) return;
			if (!res.ok) {
				slotsError = body?.message ?? 'No se pudieron cargar los horarios.';
				
			} else {
				if (!Array.isArray(body.slots) || !Number.isSafeInteger(body.availabilityRevision) || body.availabilityRevision < 1 ||
     !Number.isSafeInteger(body.durationMinutes) || body.durationMinutes < 1) throw new Error('Invalid slots');
    slotsCache = { ...slotsCache, [date]: { slots: body.slots, availabilityRevision: body.availabilityRevision, durationMinutes: body.durationMinutes } };
			}
		} catch {
			if (request !== slotRequest) return;
			slotsError = 'No se pudieron cargar los horarios. Revisá tu conexión.';
			
		} finally {
			if (request === slotRequest) loadingSlots = false;
		}
	};

	$effect(() => {
		if (reprogramOpen && canOperate && !isClosed) void loadSlots(selectedDate);
	});

	const selectDay = (iso: string) => {
		if (isPast(iso) || selectedDate === iso) return;
		selectedDate = iso;
		selectedSlot = '';
		slotsError = null;
		loadSlots(iso);
	};

	const updateIgnoreBreak = (event: Event) => {
		ignoreBreak = (event.currentTarget as HTMLInputElement).checked;
		selectedSlot = '';
		slotsCache = {};
		slotRequest += 1;
		void loadSlots(selectedDate);
	};

	const prevMonth = () => {
		if (!canGoPrev) return;
		if (viewMonth === 0) {
			viewMonth = 11;
			viewYear -= 1;
		} else {
			viewMonth -= 1;
		}
	};

	const nextMonth = () => {
		if (viewMonth === 11) {
			viewMonth = 0;
			viewYear += 1;
		} else {
			viewMonth += 1;
		}
	};

 const onStaffAction: SubmitFunction = ({ cancel, action, formData }) => {
  if (submitting || (action.search === '?/reschedule' && !selectedSlot && !feedback?.retry)) { cancel(); return; }
  const fields = Object.fromEntries([...formData].map(([key,value]) => [key, String(value)]));
  const kind = action.searchParams.has('/late_deposit') ? 'late_deposit' as const :
   action.searchParams.has('/reschedule') ? 'reschedule' as const : 'update_status' as const;
  submitting = true;
  localFeedback = null;
  return async ({ result, update }) => {
   try {
    if (result.type === 'error') {
     localFeedback = { success: false, message: 'No pudimos comprobar el resultado. Reintentá esta misma acción para consultar si quedó guardada.',
      retry: { action: kind, fields } };
    } else { await update(); }
   } finally { submitting = false; }
  };
 };

</script>

<section class="ux-page">
	<BackLink href={`/odonto/agenda?date=${data.fromDate}`} label="Volver" />

	{#if feedback?.message}
		<p bind:this={feedbackElement} tabindex="-1" role={feedback.success ? 'status' : 'alert'} class={`ux-alert ${feedback.success ? 'ux-alert-success' : ''}`}>
			{feedback.message}
		</p>
	{/if}

 {#if feedback?.retry}
  <form method="POST" action={`?/${feedback.retry.action}`} use:enhance={onStaffAction} class="flex flex-wrap gap-3">
   {#each Object.entries(feedback.retry.fields) as [name,value]}<input type="hidden" {name} {value} />{/each}
   <button class="ux-btn-primary" disabled={submitting}>{submitting ? 'Reintentando…' : 'Reintentar la misma acción'}</button>
  </form>
 {/if}

	{#if data.justCreated && data.appointment && data.delivery.available && !data.phoneWarningAcknowledged}
		<section aria-labelledby="activation-title" class="ux-card">
			<h2 id="activation-title" class="ux-section-title">Último paso</h2>
			<p class="mt-1 text-sm text-fg-65">El turno quedó creado.</p>
			{#if data.delivery.hasPhone}
				<form method="POST" action="?created=1&/prepare_delivery" target="_blank" rel="noopener">
					<input type="hidden" name="kind" value="activation" />
					<input type="hidden" name="destination" value="whatsapp" />
					<input type="hidden" name="expected_revision" value={data.management?.revision} />
					<input type="hidden" name="device" value={activationDevice} />
					<button class="group mt-4 flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-success-500 px-5 py-4 text-center text-lg font-bold leading-tight text-on-accent transition hover:bg-success-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus-success-300">
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-6 w-6 shrink-0 transition-transform group-hover:scale-105">
							<path d="M20.4 11.7a8.4 8.4 0 0 1-12.5 7.3L4 20l1.1-3.7a8.4 8.4 0 1 1 15.3-4.6Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
							<path d="M8.5 8.2c.2 3.4 2.3 5.5 5.7 5.8l1.2-1.3 2 .9c-.3 1.5-1.4 2.4-2.8 2.5-4.7-.2-8.1-3.5-8.2-8.2.1-1.4 1-2.5 2.5-2.8l.9 2-1.3 1.1Z" fill="currentColor" opacity=".9" />
						</svg>
						<span>Enviar enlace de activación</span>
					</button>
				</form>
				<p class="mt-3 text-sm text-fg-65">
					Se abre WhatsApp con el enlace. Revisá el mensaje y envialo para que el paciente pueda activar sus recordatorios.
				</p>
			{:else}
				<div class="ux-alert ux-alert-warning mt-3">
					<p class="text-base">Falta completar el teléfono del paciente</p>
					<p class="mt-1 font-medium">Cargá un número argentino completo con código de área para preparar el enlace de WhatsApp.</p>
					{#if data.appointment?.patients?.id}
						<a href={`/odonto/pacientes/${data.appointment.patients.id}`} target="_blank" rel="noreferrer" class="ux-btn-primary mt-3 w-full sm:w-auto">
							Corregir teléfono del paciente
						</a>
					{/if}
				</div>
			{/if}
		</section>
	{/if}

	{#if data.justRescheduled && data.appointment && data.delivery.available}
		<section class="ux-card" aria-labelledby="rescheduled-title">
			<h2 id="rescheduled-title" class="ux-section-title">Turno reprogramado</h2>
			<p class="mt-2 text-sm text-fg-65">
				Los avisos del horario anterior se invalidaron y los recordatorios se recalcularon para
				la nueva fecha. Avisale al paciente del cambio.
			</p>
			<div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
				{#if data.delivery.hasPhone}
					<form method="POST" action="?rescheduled=1&/prepare_delivery" target="_blank" rel="noopener">
						<input type="hidden" name="kind" value="rescheduled" />
						<input type="hidden" name="destination" value="whatsapp" />
						<input type="hidden" name="expected_revision" value={data.management?.revision} />
						<input type="hidden" name="device" value={activationDevice} />
						<button class="ux-btn-primary w-full sm:w-auto">Enviar actualización por WhatsApp</button>
					</form>
				{:else}
					<p class="text-sm font-semibold text-warning-100">Este paciente no tiene un teléfono válido cargado: avisale del cambio por otro medio.</p>
				{/if}
				<form method="POST" action="?rescheduled=1&/prepare_delivery" target="_blank" rel="noopener">
					<input type="hidden" name="kind" value="rescheduled" />
					<input type="hidden" name="destination" value="preview" />
					<input type="hidden" name="expected_revision" value={data.management?.revision} />
					<button class="ux-btn-secondary w-full sm:w-auto">Ver lo que verá el paciente</button>
				</form>
			</div>
		</section>
	{/if}

	{#if data.appointment}
		<article class="ux-card" data-appointment-summary>
			<div class="flex flex-wrap items-start gap-x-4 gap-y-3">
				<div class="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-soft text-xl font-bold uppercase text-accent" aria-hidden="true">
					{(data.appointment.patients?.full_name || data.appointment.service_name_snapshot || '·').trim().charAt(0)}
				</div>
				<div class="min-w-0 flex-[1_1_14rem]">
					<h1 class="ux-title">{data.appointment.patients?.full_name ?? 'Sin paciente'}</h1>
					<p class="mt-1 text-base font-semibold text-fg-55">
						{data.appointment.service_name_snapshot} ·&nbsp;{isJoint ? 'Equipo:' : 'Profesional:'} {data.appointment.professional_name_snapshot}
					</p>
					{#if data.appointment.patients?.id}
						<a href={`/odonto/pacientes/${data.appointment.patients.id}`} class="mt-1 inline-block text-sm font-semibold text-accent underline underline-offset-2">Ver ficha del paciente</a>
					{/if}
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{#if appointmentStarted}
						<span class="ux-badge ux-badge-warning" data-started-badge>{appointmentInProgress ? 'En curso' : 'Turno pasado'}</span>
					{/if}
					<span class={headerTone}>{statusLabels[data.appointment.status] ?? data.appointment.status}{depositSuffix}</span>
				</div>
			</div>

			{#if appointmentStarted}
				<p class="ux-alert ux-alert-warning mt-4" data-started-notice>
					{appointmentInProgress ? 'Este turno ya empezó.' : 'Este turno ya pasó.'}
					{#if canOperate}
						Por eso no se puede cancelar. Si el paciente necesita otro horario, podés reprogramarlo.
					{/if}
				</p>
			{/if}

			<dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 lg:grid-cols-4">
				<div>
					<dt class="text-sm font-semibold text-fg-55">Fecha</dt>
					<dd class="mt-1 font-semibold text-fg">{dateOnly(data.appointment.starts_at)}</dd>
				</div>
				<div>
					<dt class="text-sm font-semibold text-fg-55">Hora</dt>
					<dd class="mt-1 font-semibold tabular-nums text-fg">{timeOnly(data.appointment.starts_at)} a {timeOnly(data.appointment.ends_at)}</dd>
				</div>
				<div>
					<dt class="text-sm font-semibold text-fg-55">Duración</dt>
					<dd class="mt-1 font-semibold text-fg">{durationText(data.appointment)}</dd>
				</div>
				{#if data.appointment.booking_context}
					<div>
						<dt class="text-sm font-semibold text-fg-55">Modalidad</dt>
						<dd class="mt-1 font-semibold text-fg">{BOOKING_MODALITY_LABELS[data.appointment.booking_context.modality as BookingModality]}</dd>
					</div>
				{/if}
				{#if data.appointment.price_quote_snapshot}
					{@const registeredPriceNotice = quotedPriceEstimateNotice(data.appointment.price_quote_snapshot, 'registered')}
					<div>
						<dt class="text-sm font-semibold text-fg-55">Arancel registrado al reservar</dt>
						<dd class="mt-1 font-semibold text-fg">{formatQuotedPrice(data.appointment.price_quote_snapshot)}</dd>
						{#if registeredPriceNotice}
							<dd class="mt-1 text-xs text-fg-65">{registeredPriceNotice}</dd>
						{/if}
					</div>
				{/if}
				<div class="col-span-2 sm:col-span-1">
					<dt class="text-sm font-semibold text-fg-55">Teléfono</dt>
					<dd class="mt-1 font-semibold tabular-nums text-fg">{data.appointment.patients?.phone_e164 ?? 'Sin teléfono'}</dd>
				</div>
				<div class="col-span-2 sm:col-span-1">
					<dt class="text-sm font-semibold text-fg-55">Correo</dt>
					<dd class="mt-1 font-semibold text-fg">{data.appointment.patients?.email ?? 'Sin correo electrónico'}</dd>
				</div>
				<div>
					<dt class="text-sm font-semibold text-fg-55">Origen</dt>
					<dd class="mt-1 font-semibold text-fg">{sourceLabels[data.appointment.source] ?? data.appointment.source}</dd>
				</div>
				{#if isJoint}
					<div class="col-span-full">
						<dt class="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg-55">
							Profesionales reservados
							<span class="ux-badge">Turno conjunto ·&nbsp;{appointmentProfessionals.length} profesionales</span>
						</dt>
						<dd class="mt-2 flex flex-wrap gap-2">
							{#each appointmentProfessionals as professional}
								<span class="rounded-full border border-line bg-fill-04 px-3 py-1.5 text-sm font-semibold text-fg">{professional.professional_name_snapshot}</span>
							{/each}
						</dd>
						<p class="mt-2 text-sm text-fg-55">Es un único turno y ocupa simultáneamente la agenda de todo el equipo.</p>
					</div>
				{/if}
				{#if data.appointment.internal_note}
					<div class="col-span-full">
						<dt class="text-sm font-semibold text-fg-55">Nota interna</dt>
						<dd class="mt-1 whitespace-pre-wrap font-semibold text-fg">{data.appointment.internal_note}</dd>
					</div>
				{/if}
				{#if data.appointment.cancelled_reason}
					<div class="col-span-full">
						<dt class="text-sm font-semibold text-fg-55">Motivo de cancelación</dt>
						<dd class="mt-1 whitespace-pre-wrap font-semibold text-fg">{data.appointment.cancelled_reason}</dd>
					</div>
				{/if}
			</dl>
		</article>

		{#if canOperate && !isClosed}
			<div class={`grid items-start gap-4 ${canShowCancelAction && data.management ? 'lg:grid-cols-2' : ''}`} data-appointment-actions>
				<details bind:open={reprogramOpen} id="reprogramar" class="ux-disclosure" inert={!client.ready}>
					<summary><h2 class="ux-section-title">Reprogramar</h2></summary>
					<div class="ux-disclosure-body">
						{#if isJoint}
							<div class="ux-alert ux-alert-info mb-4">
								<p>Se recalculará la disponibilidad de todo el equipo</p>
								<p class="mt-1 font-medium">
									Sólo verás horarios en los que los {appointmentProfessionals.length} profesionales estén libres. Si uno no puede, el turno completo conserva su horario actual.
								</p>
							</div>
						{/if}

						<label class="flex cursor-pointer items-start gap-3">
							<input type="checkbox" checked={ignoreBreak} onchange={updateIgnoreBreak} class="mt-0.5" />
							<span>
								<span class="block text-sm font-bold text-fg">Ignorar descanso en la nueva fecha</span>
								<span class="mt-1 block text-sm text-fg-65">
									Usalo sólo después de confirmar que puede comenzarse inmediatamente. Nunca permite superponer dos atenciones reales.
								</span>
							</span>
						</label>

						<div class="mt-4 rounded-2xl border border-line p-3 sm:p-4">
							<div class="flex items-center justify-between">
								<button type="button" onclick={prevMonth} disabled={!canGoPrev} aria-label="Mes anterior" class="grid h-11 w-11 place-items-center rounded-xl border border-line text-fg-80 transition hover:bg-fill-10 disabled:opacity-30 disabled:hover:bg-transparent">
									<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
								</button>
								<span class="text-sm font-semibold first-letter:uppercase text-fg">{monthLabel}</span>
								<button type="button" onclick={nextMonth} aria-label="Mes siguiente" class="grid h-11 w-11 place-items-center rounded-xl border border-line text-fg-80 transition hover:bg-fill-10">
									<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
								</button>
							</div>
							<div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-copy-subtle">
								{#each weekdayLabels as wd}
									<span class="py-1">{wd}</span>
								{/each}
							</div>
							<div class="mt-1 grid grid-cols-7 gap-1">
								{#each monthDays as cell}
									{#if cell === null}
										<span></span>
									{:else}
										<button
											type="button"
											onclick={() => selectDay(cell.iso)}
											disabled={isPast(cell.iso)}
											class={`grid h-10 place-items-center rounded-xl text-sm font-semibold tabular-nums transition ${
												isSelected(cell.iso)
													? 'bg-accent-strong text-on-accent'
													: isPast(cell.iso)
														? 'cursor-not-allowed text-fg-20'
														: 'text-fg-80 hover:bg-fill-10'
											} ${isToday(cell.iso) && !isSelected(cell.iso) ? 'ring-1 ring-focus-accent-500-60' : ''}`}
										>
											{cell.day}
										</button>
									{/if}
								{/each}
							</div>
						</div>

						<div class="mt-4">
							<div class="flex items-center justify-between gap-2">
								<span class="text-sm font-semibold text-fg-65">
									Horarios ·&nbsp;<span class="text-fg">{selectedDayLabel}</span>
								</span>
								{#if loadingSlots}
									<span class="text-xs font-semibold text-accent-400">Buscando…</span>
								{/if}
							</div>

							{#if slotsError}
								<p class="ux-alert mt-3">{slotsError}</p>
								<button type="button" class="ux-btn-secondary mt-3" onclick={() => loadSlots(selectedDate)} disabled={loadingSlots}>Volver a consultar horarios</button>
							{:else if loadingSlots && currentSlots.length === 0}
								<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
									{#each Array(8) as _}
										<div class="h-10 animate-pulse rounded-xl bg-fill-04"></div>
									{/each}
								</div>
							{:else if currentSlots.length === 0}
								<p class="mt-3 text-sm text-fg-55">No hay horarios disponibles ese día. Probá con otra fecha.</p>
							{:else}
								<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
									{#each currentSlots as slot}
										<button
											type="button"
											onclick={() => (selectedSlot = slot.starts_at)}
											class={`rounded-xl border px-2 py-2.5 text-sm font-semibold tabular-nums transition ${
												selectedSlot === slot.starts_at
													? 'border-accent-600 bg-accent-strong text-on-accent'
													: 'border-line bg-fill-04 text-fg-85 hover:border-accent-500-60 hover:bg-fill-10'
											}`}
										>
											{slot.time}
										</button>
									{/each}
								</div>
							{/if}
						</div>

						{#if slotsCache[selectedDate]}<p class="mt-4 text-sm text-fg-70">Duración de la consulta: {slotsCache[selectedDate].durationMinutes}&nbsp;minutos.</p>{/if}
						<form method="POST" action="?/reschedule" class="mt-4" use:enhance={onStaffAction}>
							<input type="hidden" name="operation_id" value={data.management?.rescheduleOperationId ?? ''} />
							<input type="hidden" name="expected_revision" value={data.management?.revision ?? ''} />
							<input type="hidden" name="availability_revision" value={slotsCache[selectedDate]?.availabilityRevision ?? ''} />
							<input type="hidden" name="slot_starts_at" value={selectedSlot} />
							<input type="hidden" name="reprogram_date" value={selectedDate} />
							<input type="hidden" name="ignore_break" value={ignoreBreak ? 'true' : 'false'} />
							<button type="submit" disabled={!selectedSlot || submitting || !!feedback?.retry} class="ux-btn-primary w-full">
								{submitting
									? 'Reprogramando…'
									: selectedSlot
										? `Reprogramar a las ${selectedSlotTime}`
										: 'Elegí un horario'}
							</button>
						</form>
					</div>
				</details>

				{#if canShowCancelAction && data.management}
					<StaffCancelPanel
						patientName={data.appointment.patients?.full_name ?? 'este paciente'}
						when={`${dateOnly(data.appointment.starts_at)} a las ${timeOnly(data.appointment.starts_at)}`}
						patientHasEmail={Boolean(data.appointment.patients?.email)}
						deposit={data.deposit}
						operationId={data.management.statusOperationId}
						revision={data.management.revision}
						disabled={!canUseStatusAction('cancelled')}
						onsubmit={onStaffAction}
					/>
				{/if}
			</div>
		{/if}

		{#if data.deposit}
			<section class="ux-card" data-deposit-panel>
				<div class="flex flex-wrap items-center gap-3">
					<h2 class="ux-section-title">Seña</h2>
					<span class={depositTone[data.deposit.status]}>{DEPOSIT_STATUS_LABELS[data.deposit.status]}</span>
				</div>
				<p class="mt-3 text-fg">
					{formatDepositAmount(data.deposit.amount)} ·&nbsp;vence el {formatInTimeZone(data.deposit.due_at, timeZone).full}
				</p>
				<p class="mt-2 text-sm text-fg-65">
					{#if isClosed && data.deposit.status === 'pending'}
						El turno está cancelado. La seña no se había registrado al cancelarlo.
					{:else if data.deposit.status === 'pending'}
						{data.deposit.cancelsItself === true
							? 'Si no se registra antes del vencimiento, el turno se cancela solo.'
							: data.deposit.cancelsItself === false
								? 'No se cancela sola: si no llega, decide el consultorio.'
								: 'No pudimos comprobar si este turno se cancela solo.'}
					{:else if data.deposit.status === 'paid'}
						Recibida{data.deposit.recorded_at ? ` el ${formatInTimeZone(data.deposit.recorded_at, timeZone).full}` : ''}.
					{:else if data.deposit.status === 'waived'}
						{data.deposit.waived_reason === 'policy_disabled'
							? 'Exceptuada al apagar la seña del consultorio.'
							: 'Exceptuada por el consultorio.'}
					{:else}
						Venció sin registrarse: el turno se canceló automáticamente.
					{/if}
				</p>
				{#if depositActionsAvailable && data.deposit}
					<div class="mt-4 flex flex-wrap items-start gap-3">
						{#if data.deposit.status === 'pending'}
							<form method="POST" action="?/deposit">
								<input type="hidden" name="deposit_action" value="paid" />
								<input type="hidden" name="expected_revision" value={data.deposit.revision} />
								<button class="ux-btn-primary">Confirmar seña</button>
							</form>
							<details>
								<summary class="ux-btn-secondary">Exceptuar</summary>
								<form method="POST" action="?/deposit" class="mt-2 flex flex-col gap-2">
									<p class="max-w-72 text-sm text-fg-55">El turno queda Confirmado sin seña, como decisión del consultorio.</p>
									<input type="hidden" name="deposit_action" value="waived" />
									<input type="hidden" name="expected_revision" value={data.deposit.revision} />
									<button class="ux-btn-secondary">Sí, exceptuar la seña</button>
								</form>
							</details>
						{:else if data.deposit.status === 'paid' || (data.deposit.status === 'waived' && data.deposit.waived_reason === 'staff')}
							<details>
								<summary class="ux-btn-secondary">Deshacer</summary>
								<form method="POST" action="?/deposit" class="mt-2 flex flex-col gap-2">
									<p class="max-w-72 text-sm text-fg-55">
										La seña vuelve a pendiente y, si el turno estaba Confirmado, vuelve a Reservado.
									</p>
									<input type="hidden" name="deposit_action" value="pending" />
									<input type="hidden" name="expected_revision" value={data.deposit.revision} />
									<button class="ux-btn-secondary">Sí, deshacer el registro</button>
								</form>
							</details>
						{/if}
					</div>
				{/if}
			</section>
		{/if}

		{#if data.depositFinancials && (data.depositFinancials.appliedAmount !== '0' || data.depositFinancials.forfeitedAmount !== '0' || data.depositFinancials.unresolvedAmount !== '0' || data.depositFinancials.latePayments.length || (isClosed && data.deposit && data.canRecordDeposit && !data.demo))}
			<section class="ux-card" aria-labelledby="deposit-financials-title">
				<h2 id="deposit-financials-title" class="ux-section-title">Importes registrados</h2>
				<dl class="mt-4 grid gap-4 sm:grid-cols-3">
					<div><dt class="text-sm text-fg-65">A cuenta de la consulta</dt><dd class="mt-1 font-semibold">{formatDepositMoney(data.depositFinancials.appliedAmount)}</dd></div>
					<div><dt class="text-sm text-fg-65">No aplicables por reprogramación</dt><dd class="mt-1 font-semibold">{formatDepositMoney(data.depositFinancials.forfeitedAmount)}</dd></div>
					<div><dt class="text-sm text-fg-65">Por resolver con el paciente</dt><dd class="mt-1 font-semibold">{formatDepositMoney(data.depositFinancials.unresolvedAmount)}</dd></div>
				</dl>
				<p class="mt-3 text-sm text-fg-65">Son los importes de señas registrados en este turno. No incluyen otros pagos ni registran devoluciones.</p>
				{#if isClosed && data.deposit && data.canRecordDeposit && !data.demo && data.management}
					<details id="late-deposit-record" class="mt-5 border-t border-line pt-4" {...(feedback?.lateDepositDraft ? { open: true } : {})}>
						<summary class="cursor-pointer text-base font-semibold text-accent">Registrar dinero después de cancelar</summary>
						<form method="POST" action="?/late_deposit" use:enhance={onStaffAction} class="mt-4">
							<fieldset class="flex flex-col gap-4" disabled={!canOperate || submitting || !!feedback?.retry}>
								<p class="text-sm text-fg-65">El turno sigue cancelado. El importe queda registrado por resolver.</p>
								<input type="hidden" name="operation_id" value={data.management.lateDepositOperationId} />
								<input type="hidden" name="expected_revision" value={data.management.revision} />
								<input type="hidden" name="late_action" value="record" />
								<input type="hidden" name="corrects_event_id" value="" />
								<div class="grid gap-4 md:grid-cols-2">
									<div>
										<label for="late-deposit-amount" class="ux-label">Importe recibido, en pesos</label>
										<input id="late-deposit-amount" class="ux-input" type="text" inputmode="numeric" name="amount" maxlength="30" required value={feedback?.lateDepositDraft?.amount ?? ''} aria-describedby="late-amount-help" />
										<p id="late-amount-help" class="mt-1 text-sm text-fg-65">Sin centavos. Por ejemplo, 40.000.</p>
									</div>
									<div>
										<label for="late-deposit-note" class="ux-label">Nota del registro (opcional)</label>
										<textarea id="late-deposit-note" class="ux-textarea" name="note" maxlength="300" rows="2" value={feedback?.lateDepositDraft?.note ?? ''}></textarea>
									</div>
								</div>
								<label class="flex items-start gap-3 text-sm text-fg">
									<input class="mt-0.5 shrink-0" type="checkbox" name="confirm_late_deposit" value="true" required />
									<span>Verifiqué el ingreso y que corresponde a este paciente</span>
								</label>
								<button class="ux-btn-primary w-full px-3 sm:w-auto sm:self-start sm:px-5">{submitting ? 'Registrando…' : 'Registrar dinero'}</button>
							</fieldset>
						</form>
					</details>
				{/if}
				{#if data.depositFinancials.latePayments.length}
					<h3 class="mt-6 font-semibold">Ingresos posteriores a la cancelación</h3>
					<ul class="mt-2 divide-y divide-line">
						{#each data.depositFinancials.latePayments as payment (payment.id)}
							<li class="py-4">
								<p class="font-semibold">{formatDepositMoney(payment.amount)}{payment.corrected ? ' · Registro corregido' : ' · Por resolver'}</p>
								<p class="mt-1 text-sm text-fg-65">Registrado el {formatInTimeZone(payment.recordedAt,timeZone).full}</p>
								{#if !payment.corrected && isClosed && data.canRecordDeposit && !data.demo && data.management}
									<details class="mt-3">
										<summary class="cursor-pointer text-sm font-semibold text-accent">Corregir un error de carga</summary>
										<form method="POST" action="?/late_deposit" use:enhance={onStaffAction} class="mt-3">
											<fieldset class="flex flex-col gap-3" disabled={!canOperate || submitting || !!feedback?.retry}>
												<input type="hidden" name="operation_id" value={payment.correctionOperationId} />
												<input type="hidden" name="expected_revision" value={data.management.revision} />
												<input type="hidden" name="late_action" value="correct" />
												<input type="hidden" name="corrects_event_id" value={payment.id} />
												<input type="hidden" name="amount" value="" /><input type="hidden" name="note" value="" />
												<label class="flex items-start gap-3 text-sm text-fg">
													<input class="mt-0.5 shrink-0" type="checkbox" name="confirm_late_deposit" value="true" required />
													<span>Este ingreso se cargó por error. Corregirlo conserva el historial y no registra una devolución.</span>
												</label>
												<button class="ux-btn-secondary self-start">{submitting ? 'Corrigiendo…' : 'Sí, corregir este registro'}</button>
											</fieldset>
										</form>
									</details>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if data.depositFinancials.latePaymentsTruncated}<p class="mt-3 text-sm text-fg-65">Se muestran los últimos 50 registros. El total incluye todos.</p>{/if}
			</section>
		{/if}

		{#if data.canEditInstructions}
			<form method="POST" action="?/save_instructions" use:enhance class="ux-card">
				<h2 class="ux-section-title">Indicaciones para este turno</h2>
				<input type="hidden" name="updated_at" value={data.appointment.updated_at} />
				<div class="mt-4 grid gap-4 md:grid-cols-2">
					<label class="block">
						<span class="ux-label">Texto en la página del turno</span>
						<textarea name="instructions" class="ux-textarea" rows="3" maxlength="2000">{data.appointment.patient_instructions_snapshot ?? ''}</textarea>
					</label>
					<label class="block">
						<span class="ux-label">Descripción breve del recordatorio</span>
						<textarea name="public_description" class="ux-textarea" rows="3" maxlength="180">{data.appointment.public_reminder_description_snapshot ?? ''}</textarea>
						<span class="mt-1 block text-sm text-fg-65">Puede aparecer en la pantalla bloqueada. No incluyas información clínica ni notas internas.</span>
					</label>
				</div>
				<button class="ux-btn-secondary mt-4">Guardar indicaciones de este turno</button>
			</form>
		{/if}

		{#if data.appointment.booking_intake?.length}
			<section class="ux-card">
				<h2 class="ux-section-title">Datos informados al reservar</h2>
				<p class="mt-2 text-sm text-fg-55">Son respuestas aportadas por el paciente desde su reserva. Se conservan junto al turno y al formulario que completó.</p>
				<dl class="mt-4 grid gap-4 sm:grid-cols-2">
					{#each data.appointment.booking_intake as response}
						<div><dt class="text-sm font-semibold text-fg-55">{response.label}</dt><dd class="mt-1 whitespace-pre-wrap break-words">{response.value}</dd></div>
					{/each}
				</dl>
			</section>
		{/if}

		{#if data.emailDeliveries?.length}
			<section class="ux-card" aria-labelledby="email-deliveries-title" data-email-deliveries>
				<h2 id="email-deliveries-title" class="ux-section-title">Correos de este turno</h2>
				<ul class="mt-3 divide-y divide-line">
					{#each data.emailDeliveries as delivery (delivery.id)}
						<li class="py-3">
							<p class="font-semibold">{emailPurposeLabels[delivery.purpose]}</p>
							<p class="mt-1 text-sm text-fg-65">{emailStateLabel(delivery)}{delivery.recipient ? ` · ${delivery.recipient}` : ''}</p>
							{#if delivery.state === 'uncertain' && canOperate}
								<p class="mt-2 text-sm text-fg-65">No sabemos si salió. Si lo reenviás, el paciente podría recibirlo dos veces.</p>
								<div class="mt-2 flex flex-wrap gap-2">
									<form method="POST" action="?/email_delivery" use:enhance>
										<input type="hidden" name="delivery_id" value={delivery.id} /><input type="hidden" name="decision" value="resend" />
										<button class="ux-btn-secondary">Reenviar igual</button>
									</form>
									<form method="POST" action="?/email_delivery" use:enhance>
										<input type="hidden" name="delivery_id" value={delivery.id} /><input type="hidden" name="decision" value="dismiss" />
										<button class="ux-btn-secondary">Dejarlo así</button>
									</form>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.management && canOperate && !isClosed}
			<details class="ux-disclosure" data-revoke-links>
				<summary>Invalidar los enlaces enviados al paciente</summary>
				<form method="POST" action="?/revoke_links" use:enhance class="ux-disclosure-body flex flex-col gap-3">
					<p class="text-sm text-fg-65">Usalo si un enlace llegó a otra persona. Los enlaces ya enviados dejan de permitir cancelar o reprogramar. El turno no cambia y los próximos avisos llevan un enlace nuevo.</p>
					<input type="hidden" name="expected_revision" value={data.management.revision} />
					<div><button class="ux-btn-secondary">Invalidar enlaces</button></div>
				</form>
			</details>
		{/if}

		<details class="ux-disclosure">
			<summary>Historial</summary>
			<div class="ux-disclosure-body">
				{#if data.auditLogs === null}
					<p class="ux-alert">No pudimos cargar el historial del turno. Volvé a intentar en unos momentos.</p>
				{/if}
				<ul class="divide-y divide-line">
					{#each data.auditLogs ?? [] as log}
						<li class="py-3 text-sm first:pt-0 last:pb-0">
							<p class="font-semibold text-fg">{auditLabel(log)}</p>
							<p class="mt-1 text-xs font-semibold text-copy-subtle">{formatDateTime(log.created_at, timeZone)}</p>
							{#if auditDetail(log)}
								<p class="mt-2 text-fg-70">{auditDetail(log)}</p>
							{/if}
						</li>
					{/each}
				</ul>
				{#if data.auditLogs?.length === 0}
					<p class="text-sm text-fg-60">Todavía no hay movimientos registrados.</p>
				{/if}
			</div>
		</details>
	{/if}
</section>
