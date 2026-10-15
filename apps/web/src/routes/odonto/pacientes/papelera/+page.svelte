<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { formatClinicalFileBytes } from '$lib/client/clinical-files';
	import { formatDate, formatDateTime } from '$lib/utils/format';

	type TrashItem = {
		id: string;
		patient_id: string;
		patient_name: string;
		original_filename?: string | null;
		mime_type?: string | null;
		bytes?: number | null;
		taken_at?: string | null;
		created_at?: string | null;
		deleted_at: string;
		deleted_by_label?: string | null;
		integrity_status?: string | null;
		thumbnail_url?: string | null;
	};

	let { data } = $props<{ data: { demo: boolean; canRestore: boolean } }>();
	let items = $state<TrashItem[]>([]);
	let query = $state('');
	let loading = $state(false);
	let loadingMore = $state(false);
	let errorMessage = $state('');
	let message = $state('');
	let hasMore = $state(false);
	let nextCursor = $state<string | null>(null);
	let initialized = $state(false);
	let requestSequence = 0;
	let restoreTarget = $state<TrashItem | null>(null);
	let restoreBusy = $state(false);
	let brokenThumbnails = $state<Record<string, boolean>>({});
	let activeController: AbortController | null = null;

	const fetchItems = async ({ append = false }: { append?: boolean } = {}) => {
		if (data.demo) return;
		if (append && (loadingMore || loading || !nextCursor)) return;
		if (!append) {
			activeController?.abort();
			activeController = new AbortController();
			loadingMore = false;
		}
		const sequence = ++requestSequence;
		append ? (loadingMore = true) : (loading = true);
		errorMessage = '';
		try {
			const params = new URLSearchParams();
			if (query.trim()) params.set('q', query.trim());
			if (append && nextCursor) params.set('cursor', nextCursor);
			const response = await fetch(`/odonto/pacientes/papelera/lista?${params.toString()}`, {
				headers: { accept: 'application/json' },
				cache: 'no-store',
				signal: append ? undefined : activeController?.signal
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || 'No pudimos cargar la papelera.');
			if (sequence !== requestSequence) return;
			const incoming = Array.isArray(payload.items) ? payload.items : [];
			if (append) {
				const existing = new Set(items.map((item) => item.id));
				items = [...items, ...incoming.filter((item: TrashItem) => !existing.has(item.id))];
			} else {
				items = incoming;
			}
			hasMore = Boolean(payload.has_more);
			nextCursor = payload.next_cursor ?? null;
		} catch (error) {
			if ((error as Error)?.name !== 'AbortError' && sequence === requestSequence) {
				errorMessage = error instanceof Error ? error.message : 'No pudimos cargar la papelera.';
			}
		} finally {
			if (sequence === requestSequence) {
				append ? (loadingMore = false) : (loading = false);
			}
		}
	};

	onMount(() => {
		initialized = true;
	});

	onDestroy(() => activeController?.abort());

	$effect(() => {
		if (!initialized) return;
		query;
		const timeout = window.setTimeout(() => void fetchItems(), 275);
		return () => window.clearTimeout(timeout);
	});

	const restore = async () => {
		if (!restoreTarget || restoreBusy) return;
		restoreBusy = true;
		errorMessage = '';
		try {
			const response = await fetch(`/odonto/pacientes/papelera/${restoreTarget.id}/restore`, {
				method: 'POST'
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || 'No pudimos restaurar la imagen.');
			items = items.filter((item) => item.id !== restoreTarget?.id);
			message = 'Imagen restaurada en la ficha del paciente.';
			restoreTarget = null;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'No pudimos restaurar la imagen.';
		} finally {
			restoreBusy = false;
		}
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/pacientes" label="Volver a pacientes" class="mb-5" />
		<p class="ux-badge">Archivos clínicos</p>
		<h1 class="ux-title mt-4">Papelera de imágenes</h1>
		<p class="ux-subtitle">
			{data.canRestore
				? 'Restaurá imágenes que dejaron de mostrarse en la ficha. Desde acá no se borran archivos físicamente.'
				: 'Consultá las imágenes que dejaron de mostrarse en la ficha. Desde acá no se borran archivos físicamente.'}
		</p>
	</div>

	<div class="ux-card">
		<label for="trash-search" class="text-sm font-semibold text-white">Buscar por paciente o archivo</label>
		<div class="relative mt-2">
			<svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<circle cx="11" cy="11" r="7" />
				<path stroke-linecap="round" d="m20 20-3.5-3.5" />
			</svg>
			<input id="trash-search" type="search" bind:value={query} placeholder="Ej: Juan Pérez o panoramica.jpg" class="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/35" />
		</div>

		{#if data.demo}
			<p class="ux-alert mt-5">La papelera no está disponible en el modo de demostración.</p>
		{/if}
		{#if !data.demo && !data.canRestore}
			<p class="ux-alert mt-5">Podés consultar la papelera. Para restaurar imágenes, activá nuevamente la suscripción.</p>
		{/if}
		{#if errorMessage}
			<p class="ux-alert mt-5" role="alert">{errorMessage}</p>
		{/if}
		{#if message}
			<p class="ux-alert ux-alert-success mt-5" role="status">{message}</p>
		{/if}

		{#if loading}
			<div class="mt-6 grid gap-3">
				{#each [1, 2, 3] as placeholder}
					<div class="h-24 animate-pulse rounded-xl bg-white/5" aria-hidden="true"></div>
				{/each}
			</div>
		{:else if !data.demo && items.length === 0}
			<div class="mt-6 rounded-2xl border border-dashed border-white/15 px-5 py-8 text-center">
				<p class="font-semibold text-white">{query.trim() ? 'No encontramos imágenes con esa búsqueda' : 'La papelera está vacía'}</p>
				<p class="mt-2 text-sm text-white/50">{query.trim() ? 'Probá con otro nombre de paciente o archivo.' : 'Las imágenes que muevas desde una ficha aparecerán acá.'}</p>
			</div>
		{:else}
			<div class="mt-6 grid gap-3">
				{#each items as item (item.id)}
					<article class="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center">
						<div class="h-20 w-full shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#0b1626] sm:w-24">
							{#if item.thumbnail_url && !brokenThumbnails[item.id]}
								<img src={item.thumbnail_url} alt="" class="h-full w-full object-cover" loading="lazy" onerror={() => (brokenThumbnails = { ...brokenThumbnails, [item.id]: true })} />
							{:else}
								<div class="grid h-full place-items-center text-white/35" aria-hidden="true">
									<svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m4 17 5-4 3 2 4-3 4 3" /></svg>
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<a href={`/odonto/pacientes/${item.patient_id}?tab=radiografias`} class="font-semibold text-white hover:underline">{item.patient_name}</a>
							<p class="mt-1 truncate text-sm text-white/70">{item.original_filename || 'Imagen clínica'}</p>
							<p class="mt-1 text-xs text-white/45">Movida {formatDateTime(item.deleted_at)} por {item.deleted_by_label || 'usuario autorizado'} · {formatClinicalFileBytes(item.bytes)}</p>
							{#if item.taken_at}<p class="mt-1 text-xs text-white/45">Tomada el {formatDate(item.taken_at)}</p>{/if}
							{#if item.integrity_status !== 'ok'}
								<p class="mt-2 text-xs font-semibold text-red-300">No se puede restaurar porque el archivo no está disponible</p>
							{/if}
						</div>
						{#if data.canRestore}
							<button type="button" class="ux-btn-primary" disabled={item.integrity_status !== 'ok'} onclick={() => (restoreTarget = item)}>Restaurar</button>
						{/if}
					</article>
				{/each}
			</div>
			{#if hasMore}
				<div class="mt-5 flex justify-center"><button type="button" class="ux-btn-secondary" disabled={loadingMore} onclick={() => fetchItems({ append: true })}>{loadingMore ? 'Cargando…' : 'Ver más'}</button></div>
			{/if}
		{/if}
	</div>
</section>

<Modal open={Boolean(restoreTarget)} title="Restaurar imagen" dismissible={!restoreBusy} on:close={() => !restoreBusy && (restoreTarget = null)}>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>La imagen volverá a mostrarse en la ficha de <strong>{restoreTarget?.patient_name}</strong>.</p>
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<button type="button" class="ux-btn-secondary" disabled={restoreBusy} onclick={() => (restoreTarget = null)}>Cancelar</button>
			<button type="button" class="ux-btn-primary" disabled={restoreBusy} onclick={restore}>{restoreBusy ? 'Restaurando…' : 'Restaurar imagen'}</button>
		</div>
	</div>
</Modal>
