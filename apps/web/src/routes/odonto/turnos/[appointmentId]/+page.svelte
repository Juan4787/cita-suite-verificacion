<script lang="ts">
	import {formatQuotedPrice} from '$lib/booking/pricing';
	import BackLink from '$lib/components/BackLink.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import { refineDeviceClass, whatsappHrefFor, type DeviceClass } from '$lib/device';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { isUpcomingActiveAppointment } from '$lib/utils/appointment-visibility';
import { BOOKING_MODALITY_LABELS, type BookingModality } from '@turnos-saas/shared/booking-integration';

	type Slot = { date: string; time: string; starts_at: string; professional_name: string };
	type AuditLog = {
		id: string;
		user_id: string | null;
		action: string;
		metadata: Record<string, unknown> | null;
		created_at: string;
	};

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean; role: string };canEditInstructions?:boolean;
			appointment: any;
			auditLogs: AuditLog[];
			messageDispatches: any[];
			userLabels: Record<string, string>;
			reprogramDate: string;
			minReprogramDate: string;
			reprogramSlots: Slot[];
			reprogramSlotsLoaded?: boolean;
			fromDate: string;
			justRescheduled: boolean;
			justCreated: boolean;
			activationWhatsAppUrl: string | null;
			activationWhatsAppWebUrl: string | null;
			activationDevice: DeviceClass;
		activationPublicUrl: string | null;
		phoneWarningAcknowledged: boolean;
		rescheduleWhatsAppUrl: string | null;
		rescheduleWhatsAppWebUrl: string | null;
		reschedulePublicUrl: string | null;
			demo: boolean;
		};
		form?: { success?: boolean; message?: string };
	}>();

	let refinedActivationDevice = $state<DeviceClass | null>(null);
	const activationDevice = $derived(refinedActivationDevice ?? data.activationDevice);
	const activationWhatsAppHref = $derived(
		whatsappHrefFor(activationDevice, data.activationWhatsAppUrl, data.activationWhatsAppWebUrl)
	);
	const rescheduleWhatsAppHref = $derived(
		whatsappHrefFor(activationDevice, data.rescheduleWhatsAppUrl, data.rescheduleWhatsAppWebUrl)
	);

	onMount(() => {
		// iPadOS puede identificarse como macOS. Antes del clic refinamos el dato
		// del servidor para mantener wa.me en tablets y WhatsApp Web sólo en PC.
		refinedActivationDevice = refineDeviceClass(data.activationDevice, navigator);
	});

	const canOperate = $derived(data.context.canOperate && !data.demo);
	const isClosed = $derived(data.appointment?.status === 'cancelled');
	const canShowCancelAction = $derived(
		!isClosed && isUpcomingActiveAppointment(data.appointment)
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
		reserved: 'bg-[#7c3aed]/25 text-[#c4b5fd]',
		confirmed: 'bg-emerald-400/15 text-emerald-200',
		cancelled: 'bg-red-500/15 text-red-200',
		reschedule_requested: 'bg-amber-400/15 text-amber-100'
	};

	const timeOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));

	const dateOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
			new Date(value)
		);

	const durationText = (appointment: any) => {
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
		const user = log.user_id ? (data.userLabels[log.user_id] ?? log.user_id.slice(0, 8)) : 'Sistema';
		if (log.action === 'appointment.created') return `${user} creó el turno`;
		if (log.action === 'appointment.public_created') return 'El paciente reservó el turno online';
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
		return `${user} registró ${log.action}`;
	};

	const auditDetail = (log: AuditLog) => {
		if (log.action === 'appointment.rescheduled') {
			const from = metadataValue(log, 'from_starts_at');
			const to = metadataValue(log, 'to_starts_at');
			if (from && to) return `${formatDateTime(from)} -> ${formatDateTime(to)}`;
		}
		const reason = metadataValue(log, 'reason');
		if (reason) return reason;
		const fromStatus = metadataValue(log, 'from_status');
		const toStatus = metadataValue(log, 'to_status');
		if (fromStatus && toStatus) return `${statusLabels[fromStatus] ?? fromStatus} -> ${statusLabels[toStatus] ?? toStatus}`;
		return '';
	};

	const canUseStatusAction = (status: string) => {
		if (isClosed || data.appointment.status === status) return false;
		return canOperate;
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
	let slotsCache = $state<Record<string, Slot[]>>(
		reprogramInitial.reprogramSlotsLoaded
			? { [reprogramInitial.reprogramDate]: reprogramInitial.reprogramSlots ?? [] }
			: {}
	);
	let reprogramOpen = $state(false);
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
		slotsCache = data.reprogramSlotsLoaded
			? { [data.reprogramDate]: data.reprogramSlots ?? [] }
			: {};
		selectedSlot = '';
		slotsError = null;
		loadingSlots = false;
	});

	const weekdayLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

	const currentSlots = $derived(slotsCache[selectedDate] ?? []);
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
		if (slotsCache[date]) return;
		const request = ++slotRequest;
		loadingSlots = true;
		slotsError = null;
		try {
			const params = new URLSearchParams({
				date,
				ignore_break: ignoreBreak ? 'true' : 'false'
			});
			const res = await fetch(
				`/odonto/turnos/${data.appointment.id}/slots?${params.toString()}`
			);
			const body = await res.json().catch(() => ({}));
			if (request !== slotRequest) return;
			if (!res.ok) {
				slotsError = body?.message ?? 'No se pudieron cargar los horarios.';
				slotsCache = { ...slotsCache, [date]: [] };
			} else {
				slotsCache = { ...slotsCache, [date]: (body.slots ?? []) as Slot[] };
			}
		} catch {
			if (request !== slotRequest) return;
			slotsError = 'No se pudieron cargar los horarios. Revisá tu conexión.';
			slotsCache = { ...slotsCache, [date]: [] };
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

	const onReschedule: SubmitFunction = ({ cancel }) => {
		if (!selectedSlot || submitting) {
			cancel();
			return;
		}
		submitting = true;
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	};
</script>

<section class="flex flex-col gap-5">
	<div class="flex flex-col items-start gap-4">
		<BackLink href={`/odonto/agenda?date=${data.fromDate}`} label="Volver" />
		<div class="flex items-center gap-3 text-sm font-semibold text-neutral-500 dark:text-white/55">
			<span>Agenda</span>
			<span class="text-white/25">/</span>
			<span>Turno</span>
			<span class="text-white/25">/</span>
			<span class="text-[#a78bfa]">Detalle</span>
		</div>
	</div>

	{#if form?.message}
		<p class={`rounded-2xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-emerald-400/15 text-emerald-100' : 'bg-red-500/15 text-red-100'}`}>
			{form.message}
		</p>
	{/if}

	{#if data.justCreated && data.appointment && !data.phoneWarningAcknowledged}
		<section
			aria-labelledby="activation-title"
			class="relative overflow-hidden rounded-3xl border border-violet-300/35 bg-[linear-gradient(135deg,rgba(124,58,237,0.2),rgba(7,22,38,0.96)_62%)] p-5 shadow-2xl shadow-violet-950/25 sm:p-7"
		>
			<div class="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-violet-400/10 blur-2xl" aria-hidden="true"></div>
			<div class="relative">
				<span class="inline-flex rounded-full border border-violet-300/25 bg-violet-300/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-violet-100">
					Turno creado
				</span>
				<h2 id="activation-title" class="mt-4 text-xl font-extrabold tracking-tight text-white sm:text-2xl">
					Último paso
				</h2>
				{#if activationWhatsAppHref}
					<a
						href={activationWhatsAppHref}
						target="_blank"
						rel="noreferrer"
						class="group mt-5 flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-5 py-4 text-center text-lg font-extrabold leading-tight text-white shadow-xl shadow-emerald-950/30 ring-1 ring-emerald-300/35 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-emerald-300"
					>
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-6 w-6 shrink-0 transition-transform group-hover:scale-105">
							<path d="M20.4 11.7a8.4 8.4 0 0 1-12.5 7.3L4 20l1.1-3.7a8.4 8.4 0 1 1 15.3-4.6Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
							<path d="M8.5 8.2c.2 3.4 2.3 5.5 5.7 5.8l1.2-1.3 2 .9c-.3 1.5-1.4 2.4-2.8 2.5-4.7-.2-8.1-3.5-8.2-8.2.1-1.4 1-2.5 2.5-2.8l.9 2-1.3 1.1Z" fill="currentColor" opacity=".9" />
						</svg>
						<span>Enviar enlace de activación</span>
					</a>
					<p class="mt-3 text-center text-sm font-semibold leading-relaxed text-white/65">
						El paciente recibirá un enlace para activar sus recordatorios.
					</p>
				{:else}
					<div class="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] p-5">
						<p class="text-base font-extrabold text-amber-50">Falta completar el teléfono del paciente</p>
						<p class="mt-2 text-sm leading-relaxed text-amber-50/75">
							Cargá un número argentino completo con código de área para preparar el enlace de WhatsApp.
						</p>
						{#if data.appointment.patients?.id}
							<a
								href={`/odonto/pacientes/${data.appointment.patients.id}`}
								target="_blank"
								rel="noreferrer"
								class="ux-btn-primary mt-4 w-full"
							>
								Corregir teléfono del paciente
							</a>
						{/if}
					</div>
				{/if}
			</div>
		</section>
	{/if}

	{#if data.justRescheduled && data.appointment}
		<div class="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5">
			<h2 class="text-lg font-semibold text-emerald-50">Turno reprogramado</h2>
			<p class="mt-2 text-sm text-emerald-100/80">
				Los avisos del horario anterior se invalidaron y los recordatorios se recalcularon para
				la nueva fecha. Avisale al paciente del cambio.
			</p>
			{#if rescheduleWhatsAppHref}
				<div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
					<a
						href={rescheduleWhatsAppHref}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-400"
					>
						Enviar actualización por WhatsApp
					</a>
					{#if data.reschedulePublicUrl}
						<a
							href={data.reschedulePublicUrl}
							target="_blank"
							rel="noreferrer"
							class="text-sm font-semibold text-emerald-100/80 underline"
						>
							Ver lo que verá el paciente
						</a>
					{/if}
				</div>
			{:else}
				<p class="mt-4 text-sm font-semibold text-amber-100">
					Este paciente no tiene un teléfono válido cargado: avisale del cambio por otro medio.
				</p>
			{/if}
		</div>
	{/if}

	{#if data.appointment}
		<article class="rounded-3xl border border-[#244062] bg-[#071626] p-5 shadow-2xl shadow-black/20 sm:p-7 lg:p-9">
			<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
				<div class="flex items-start gap-5">
					<div class="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-[#7c3aed]/35 text-2xl font-bold uppercase text-white ring-1 ring-[#8b5cf6]/40">
						{(data.appointment.patients?.full_name || data.appointment.service_name_snapshot || '·').trim().charAt(0)}
					</div>
					<div>
						<h1 class="text-3xl font-semibold tracking-tight text-white md:text-4xl">
							{data.appointment.service_name_snapshot}
						</h1>
						<p class="mt-2 text-lg font-semibold text-white/55">
							<span class="text-white/40">{isJoint ? 'Equipo:' : 'Profesional:'}</span>
							{data.appointment.professional_name_snapshot}
						</p>
						{#if isJoint}
							<span class="mt-3 inline-flex rounded-full border border-[#8b5cf6]/30 bg-[#7c3aed]/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[#c4b5fd]">
								Turno conjunto · {appointmentProfessionals.length} profesionales
							</span>
						{/if}
					</div>
				</div>
				<span class={`w-fit rounded-full px-5 py-3 text-sm font-bold ${statusTone[data.appointment.status] ?? 'bg-white/10 text-white'}`}>
					{statusLabels[data.appointment.status] ?? data.appointment.status}
				</span>
			</div>

			<div class="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
					<p class="text-sm font-semibold text-white/55">Paciente</p>
					<p class="mt-2 text-lg font-semibold text-white">{data.appointment.patients?.full_name ?? 'Sin paciente'}</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
					<p class="text-sm font-semibold text-white/55">Fecha</p>
					<p class="mt-2 text-lg font-semibold capitalize text-white">{dateOnly(data.appointment.starts_at)}</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
					<p class="text-sm font-semibold text-white/55">Hora</p>
					<p class="mt-2 text-lg font-semibold text-white">
						{timeOnly(data.appointment.starts_at)} - {timeOnly(data.appointment.ends_at)}
					</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
					<p class="text-sm font-semibold text-white/55">Duración</p>
					<p class="mt-2 text-lg font-semibold text-white">{durationText(data.appointment)}</p>
				</div>
				{#if isJoint}
					<div class="rounded-2xl border border-[#8b5cf6]/25 bg-[#7c3aed]/10 p-5 md:col-span-2 xl:col-span-4">
						<p class="text-sm font-semibold text-[#c4b5fd]">Profesionales reservados</p>
						<div class="mt-3 flex flex-wrap gap-2">
							{#each appointmentProfessionals as professional}
								<span class="rounded-full border border-[#8b5cf6]/30 bg-[#7c3aed]/20 px-3 py-2 text-sm font-semibold text-white">
									{professional.professional_name_snapshot}
								</span>
							{/each}
						</div>
						<p class="mt-3 text-sm leading-relaxed text-white/55">
							Es un único turno y ocupa simultáneamente la agenda de todo el equipo.
						</p>
					</div>
				{/if}
				{#if data.appointment.booking_context}
						<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
							<p class="text-sm font-semibold text-white/55">Modalidad</p>
							<p class="mt-2 text-base font-semibold text-white">{BOOKING_MODALITY_LABELS[data.appointment.booking_context.modality as BookingModality]}</p>
						</div>
				{/if}
				{#if data.appointment.price_quote_snapshot}<div class="ux-soft-card mb-5 p-4"><p class="ux-label">Arancel registrado al reservar</p><p class="mt-2 text-lg font-semibold">{formatQuotedPrice(data.appointment.price_quote_snapshot)}</p></div>{/if}
 {#if data.canEditInstructions}
 <form method="POST" action="?/save_instructions" use:enhance class="ux-soft-card mb-5 space-y-4 p-5">
 <h2 class="ux-section-title">Indicaciones para este turno</h2><input type="hidden" name="updated_at" value={data.appointment.updated_at}/>
 <label class="block"><span class="ux-label">Texto en la página del turno</span><textarea name="instructions" class="ux-textarea mt-2" rows="3" maxlength="2000">{data.appointment.patient_instructions_snapshot??''}</textarea></label>
 <label class="block"><span class="ux-label">Descripción breve del recordatorio</span><textarea name="public_description" class="ux-textarea mt-2" rows="2" maxlength="180">{data.appointment.public_reminder_description_snapshot??''}</textarea><span class="mt-1 block text-sm text-white/75">Puede aparecer en la pantalla bloqueada. No incluyas información clínica ni notas internas.</span></label>
 <button class="ux-btn-secondary">Guardar indicaciones de este turno</button></form>{/if}
 {#if data.appointment.internal_note}
					<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
						<p class="text-sm font-semibold text-white/55">Nota interna</p>
						<p class="mt-2 text-base font-semibold text-white">{data.appointment.internal_note}</p>
					</div>
				{/if}
				{#if data.appointment.cancelled_reason}
					<div class="rounded-2xl border border-red-400/20 bg-red-500/10 p-5">
						<p class="text-sm font-semibold text-red-100/70">Motivo de cancelación</p>
						<p class="mt-2 text-base font-semibold text-white">{data.appointment.cancelled_reason}</p>
					</div>
				{/if}
			</div>
			{#if data.appointment.booking_intake?.length}
				<section class="ux-soft-card mt-5 p-5">
					<h2 class="ux-section-title">Datos informados al reservar</h2>
					<p class="mt-2 text-sm text-white/55">Son respuestas aportadas por el paciente desde su reserva. Se conservan junto al turno y al formulario que completó.</p>
					<dl class="mt-4 grid gap-4 sm:grid-cols-2">
						{#each data.appointment.booking_intake as response}
							<div><dt class="text-sm font-semibold text-white/55">{response.label}</dt><dd class="mt-1 whitespace-pre-wrap break-words">{response.value}</dd></div>
						{/each}
					</dl>
				</section>
			{/if}

			{#if canShowCancelAction}
				<div class="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
					<details class="rounded-2xl border border-red-400/20 bg-red-500/10 md:col-span-2 xl:col-span-3">
						<summary class="cursor-pointer list-none px-5 py-5 text-lg font-bold text-red-100">Cancelar turno</summary>
						<form method="POST" action="?/update_status" class="border-t border-red-400/20 p-5">
							<input type="hidden" name="status" value="cancelled" />
							<label>
								<span class="ux-label">Motivo (opcional)</span>
								<textarea name="reason" rows="2" disabled={!canUseStatusAction('cancelled')} class="ux-textarea"></textarea>
							</label>
							<label class="mt-4 flex items-start gap-3 text-sm font-bold text-red-100">
								<input type="checkbox" required disabled={!canUseStatusAction('cancelled')} class="mt-1 h-4 w-4 accent-red-600 disabled:opacity-60" />
								<span>Confirmo que quiero cancelar este turno.</span>
							</label>
							<button disabled={!canUseStatusAction('cancelled')} class="ux-btn-danger mt-4 w-full">Cancelar turno</button>
						</form>
					</details>
				</div>
			{/if}

			<div class="mt-7 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5 lg:grid-cols-3">
				<div>
					<p class="text-sm font-semibold text-white/45">Teléfono</p>
					<p class="mt-1 text-base font-semibold text-white">{data.appointment.patients?.phone_e164 ?? 'Sin teléfono'}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-white/45">Correo</p>
					<p class="mt-1 text-base font-semibold text-white">{data.appointment.patients?.email ?? 'Sin correo electrónico'}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-white/45">Origen</p>
					<p class="mt-1 text-base font-semibold text-white">{sourceLabels[data.appointment.source] ?? data.appointment.source}</p>
				</div>
			</div>
		</article>

		<details bind:open={reprogramOpen} id="reprogramar" class="group rounded-3xl border border-[#244062] bg-[#071626] shadow-xl shadow-black/10">
			<summary class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-lg font-semibold text-white sm:px-7">
				<span>Reprogramar</span>
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-4 w-4 shrink-0 text-white/35 transition-transform duration-200 group-open:rotate-180">
					<path d="m6.5 8 3.5 3.5L13.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</summary>
			<div class="border-t border-white/10 px-5 py-6 sm:px-7">
				<div>
					<div class="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
						<h2 class="text-lg font-semibold text-white">Reprogramar</h2>
						{#if !canOperate || isClosed}
							<p class="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
								{isClosed
									? 'Este turno está cerrado, no se puede reprogramar.'
									: 'No tenés permiso para reprogramar este turno.'}
							</p>
						{:else}
							{#if isJoint}
								<div class="mt-4 rounded-2xl border border-[#8b5cf6]/25 bg-[#7c3aed]/10 p-4">
									<p class="text-sm font-bold text-[#c4b5fd]">
										Se recalculará la disponibilidad de todo el equipo
									</p>
									<p class="mt-1 text-sm leading-relaxed text-white/60">
										Sólo verás horarios en los que los {appointmentProfessionals.length} profesionales estén libres. Si uno no puede, el turno completo conserva su horario actual.
									</p>
								</div>
							{/if}

							<label class="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-400/[0.07] p-4">
								<input
									type="checkbox"
									checked={ignoreBreak}
									onchange={updateIgnoreBreak}
									class="mt-1 h-5 w-5 shrink-0 accent-amber-400"
								/>
								<span>
									<span class="block text-sm font-bold text-amber-100">Ignorar descanso en la nueva fecha</span>
									<span class="mt-1 block text-sm leading-relaxed text-amber-100/70">
										Usalo sólo después de confirmar que puede comenzarse inmediatamente. Nunca permite superponer dos atenciones reales.
									</span>
								</span>
							</label>

							<div class="mt-4 rounded-2xl border border-white/10 bg-[#0a1b2e] p-4">
								<div class="flex items-center justify-between">
									<button type="button" onclick={prevMonth} disabled={!canGoPrev} aria-label="Mes anterior" class="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-lg text-white/80 transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent">‹</button>
									<span class="text-sm font-semibold capitalize text-white">{monthLabel}</span>
									<button type="button" onclick={nextMonth} aria-label="Mes siguiente" class="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-lg text-white/80 transition hover:bg-white/10">›</button>
								</div>
								<div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-white/35">
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
												class={`grid h-10 place-items-center rounded-xl text-sm font-semibold transition ${
													isSelected(cell.iso)
														? 'bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30'
														: isPast(cell.iso)
															? 'cursor-not-allowed text-white/20'
															: 'text-white/80 hover:bg-white/10'
												} ${isToday(cell.iso) && !isSelected(cell.iso) ? 'ring-1 ring-[#8b5cf6]/60' : ''}`}
											>
												{cell.day}
											</button>
										{/if}
									{/each}
								</div>
							</div>

							<div class="mt-4">
								<div class="flex items-center justify-between gap-2">
									<span class="text-sm font-semibold text-white/65">
										Horarios · <span class="capitalize text-white">{selectedDayLabel}</span>
									</span>
									{#if loadingSlots}
										<span class="text-xs font-semibold text-[#a78bfa]">Buscando…</span>
									{/if}
								</div>

								{#if slotsError}
									<p class="mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-100">{slotsError}</p>
								{:else if loadingSlots && currentSlots.length === 0}
									<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
										{#each Array(8) as _}
											<div class="h-10 animate-pulse rounded-xl bg-white/5"></div>
										{/each}
									</div>
								{:else if currentSlots.length === 0}
									<p class="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/55">
										No hay horarios disponibles ese día. Probá con otra fecha.
									</p>
								{:else}
									<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
										{#each currentSlots as slot}
											<button
												type="button"
												onclick={() => (selectedSlot = slot.starts_at)}
												class={`rounded-xl border px-2 py-2.5 text-sm font-semibold tabular-nums transition ${
													selectedSlot === slot.starts_at
														? 'border-[#7c3aed] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30'
														: 'border-white/10 bg-white/[0.04] text-white/85 hover:border-[#8b5cf6]/60 hover:bg-white/10'
												}`}
											>
												{slot.time}
											</button>
										{/each}
									</div>
								{/if}
							</div>

							<form method="POST" action="?/reschedule" class="mt-5" use:enhance={onReschedule}>
								<input type="hidden" name="slot_starts_at" value={selectedSlot} />
								<input type="hidden" name="reprogram_date" value={selectedDate} />
								<input type="hidden" name="ignore_break" value={ignoreBreak ? 'true' : 'false'} />
								<button
									type="submit"
									disabled={!selectedSlot || submitting}
									class="w-full rounded-2xl bg-[#7c3aed] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-40"
								>
									{submitting
										? 'Reprogramando…'
										: selectedSlot
											? `Reprogramar a las ${selectedSlotTime}`
											: 'Elegí un horario'}
								</button>
							</form>
						{/if}
					</div>
				</div>

			</div>
		</details>

		<details class="group rounded-3xl border border-[#244062] bg-[#071626] shadow-xl shadow-black/10">
			<summary class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-lg font-semibold text-white sm:px-7">
				<span>Historial</span>
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-4 w-4 shrink-0 text-white/35 transition-transform duration-200 group-open:rotate-180">
					<path d="m6.5 8 3.5 3.5L13.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</summary>
			<div class="border-t border-white/10 px-5 py-6 sm:px-7">
				<div class="grid gap-3">
					{#each data.auditLogs as log}
						<div class="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4 text-sm">
							<p class="font-semibold text-white">{auditLabel(log)}</p>
							<p class="mt-1 text-xs font-semibold text-white/45">{formatDateTime(log.created_at)}</p>
							{#if auditDetail(log)}
								<p class="mt-2 text-white/70">{auditDetail(log)}</p>
							{/if}
						</div>
					{/each}
					{#if data.auditLogs.length === 0}
						<p class="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4 text-sm text-white/60">
							Todavía no hay movimientos registrados.
						</p>
					{/if}
				</div>
			</div>
		</details>
	{/if}
</section>
