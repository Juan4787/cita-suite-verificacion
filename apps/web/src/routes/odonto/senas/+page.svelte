<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { page } from '$app/state';
	import { classifyUserAgent, refineDeviceClass, whatsappHrefFor, type DeviceClass } from '$lib/device';
	import { formatElapsed } from '$lib/scheduling/deposits';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data, form }: {
		data: PageData;
		form?: { success?: boolean; message?: string; appointmentId?: string };
	} = $props();

	type Row = PageData['sections'][number]['rows'][number];

	let whatsappDevice = $state<DeviceClass | null>(null);
	onMount(() => {
		whatsappDevice = refineDeviceClass(classifyUserAgent(navigator.userAgent), navigator);
	});
	const now = new Date();

	const openHref = (row: Row, confirm = false) => {
		const params = new URLSearchParams();
		if (confirm) params.set('confirmar', '1');
		// Without JavaScript the server classifies the browser; with it, the refined class is sent so
		// that an iPad announcing itself as a Mac is not taken for a computer.
		if (whatsappDevice) params.set('dispositivo', whatsappDevice);
		const query = params.toString();
		return `/odonto/senas/abrir/${row.appointmentId}${query ? `?${query}` : ''}`;
	};

	// Why the list came back instead of WhatsApp (abrir/[appointmentId]).
	const OPEN_NOTICES: Record<string, string> = {
		ya_abierto: 'Ya se abrió el WhatsApp para pedir esa seña. Si querés mandarlo otra vez, tocá «Abrir de todos modos».',
		no_pendiente: 'Esa seña ya no está pendiente: otra persona la registró o la exceptuó, o el turno se canceló. La lista ya está actualizada.',
		sin_telefono: 'Esa persona no tiene un teléfono válido para WhatsApp. Corregilo en su ficha.',
		no_encontrado: 'No encontramos ese turno en este consultorio.',
		error: 'No pudimos abrir el pedido por WhatsApp y no se registró nada. Probá otra vez.'
	};
	const openNotice = $derived(OPEN_NOTICES[page.url.searchParams.get('aviso') ?? ''] ?? null);
	const totalRows = $derived(data.sections.reduce((count, section) => count + section.rows.length, 0));
</script>

{#snippet depositActions(row: Row)}
	<div class="flex shrink-0 flex-col gap-2 sm:items-end">
		{#if !row.hasPhone}
			<span class="ux-badge ux-badge-warning">Revisar teléfono</span>
			<p class="max-w-60 text-xs leading-relaxed text-white/50 sm:text-right">
				Falta un número argentino completo con código de área.
			</p>
			<a href={`/odonto/pacientes/${row.patientId}`} class="ux-btn-secondary">Corregir número</a>
		{:else if row.reminder}
			<p class="max-w-60 text-xs text-white/45 sm:text-right">Ya se pidió por WhatsApp. ¿Abrirlo otra vez?</p>
			<a href={openHref(row, true)} target="_blank" rel="noreferrer" class="ux-btn-secondary">Abrir de todos modos</a>
		{:else}
			<a href={openHref(row)} target="_blank" rel="noreferrer" class="ux-btn-primary">Pedir seña por WhatsApp</a>
		{/if}
		<form method="POST" action="?/deposit">
			<input type="hidden" name="appointment_id" value={row.appointmentId} />
			<input type="hidden" name="deposit_action" value="paid" />
			<input type="hidden" name="expected_revision" value={row.revision} />
			<button class="ux-btn-primary w-full" disabled={data.demo}>Confirmar seña</button>
		</form>
		<details class="w-full sm:w-auto">
			<summary class="ux-btn-secondary cursor-pointer list-none">Exceptuar</summary>
			<form method="POST" action="?/deposit" class="mt-2 flex flex-col gap-2 sm:items-end">
				<p class="max-w-60 text-xs text-white/55 sm:text-right">
					El turno queda Confirmado sin seña. Queda registrado como decisión del consultorio.
				</p>
				<input type="hidden" name="appointment_id" value={row.appointmentId} />
				<input type="hidden" name="deposit_action" value="waived" />
				<input type="hidden" name="expected_revision" value={row.revision} />
				<button class="ux-btn-secondary w-full" disabled={data.demo}>Sí, exceptuar la seña</button>
			</form>
		</details>
		<a href={`/odonto/turnos/${row.appointmentId}`} class="ux-btn-secondary">Ver turno</a>
	</div>
{/snippet}

{#snippet cancelledActions(row: Row)}
	<div class="flex shrink-0 flex-col gap-2 sm:items-end">
		{#if row.cancellation?.notice}
			<a
				href={whatsappHrefFor(whatsappDevice ?? 'unknown', row.cancellation.notice.whatsappUrl, row.cancellation.notice.whatsappWebUrl)}
				target="_blank"
				rel="noreferrer"
				class="ux-btn-primary">Avisar a la persona</a
			>
		{:else}
			<span class="ux-badge ux-badge-warning">Revisar teléfono</span>
			<a href={`/odonto/pacientes/${row.patientId}`} class="ux-btn-secondary">Corregir número</a>
		{/if}
		{#if row.cancellation}
			<a href={row.cancellation.rebookHref} class="ux-btn-secondary">Volver a dar este horario</a>
		{/if}
	</div>
{/snippet}

{#snippet depositRow(row: Row)}
	<div class="ux-soft-card p-5" data-deposit-row={row.appointmentId}>
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div class="min-w-0">
				<p class="break-words text-lg font-bold text-white">{row.patientName}</p>
				<p class="mt-1 text-sm text-white/65">Turno: {row.turnLabel}</p>
				{#if row.section === 'cancelled'}
					<p class="mt-2 text-sm font-bold text-amber-300">
						Se canceló porque no se registró la seña de {row.amountLabel} antes del {row.dueLabel}.
					</p>
				{:else}
					<p class="mt-2 text-sm font-bold text-white">Seña de {row.amountLabel}, vence el {row.dueLabel}</p>
					{#if row.appointmentStatus === 'reschedule_requested'}
						<p class="mt-1 text-sm text-amber-300">Pidió reprogramar: resolver a mano.</p>
					{/if}
				{/if}
				{#if row.reminder}
					<p class="mt-2 text-sm text-white/55">
						WhatsApp abierto {formatElapsed(row.reminder.openedAt, now)} por {row.reminder.openedBy}
					</p>
				{/if}
				{#if form?.message && form.appointmentId === row.appointmentId}
					<p class={form.success ? 'ux-alert ux-alert-success mt-3' : 'ux-alert mt-3'} role="status">{form.message}</p>
				{/if}
			</div>
			{#if row.section === 'cancelled'}
				{@render cancelledActions(row)}
			{:else}
				{@render depositActions(row)}
			{/if}
		</div>
	</div>
{/snippet}

<section class="ux-page">
	<div class="ux-hero">
		<h1 class="ux-title">Señas</h1>
		<p class="ux-subtitle">
			Las señas para pedir y las que vencen, con el mensaje de WhatsApp ya escrito. «Confirmar seña» deja
			el turno Confirmado.
		</p>
	</div>

	{#if openNotice}
		<p class="ux-alert" role="status">{openNotice}</p>
	{/if}
	{#if form?.message && !form.appointmentId}
		<p class="ux-alert" role="status">{form.message}</p>
	{/if}

	{#if data.restricted}
		<div class="ux-card">
			<p class="ux-empty">
				El acceso comercial del consultorio está restringido: las señas no se pueden registrar ni pedir.
			</p>
		</div>
	{:else}
		{#if data.automation}
			<p
				class={data.automation.tone === 'warning'
					? 'ux-alert'
					: data.automation.tone === 'ok'
						? 'flex items-center gap-2 text-sm font-bold text-emerald-300'
						: 'ux-soft-card p-4 text-sm text-white/70'}
				role={data.automation.tone === 'warning' ? 'alert' : undefined}
			>
				{#if data.automation.tone === 'ok'}<Icon name="check" class="h-4 w-4 shrink-0" />{/if}{data.automation.text}
			</p>
		{/if}

		{#if !data.policyEnabled}
			<div class="ux-card">
				<p class="ux-empty">
					El consultorio no pide señas en este momento: las reservas nuevas no generan ninguna.
					{#if data.canConfigure}<a href="/odonto/configuracion/senas" class="underline">Configurar las señas</a>{/if}
				</p>
			</div>
		{/if}

		{#if data.truncated}
			<p class="ux-alert" role="alert">
				Hay más señas de las que entran en esta lista: las que vencen más tarde pueden faltar. Resolvé
				las de arriba y recargá la página.
			</p>
		{/if}

		{#if totalRows === 0}
			<div class="ux-card">
				<p class="ux-empty">No hay señas para pedir ni turnos cancelados por la seña en los últimos 7 días.</p>
			</div>
		{/if}

		{#each data.sections as section (section.id)}
			{#if section.rows.length > 0}
				{#if section.folded}
					<details class="ux-card">
						<summary class="ux-section-title cursor-pointer">{section.title} ({section.rows.length})</summary>
						<div class="mt-5 grid gap-3">
							{#each section.rows as row (row.appointmentId)}
								{@render depositRow(row)}
							{/each}
						</div>
					</details>
				{:else}
					<div class="ux-card">
						<h2 class="ux-section-title">{section.title} ({section.rows.length})</h2>
						<div class="mt-5 grid gap-3">
							{#each section.rows as row (row.appointmentId)}
								{@render depositRow(row)}
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		{/each}
	{/if}

	{#if data.demo}
		<p class="ux-empty">Modo demo: los botones no abren WhatsApp real ni registran señas.</p>
	{/if}
</section>
