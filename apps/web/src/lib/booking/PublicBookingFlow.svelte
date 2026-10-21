<script lang="ts">
	import { formatDuration, formatStepCounter } from '$lib/utils/format';
	import PublicBookingConfirmation from './PublicBookingConfirmation.svelte';
 import PublicBookingProfessionals from './PublicBookingProfessionals.svelte';
 import PublicBookingDates from './PublicBookingDates.svelte';
 import type { BookingViewData, BookingFormState, BookingService as Service, BookingProfessional as Professional, BookingSlot as Slot, BookingDay as Day, BookingQuery } from '$lib/scheduling/booking-view';
	import "./patient-booking.css";
 import { formatQuotedPrice } from './pricing';
	import BookingAppearance from '$lib/booking/BookingAppearance.svelte';
	import BookingFrameBridge from '$lib/booking/BookingFrameBridge.svelte';
	import { BOOKING_MODALITY_LABELS, type BookingModality } from '@cita-suite/shared/booking-integration';
	import { afterNavigate } from '$app/navigation';
	import { navigating, page } from '$app/state';


	let { data, form }: { data: BookingViewData; form?: BookingFormState | null } = $props();

	const business = $derived(data.state.business);
	const timezone = $derived(business?.timezone ?? 'America/Argentina/Cordoba');

	const bookingPath = $derived(page.url.pathname);
	const navigationURL = $derived(navigating.to?.url.pathname === page.url.pathname ? navigating.to.url : page.url);
	const modality = $derived(data.presentation?.modalities.find((option: BookingModality) => option === navigationURL.searchParams.get('modality')) ?? data.presentation?.modalities[0] ?? 'in_person');
	const modalityLabel = (value: BookingModality) => BOOKING_MODALITY_LABELS[value];

	// ------------------------------------------------------------------
	// Selección efectiva. El `slot` vive SOLO en la URL (el load del server
	// no lo lee, así elegir horario no re-ejecuta el load: es instantáneo).
	// Durante una navegación pendiente se usa la URL destino: los pasos ya
	// resueltos colapsan al instante y el paso nuevo muestra skeleton.
	// ------------------------------------------------------------------
	const selectionFrom = (params: URLSearchParams) => {
		const professionalIds = [
			...new Set(
				params
					.getAll('professional_ids')
					.flatMap((value) => value.split(','))
					.map((value) => value.trim())
					.filter(Boolean)
			)
		];
		const bookingMode =
			params.get('booking_mode') === 'joint' || professionalIds.length > 1
				? ('joint' as const)
				: ('individual' as const);
		return {
			serviceId: params.get('service_id') ?? '',
			bookingMode,
			professionalId: bookingMode === 'individual' ? (params.get('professional_id') ?? '') : '',
			professionalIds: bookingMode === 'joint' ? professionalIds : [],
			date: params.get('date') ?? '',
			datesFrom: params.get('dates_from') ?? '',
			slot: params.get('slot') ?? ''
		};
	};
	const pendingSelection = $derived.by(() => {
		const to = navigating.to;
		if (!to || to.url.pathname !== page.url.pathname) return null;
		return selectionFrom(to.url.searchParams);
	});
	const selection = $derived(pendingSelection ?? selectionFrom(page.url.searchParams));

	// Una lista queda "stale" si la selección de la que depende cambió y el load
	// nuevo todavía está en vuelo: ahí va skeleton en lugar de datos viejos.
	const professionalsStale = $derived(
		Boolean(pendingSelection) && selection.serviceId !== data.selected.serviceId
	);
	const daysStale = $derived(
		professionalsStale ||
			(Boolean(pendingSelection) &&
				(selection.bookingMode !== data.selected.bookingMode ||
					selection.professionalId !== data.selected.professionalId ||
					selection.professionalIds.join(',') !== data.selected.professionalIds.join(',') ||
					selection.datesFrom !== (data.selected.datesFrom ?? '')))
	);
	const slotsStale = $derived(
		daysStale || (Boolean(pendingSelection) && selection.date !== data.selected.date)
	);

	const selectedService = $derived(
		data.state.services.find((service: Service) => service.id === selection.serviceId) ?? null
	);
	const selectedProfessional = $derived(
		data.state.professionals.find((professional: Professional) => professional.id === selection.professionalId) ?? null
	);
	const selectedProfessionals = $derived(
		selection.professionalIds
			.map((professionalId: string) =>
				data.state.professionals.find((professional: Professional) => professional.id === professionalId)
			)
			.filter((professional: Professional | undefined): professional is Professional => Boolean(professional))
	);
	const professionalSelectionComplete = $derived(
		selection.bookingMode === 'joint'
			? selection.professionalIds.length >= 2 &&
					selectedProfessionals.length === selection.professionalIds.length
			: Boolean(selectedProfessional)
	);
	const selectedDay = $derived(data.state.days.find((day: Day) => day.date === selection.date) ?? null);
	const selectedSlot = $derived(
		data.state.slots.find((slot: Slot) => slot.starts_at === selection.slot) ?? null
	);

	const currentPriceQuote = $derived(
		!slotsStale && data.priceQuote?.date === selection.date ? data.priceQuote : null
	);

	const step = $derived(
		!selectedService ? 1 : !professionalSelectionComplete ? 2 : !selection.date ? 3 : !selectedSlot ? 4 : 5
	);
	const compact = $derived(data.presentation?.compact === true && selection.bookingMode === 'individual');
	const displayStep = $derived(compact ? step <= 2 ? 1 : step <= 4 ? 2 : 3 : step);
	const displayStepCount = $derived(compact ? 4 : 5);
	const stepNames = $derived([
		'Servicio',
		selection.bookingMode === 'joint' ? 'Equipo' : 'Profesional',
		'Día',
		'Horario',
		'Tus datos'
	]);

	const queryFor = (params: BookingQuery) => {
		const search = new URLSearchParams();
		if (data.integration) {
			search.set('request_id', data.bookingRequestId);
			search.set('modality', modality);
			if (data.embed) {
				search.set('parent_origin', data.embed.parentOrigin);
				search.set('instance_id', data.embed.instanceId);
			}
		}
		const serviceId = params.service_id ?? selection.serviceId;
		const bookingMode = params.booking_mode ?? selection.bookingMode;
		const professionalId = params.professional_id ?? selection.professionalId;
		const professionalIds = params.professional_ids ?? selection.professionalIds.join(',');
		const date = params.date ?? selection.date;
		const slot = params.slot ?? selection.slot;
		if (serviceId) search.set('service_id', serviceId);
		if (bookingMode === 'joint') {
			search.set('booking_mode', 'joint');
			if (professionalIds) search.set('professional_ids', professionalIds);
		} else if (professionalId) {
			search.set('professional_id', professionalId);
		}
		const resetsDates = ['service_id', 'booking_mode', 'professional_id', 'professional_ids'].some(key => key in params);
		const datesFrom = params.dates_from ?? (resetsDates ? '' : selection.datesFrom);
		if (datesFrom) search.set('dates_from', datesFrom);
		if (date) search.set('date', date);
		if (slot) search.set('slot', slot);
		const value = search.toString();
		return `${bookingPath}${value ? `?${value}` : ''}`;
	};
	const fatalIssue = $derived(
		data.state.issue && data.state.issue !== 'no_availability' ? data.state.issue : null
	);

	const issueMessages: Record<string, string> = {
		integration_unavailable: 'La reserva desde este sitio todavía no está habilitada. Contactá al consultorio para pedir tu turno.',
		business_not_found: 'El enlace de reserva no está disponible.',
		booking_disabled: 'La reserva online no está disponible en este momento.',
		commercial_unavailable: 'La reserva online no está disponible en este momento. Contactá al consultorio.',
		missing_service_role:
			'La reserva online no está disponible en este momento. Reintentá en unos segundos o comunicate con el consultorio.',
		no_services: 'No hay servicios disponibles para reservar online en este momento.',
		no_professionals: 'No hay profesionales con horarios disponibles para ese servicio.',
		no_availability: 'No hay horarios disponibles para los próximos días.'
	};
	let localDraft = $state<Record<string, unknown>>({});
	let uncertainBooking = $state(false);
	let uncertainRecoveryId = $state('');
	const requiresRecovery = $derived(uncertainBooking || form?.uncertain === true);
	$effect(() => {
		if (uncertainBooking && data.recoveryCheckId && data.recoveryCheckId !== uncertainRecoveryId) uncertainBooking = false;
	});

	// Horarios agrupados como los piensa el paciente: mañana / tarde.
	const morningSlots = $derived(data.state.slots.filter((slot: Slot) => slot.time < '13:00'));
	const afternoonSlots = $derived(data.state.slots.filter((slot: Slot) => slot.time >= '13:00'));

	let visibleDayCount = $state(6);
	const dateWindow = $derived(data.state.dateWindow);

	$effect(() => {
		void dateWindow?.fromDate;
		visibleDayCount = 6;
	});
	let teamDraftIds = $state<string[]>([]);
	let teamDraftContext = $state('');
	$effect(() => {
		const nextContext = `${selection.serviceId}:${selection.bookingMode}:${selection.professionalIds.join(',')}`;
		if (teamDraftContext !== nextContext) {
			teamDraftContext = nextContext;
			teamDraftIds = [...selection.professionalIds];
		}
	});

	const professionalSelectionLabel = $derived(
		selection.bookingMode === 'joint'
			? selectedProfessionals.map((professional: Professional) => professional.name).join(', ')
			: (selectedProfessional?.name ?? '')
	);


	// Solo hay UNA card de paso activa a la vez: los pasos resueltos colapsan.
	let activeStepCard = $state<HTMLElement | null>(null);
	afterNavigate(({ from, to }) => {
		if (!from || !to || from.url.pathname !== to.url.pathname) return;
		if (from.url.search === to.url.search) return;
		requestAnimationFrame(() => activeStepCard?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	});
</script>

{#snippet doneStep(label: string, value: string, changeHref: string)}
	<div class="ux-soft-card flex items-center justify-between gap-3 px-4 py-3">
		<div class="min-w-0">
			<p class="text-micro font-bold uppercase tracking-wider text-white/40">{label}</p>
			<p class="break-words text-base font-bold text-white">{value}</p>
		</div>
		<a data-sveltekit-noscroll href={changeHref} class="shrink-0 text-sm font-bold text-[#a78bfa] hover:underline">
			Cambiar
		</a>
	</div>
{/snippet}

{#snippet stepSkeleton(title: string, hint: string)}
	<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
		<h2 class="ux-section-title">{title}</h2>
		<div class="mt-5 grid gap-3 sm:grid-cols-2" aria-hidden="true">
			{#each [0, 1, 2, 3] as placeholder (placeholder)}
				<div class="skeleton-shimmer relative h-16 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.05]"></div>
			{/each}
		</div>
		<p class="mt-4 text-sm text-white/45" role="status">{hint}</p>
	</section>
{/snippet}

<svelte:head>
	<title>{business?.name ? `Reservar turno · ${business.name}` : 'Reserva online'}</title>
	{#if data.turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<BookingAppearance theme={data.presentation?.theme ?? 'cita-suite'}>
{#if data.embed}<BookingFrameBridge context={data.embed} requestId={data.bookingRequestId} />{/if}
<main class="min-h-screen bg-[#06111f] px-4 py-5 text-white sm:py-8">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
		<header class="ux-hero">
			<div class="flex items-start gap-4">
				{#if business?.logo_url}
					<img src={business.logo_url} alt={business.name} class="h-16 w-16 shrink-0 rounded-2xl object-cover" />
				{:else}
					<div class="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#7c3aed] text-lg font-bold text-white">
						{business?.name?.slice(0, 2).toUpperCase() ?? 'RS'}
					</div>
				{/if}
				<div class="min-w-0">
					<h1 class="text-2xl font-bold text-white sm:text-3xl">{business?.name ?? 'Reserva online'}</h1>
					{#if (modality !== 'video' && business?.address) || business?.phone}
						<p class="mt-2 text-sm text-white/55">
							{modality !== 'video' ? business.address ?? '' : ''}{modality !== 'video' && business.address && business.phone ? ' · ' : ''}{business.phone ?? ''}
							{#if modality !== 'video' && data.mapsLink && business.address}
								· <a href={data.mapsLink} target="_blank" rel="noreferrer" class="font-bold text-white/80 underline">Cómo llegar</a>
							{/if}
						</p>
					{/if}
				</div>
			</div>
		</header>

		{#if fatalIssue}
			<section class="ux-card">
				<p class="text-lg font-bold text-white">{issueMessages[fatalIssue] ?? 'No se pudo cargar la reserva online.'}</p>
				{#if business?.phone}
					<p class="mt-2 text-sm text-white/55">Contactá al consultorio: {business.phone}</p>
				{/if}
				<a href={data.integration ? queryFor({ service_id: '', professional_id: '', professional_ids: '', booking_mode: 'individual', date: '', slot: '' }) : bookingPath} class="ux-btn-secondary mt-5 inline-flex">Volver a empezar</a>
			</section>
		{:else}
			{#if requiresRecovery}
				<div class="ux-alert" role="alert">
					<p>No pudimos comprobar si el turno quedó guardado. Revisá el resultado antes de confirmar otra vez.</p>
					<a class="ux-btn-secondary mt-3 inline-flex" href={queryFor({}) + '&recover=1'}>Revisar resultado de la reserva</a>
				</div>
			{/if}
			<section class="ux-card py-4">
				<div class="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
					<p class="min-w-0 text-sm font-bold text-white/70">{formatStepCounter(displayStep, displayStepCount)} ·&nbsp;{compact ? ['Servicio', 'Día y horario', 'Tus datos'][displayStep - 1] : stepNames[step - 1]}</p>
					{#if step > 1}
						<a data-sveltekit-noscroll href={data.integration ? queryFor({ service_id: '', professional_id: '', professional_ids: '', booking_mode: 'individual', date: '', slot: '' }) : bookingPath} class="text-xs font-bold text-white/45 hover:text-white/70">
							Empezar de nuevo
						</a>
					{/if}
				</div>
				<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
					<div class="h-full rounded-full bg-[#7c3aed] transition-all duration-300" style={`width:${(displayStep / displayStepCount) * 100}%`}></div>
				</div>
			</section>

			<!-- Paso 1 · Servicio -->
			{#if step === 1}
				<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
					<h2 class="ux-section-title">¿Qué necesitás?</h2>
                    {#if data.presentation}
                        <fieldset class="mt-5">
                            <legend class="ux-label">Modalidad de atención</legend>
                            <div class="mt-2 flex flex-wrap gap-2">
                                {#each data.presentation.modalities as option}
                                    <a href={(() => { const target = new URL(queryFor({ service_id: '', professional_id: '', professional_ids: '', date: '', slot: '' }), page.url); target.searchParams.set('modality', option); return target.pathname + target.search; })()} class={option === modality ? 'ux-btn-primary' : 'ux-btn-secondary'} aria-current={option === modality ? 'true' : undefined}>{modalityLabel(option)}</a>
                                {/each}
                            </div>
                        </fieldset>
                    {/if}
					<div class="mt-5 grid gap-3 sm:grid-cols-2">
						{#each data.state.services as service (service.id)}
							<a
								data-sveltekit-noscroll
								data-sveltekit-preload-data="hover"
								href={queryFor({
									service_id: service.id,
									booking_mode: 'individual',
									professional_id: '',
									professional_ids: '',
									date: '',
									slot: ''
								})}
								class="ux-choice p-5"
							>
								<p class="text-lg font-bold text-white">{service.name}</p>
								{#if service.description}
									<p class="mt-1 text-sm text-white/55">{service.description}</p>
								{/if}
								<p class="mt-2 text-sm font-semibold text-white/55">
									{formatDuration(service.duration_minutes)}{service.price_label ? ` ·\u00a0${service.price_label}` : ''}
								</p>
							</a>
						{/each}
					</div>
				</section>
			{:else if selectedService}
				{@render doneStep(
					'Servicio',
					`${selectedService.name} ·\u00a0${formatDuration(selectedService.duration_minutes)}`,
					queryFor({
						service_id: '',
						booking_mode: 'individual',
						professional_id: '',
						professional_ids: '',
						date: '',
						slot: ''
					})
				)}
			{/if}

			<!-- Paso 2 · Profesional -->
			{#if step === 2}
				{#if professionalsStale || compact}
					{@render stepSkeleton(compact ? 'Elegí un día' : '¿Con quién?', compact ? 'Buscando días con horarios libres…' : 'Cargando los profesionales que realizan este procedimiento…')}
				{:else}
                    <PublicBookingProfessionals professionals={data.state.professionals} {selection} {queryFor}
                        bind:teamDraftIds bind:activeStepCard />
				{/if}
			{:else if step > 2 && professionalSelectionComplete && !compact}
				{@render doneStep(
					selection.bookingMode === 'joint' ? 'Equipo' : 'Profesional',
					professionalSelectionLabel,
					queryFor({
						booking_mode: selection.bookingMode,
						professional_id: '',
						professional_ids: '',
						date: '',
						slot: ''
					})
				)}
			{/if}

			<!-- Paso 3 · Día -->
			{#if step === 3}
				{#if daysStale}
					{@render stepSkeleton('Elegí un día', 'Buscando días con horarios libres…')}
				{:else}
                    <PublicBookingDates days={data.state.days} {dateWindow} {selection} {compact} {queryFor}
                        bind:visibleDayCount bind:activeStepCard />
				{/if}
			{:else if step > 3}
				{@render doneStep('Día', selectedDay?.label ?? selection.date, queryFor({ date: '', slot: '' }))}
			{/if}

            {#if step === 4 && !slotsStale && data.priceQuote && data.priceQuote.date === selection.date}
                <section class="ux-card" aria-live="polite" aria-atomic="true">
                    <h2 class="ux-section-title">Arancel para la fecha elegida</h2>
                    <p class="mt-3 text-xl font-bold tabular-nums">{formatQuotedPrice(data.priceQuote)}</p>
                    {#if data.priceQuote.adjusted}<p class="mt-2 text-sm text-white/75">Este importe incluye los ajustes mensuales configurados por el consultorio para tu fecha. Podés cambiar el día antes de confirmar.</p>{/if}
                </section>
            {/if}

			<!-- Paso 4 · Horario -->
			{#if step === 4}
				{#if slotsStale}
					{@render stepSkeleton('Elegí un horario', 'Buscando horarios libres…')}
				{:else}
					<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
						<h2 class="ux-section-title">Elegí un horario</h2>
						{#if morningSlots.length > 0}
							<p class="mt-5 text-micro font-bold uppercase tracking-wider text-white/40">Mañana</p>
							<div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
								{#each morningSlots as slot (slot.starts_at)}
									<a
										data-sveltekit-noscroll
										href={queryFor({ slot: slot.starts_at })}
										class="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center text-sm font-bold text-white transition hover:border-[#8b5cf6]/70 hover:bg-white/[0.08]"
									>
										{slot.time}
									</a>
								{/each}
							</div>
						{/if}
						{#if afternoonSlots.length > 0}
							<p class="mt-5 text-micro font-bold uppercase tracking-wider text-white/40">Tarde</p>
							<div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
								{#each afternoonSlots as slot (slot.starts_at)}
									<a
										data-sveltekit-noscroll
										href={queryFor({ slot: slot.starts_at })}
										class="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center text-sm font-bold text-white transition hover:border-[#8b5cf6]/70 hover:bg-white/[0.08]"
									>
										{slot.time}
									</a>
								{/each}
							</div>
						{/if}
						{#if data.state.slots.length === 0}
							<p class="ux-empty mt-4">No hay horarios para ese día. Probá con otro día.</p>
						{/if}
					</section>
				{/if}
			{:else if step > 4 && selectedSlot}
				{@render doneStep('Horario', `${selectedDay?.label ?? ''} ·\u00a0${selectedSlot.time}\u00a0h`, queryFor({ slot: '' }))}
			{/if}

			<!-- Paso 5 · Datos del paciente -->
			{#if step === 5 && selectedService && professionalSelectionComplete && selectedSlot}
                <PublicBookingConfirmation {data} {form} {requiresRecovery}
                    confirmation={{ service: selectedService, slot: selectedSlot, selection,
                        professionalLabel: professionalSelectionLabel,
                        professionalId: selectedProfessional?.id ?? selection.professionalIds[0] ?? '',
                        priceQuote: currentPriceQuote, timezone, modality,
                        action: data.integration ? queryFor({}) + '&/create_booking' : '?/create_booking' }}
                    bind:localDraft bind:activeStepCard
                    onUncertain={() => { uncertainRecoveryId = data.recoveryCheckId ?? ''; uncertainBooking = true; }} />
			{/if}

			{#if data.demo}
				<p class="ux-empty">Modo demo: la reserva no crea turnos reales.</p>
			{/if}
		{/if}
	</div>
</main>
</BookingAppearance>
