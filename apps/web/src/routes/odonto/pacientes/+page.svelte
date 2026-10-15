<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/stores';
	import Modal from '$lib/components/Modal.svelte';
	import {
		acceptPatientListSnapshot,
		consumePatientListNavigation,
		markPatientRevisionUnverified,
		patientRevisionState,
		rememberPatientListNavigation,
		setCachedPatientList,
		type PatientListSnapshot
	} from '$lib/client/patient-list-cache';
	import { formatDate } from '$lib/utils/format';
	import { patientMatchesListQuery } from '$lib/utils/patient-list-local-search';
	import { normalizePatientListQuery } from '$lib/utils/patient-list-query';
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { KeyboardEventHandler } from 'svelte/elements';

	type FormResult = {
		duplicate?: boolean;
		duplicateField?: 'dni';
		message?: string;
		existingId?: string;
		full_name?: string;
		dni?: string;
		phone?: string;
	};

	let { data } = $props<{ data: any; form: FormResult }>();
	const formState = $derived(($page.form as FormResult | null) ?? null);
	let listData = $state<any>();
	let patients = $state<any[]>([]);
	let unfilteredPatients = $state<any[]>([]);
	let search = $state('');
	let appliedQuery = $state('');
	let hasMore = $state(false);
	let nextCursor = $state<string | null>(null);
	const initialData = untrack(() => data);
	let appliedServerData = initialData;
	listData = initialData;
	patients = initialData.patients ?? [];
	unfilteredPatients = initialData.query ? [] : (initialData.patients ?? []);
	search = initialData.query ?? '';
	appliedQuery = initialData.query ?? '';
	hasMore = Boolean(initialData.hasMore);
	nextCursor = initialData.nextCursor ?? null;

	let showCreate = $state($page.url.searchParams.has('nuevo'));
	let showReport = $state(false);
	let createFullName = $state('');
	let createDni = $state('');
	let createPhone = $state('');
	let mounted = $state(false);
	let searchLoading = $state(false);
	let loadingMore = $state(false);
	let listError = $state('');
	let requestSequence = 0;
	let activeController: AbortController | null = null;
	let searchInputElement = $state<HTMLInputElement | null>(null);

	const canCreatePatient = $derived(listData.canCreatePatient !== false);
	const activeCount = $derived(Number(listData.activeCount ?? 0));
	const archivedCount = $derived(Number(listData.archivedCount ?? 0));
	const draftQuery = $derived(normalizePatientListQuery(search));
	const searchPending = $derived(draftQuery !== appliedQuery);
	const displayedPatients = $derived.by(() => {
		if (!searchPending) return patients;
		if (!draftQuery && unfilteredPatients.length > 0) return unfilteredPatients;
		const localCandidates = [
			...new Map(
				[...unfilteredPatients, ...patients].map((patient) => [String(patient.id), patient])
			).values()
		];
		return localCandidates.filter((patient) => patientMatchesListQuery(patient, draftQuery));
	});

	const preventEnterSubmit: KeyboardEventHandler<HTMLFormElement> = (event) => {
		if (event.key !== 'Enter') return;
		if (event.target instanceof HTMLTextAreaElement) return;
		event.preventDefault();
	};

	const currentListUrl = (query: string) => {
		const url = new URL($page.url);
		const normalizedQuery = normalizePatientListQuery(query);
		url.searchParams.delete('cursor');
		if (normalizedQuery) url.searchParams.set('q', normalizedQuery);
		else url.searchParams.delete('q');
		return `${url.pathname}${url.search}`;
	};

	const stateHref = (archived: boolean) => {
		const params = new URLSearchParams();
		const normalizedQuery = normalizePatientListQuery(search);
		if (archived) params.set('estado', 'archivados');
		if (normalizedQuery) params.set('q', normalizedQuery);
		return `/odonto/pacientes${params.size ? `?${params.toString()}` : ''}`;
	};

	const readListResponse = async (response: Response) => {
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(payload.message || 'No se pudieron cargar los pacientes.');
		}
		return payload as any;
	};

	const storeSnapshot = (snapshot: any) => {
		if (snapshot.cacheable && acceptPatientListSnapshot(snapshot as PatientListSnapshot)) {
			setCachedPatientList(snapshot as PatientListSnapshot);
		}
	};

	const fetchPage = async (
		{ reset = false, background = false }: { reset?: boolean; background?: boolean } = {}
	): Promise<boolean> => {
		if (reset) {
			activeController?.abort();
			activeController = new AbortController();
			if (!background) searchLoading = true;
		} else {
			if (loadingMore || !hasMore || !nextCursor) return false;
			loadingMore = true;
		}
		const sequence = ++requestSequence;
		listError = '';
		try {
			const params = new URLSearchParams();
			if (listData.showArchived) params.set('estado', 'archivados');
			const requestedQuery = reset ? normalizePatientListQuery(search) : appliedQuery;
			if (requestedQuery) params.set('q', requestedQuery);
			if (requestedQuery) params.set('mode', 'search');
			if (!reset && nextCursor) params.set('cursor', nextCursor);
			const response = await fetch(`/odonto/pacientes/lista?${params.toString()}`, {
				headers: { accept: 'application/json' },
				cache: 'no-store',
				signal: reset ? activeController?.signal : undefined
			});
			const payload = await readListResponse(response);
			if (sequence !== requestSequence) return false;

			if (reset) {
				patients = payload.patients ?? [];
				appliedQuery = payload.query ?? requestedQuery;
				if (!appliedQuery) unfilteredPatients = patients;
				listData =
					payload.countsIncluded === false
						? {
								...payload,
								activeCount,
								archivedCount,
								totalCount: Number(listData.totalCount ?? activeCount + archivedCount)
							}
						: payload;
				replaceState(currentListUrl(appliedQuery), $page.state);
				storeSnapshot(listData);
			} else {
				const existing = new Set(patients.map((patient) => patient.id));
				patients = [
					...patients,
					...(payload.patients ?? []).filter((patient: any) => !existing.has(patient.id))
				];
				if (!appliedQuery) unfilteredPatients = patients;
				listData = {
					...listData,
					...payload,
					activeCount: payload.countsIncluded === false ? activeCount : payload.activeCount,
					archivedCount: payload.countsIncluded === false ? archivedCount : payload.archivedCount,
					totalCount:
						payload.countsIncluded === false ? listData.totalCount : payload.totalCount,
					patients
				};
				storeSnapshot(listData);
			}
			hasMore = Boolean(payload.hasMore);
			nextCursor = payload.nextCursor ?? null;
			return true;
		} catch (error) {
			if ((error as Error)?.name !== 'AbortError' && sequence === requestSequence) {
				listError = error instanceof Error ? error.message : 'No se pudieron cargar los pacientes.';
			}
			return false;
		} finally {
			if (sequence === requestSequence) {
				searchLoading = false;
				loadingMore = false;
			}
		}
	};

	$effect(() => {
		if (!mounted) return;
		const next = draftQuery;
		if (next === appliedQuery) {
			if (searchLoading) {
				activeController?.abort();
				activeController = null;
				requestSequence += 1;
				searchLoading = false;
			}
			return;
		}
		searchLoading = true;
		const timeout = window.setTimeout(() => void fetchPage({ reset: true }), 120);
		return () => window.clearTimeout(timeout);
	});

	// SvelteKit reutiliza este componente al cambiar entre Activos/Archivados o
	// al completar una acción. Aplicamos explícitamente el nuevo payload del
	// servidor sin confundirlo con las páginas agregadas por "Ver más".
	$effect(() => {
		const serverData = data;
		if (serverData === appliedServerData) return;
		appliedServerData = serverData;
		activeController?.abort();
		requestSequence += 1;
		listData = serverData;
		patients = serverData.patients ?? [];
		if (!serverData.query) unfilteredPatients = patients;
		search = serverData.query ?? '';
		appliedQuery = serverData.query ?? '';
		hasMore = Boolean(serverData.hasMore);
		nextCursor = serverData.nextCursor ?? null;
		searchLoading = false;
		loadingMore = false;
		listError = '';
		storeSnapshot(serverData);
	});

	let automaticRefreshKey = '';
	$effect(() => {
		const revisionState = $patientRevisionState;
		if (
			!mounted ||
			listData.demo ||
			!listData.businessId ||
			revisionState.businessId !== listData.businessId ||
			revisionState.status !== 'unverified' ||
			!revisionState.revision ||
			revisionState.revision === listData.revision
		) {
			return;
		}
		const key = `${listData.businessId}:${revisionState.revision}:${appliedQuery}:${Boolean(listData.showArchived)}`;
		if (automaticRefreshKey === key) return;
		automaticRefreshKey = key;
		untrack(() => void fetchPage({ reset: true, background: true }));
	});

	const closeModal = () => {
		showCreate = false;
		createFullName = '';
		createDni = '';
		createPhone = '';
		const url = new URL($page.url);
		url.searchParams.delete('nuevo');
		goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true });
	};

	const openCreateModal = () => {
		if (!canCreatePatient) return;
		createFullName = '';
		createDni = '';
		createPhone = '';
		showCreate = true;
	};

	const createPatientEnhance: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success' || result.type === 'redirect') {
				markPatientRevisionUnverified(listData.businessId);
			}
			await update();
		};
	};

	const rememberPosition = () => {
		if (!browser || !listData.businessId) return;
		rememberPatientListNavigation({
			businessId: listData.businessId,
			showArchived: Boolean(listData.showArchived),
			query: appliedQuery,
			loadedCount: patients.length,
			scrollY: window.scrollY
		});
	};

	const openPatient = (patientId: string) => {
		rememberPosition();
		void goto(`/odonto/pacientes/${patientId}`);
	};

	const openPatientFromContainer = (event: MouseEvent, patientId: string) => {
		const target = event.target;
		if (target instanceof Element && target.closest('a, button, input, select, textarea, form')) return;
		openPatient(patientId);
	};

	const clearSearch = () => {
		search = '';
		requestAnimationFrame(() => searchInputElement?.focus());
	};

	onMount(() => {
		mounted = true;
		const canonicalUrl = currentListUrl(appliedQuery);
		if (canonicalUrl !== `${$page.url.pathname}${$page.url.search}`) {
			replaceState(canonicalUrl, $page.state);
		}
		storeSnapshot(listData);
		const context = listData.businessId
			? consumePatientListNavigation({
					businessId: listData.businessId,
					showArchived: Boolean(listData.showArchived),
					query: appliedQuery
				})
			: null;
		if (context) {
			void (async () => {
				while (patients.length < context.loadedCount && hasMore) {
					if (!(await fetchPage())) break;
				}
				requestAnimationFrame(() => window.scrollTo({ top: context.scrollY, behavior: 'auto' }));
			})();
		}
	});

	onDestroy(() => {
		activeController?.abort();
	});

	$effect(() => {
		if ($page.url.searchParams.has('nuevo')) showCreate = true;
		if (formState?.message) {
			showCreate = true;
			createFullName = formState.full_name ?? createFullName;
			createDni = formState.dni ?? createDni;
			createPhone = formState.phone ?? createPhone;
		}
	});
</script>

<section class="flex flex-col gap-4">
	<div class="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
		<h1 class="text-3xl font-semibold text-neutral-900 dark:text-white">Pacientes</h1>
		<button disabled={!canCreatePatient} class="inline-flex w-full justify-center rounded-full bg-[#7c3aed] px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto" onclick={openCreateModal}>+ Nuevo paciente</button>
	</div>

	{#if listError}
		<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100" role="alert">{listError}</div>
	{/if}

	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
		<div class="relative w-full sm:flex-1">
			<label class="sr-only" for="q">Buscar pacientes</label>
			<svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
			<input bind:this={searchInputElement} id="q" type="search" placeholder="Buscar por nombre, DNI o teléfono" bind:value={search} class="patient-search w-full rounded-2xl border border-neutral-200 bg-white py-3 pl-10 pr-20 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-[#eaf1ff]" />
			<div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
				{#if searchLoading}
					<span class="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-[#7c3aed]" aria-hidden="true"></span>
					<span class="sr-only" role="status">Buscando pacientes</span>
				{/if}
				{#if search}
					<button type="button" aria-label="Limpiar búsqueda" title="Limpiar búsqueda" class="grid h-8 w-8 place-items-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c3aed] dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white" onclick={clearSearch}>
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
					</button>
				{/if}
			</div>
		</div>
		<div class="grid min-w-64 grid-cols-2 overflow-hidden rounded-2xl border border-neutral-200 bg-white text-sm font-semibold dark:border-[#1f3554] dark:bg-[#0f1f36]">
			<a href={stateHref(false)} class={`flex min-h-14 flex-col items-center justify-center px-4 py-2 text-center leading-tight transition ${!listData.showArchived ? 'bg-[#7c3aed]/15 text-[#5b21b6] dark:text-[#e9d5ff]' : 'text-neutral-600 dark:text-neutral-300'}`}><span>Activos</span><span class="mt-0.5 text-xs opacity-75">({activeCount})</span></a>
			<a href={stateHref(true)} class={`flex min-h-14 flex-col items-center justify-center border-l border-neutral-200 px-4 py-2 text-center leading-tight transition dark:border-[#1f3554] ${listData.showArchived ? 'bg-[#7c3aed]/15 text-[#5b21b6] dark:text-[#e9d5ff]' : 'text-neutral-600 dark:text-neutral-300'}`}><span>Archivados</span><span class="mt-0.5 text-xs opacity-75">({archivedCount})</span></a>
		</div>
	</div>

	<div class="mb-4 overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
		{#if displayedPatients.length === 0}
			<div class="p-8 text-center text-sm text-neutral-600 dark:text-[#c8d4e8]">
				{#if draftQuery}
					<p class="font-semibold">No encontramos pacientes con ese criterio.</p>
				{:else if listData.showArchived}
					No hay pacientes archivados.
				{:else}
					Aún no hay pacientes registrados.
				{/if}
			</div>
		{:else}
			<div class="hidden md:block">
				<table class="w-full">
					<thead class="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-700 dark:bg-white/5 dark:text-neutral-200">
						<tr><th class="px-6 py-4">Paciente</th><th class="px-6 py-4">DNI / Teléfono</th><th class="px-6 py-4">Última visita</th><th class="px-6 py-4 text-right">Acciones</th></tr>
					</thead>
					<tbody>
						{#each displayedPatients as patient (patient.id)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<tr class="cursor-pointer border-t border-neutral-100 transition hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-[#0f1f36]" onclick={(event) => openPatientFromContainer(event, patient.id)}>
								<td class="px-6 py-5"><div class="flex items-center gap-4"><div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 font-semibold text-primary-700 dark:bg-primary-800/40 dark:text-primary-100">{(patient.full_name || '?').split(' ').filter(Boolean).slice(0, 2).map((part: string) => part[0]?.toUpperCase()).join('')}</div><div><button type="button" class="text-left text-sm font-semibold text-neutral-900 hover:underline dark:text-white" onclick={() => openPatient(patient.id)}>{patient.full_name}</button>{#if listData.showArchived}<p class="mt-1 text-xs text-neutral-500">Archivado</p>{/if}</div></div></td>
								<td class="px-6 py-5 text-sm text-neutral-600 dark:text-neutral-200">{patient.dni || 'Sin DNI'}{patient.phone ? ` · ${patient.phone}` : ''}</td>
								<td class="px-6 py-5 text-sm text-neutral-600 dark:text-neutral-200">{patient.last_entry_at ? formatDate(patient.last_entry_at) : '—'}</td>
								<td class="px-6 py-5 text-right"><div class="flex flex-col items-end gap-2"><button type="button" class="rounded-full bg-[#7c3aed] px-4 py-2 text-xs font-semibold text-white" onclick={() => openPatient(patient.id)}>Abrir paciente</button>{#if listData.showArchived}<form method="post" action={`/odonto/pacientes/${patient.id}?/unarchive_patient`}><button type="submit" class="rounded-full border border-neutral-300 px-4 py-2 text-xs font-semibold dark:border-[#8fb3ff]">Desarchivar</button></form>{/if}</div></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="space-y-3 p-3 md:hidden">
				{#each displayedPatients as patient (patient.id)}
					<article class="relative rounded-xl border border-neutral-100 bg-white p-4 shadow-sm transition hover:border-[#7c3aed]/40 dark:border-[#1f3554] dark:bg-[#0f1f36]">
						<a href={`/odonto/pacientes/${patient.id}`} class="absolute inset-0 z-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]" aria-label={`Abrir paciente ${patient.full_name}`} onclick={rememberPosition}></a>
						<div class="pointer-events-none relative z-[1] flex items-center gap-3"><div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 font-semibold text-primary-700 dark:bg-primary-800/40 dark:text-primary-100">{(patient.full_name || '?').split(' ').filter(Boolean).slice(0, 2).map((part: string) => part[0]?.toUpperCase()).join('')}</div><div class="min-w-0 flex-1"><h2 class="truncate font-semibold text-neutral-900 dark:text-white">{patient.full_name}</h2><p class="mt-1 text-xs text-neutral-600 dark:text-neutral-300">DNI {patient.dni || 'Sin DNI'}{patient.phone ? ` · ${patient.phone}` : ''}</p><p class="mt-1 text-xs text-neutral-500">Últ. visita {patient.last_entry_at ? formatDate(patient.last_entry_at) : '—'}</p></div></div>
						<div class="relative z-10 mt-3 grid gap-2"><button type="button" class="w-full rounded-full bg-[#7c3aed] px-4 py-2.5 text-sm font-semibold text-white" onclick={() => openPatient(patient.id)}>Abrir paciente</button>{#if listData.showArchived}<form method="post" action={`/odonto/pacientes/${patient.id}?/unarchive_patient`}><button type="submit" class="w-full rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-semibold dark:border-[#8fb3ff]">Desarchivar paciente</button></form>{/if}</div>
					</article>
				{/each}
			</div>
		{/if}
	</div>

	<footer class="grid gap-3 border-t border-neutral-200 pt-4 dark:border-white/10 md:grid-cols-3 md:items-start">
		<div class="md:justify-self-start">{#if listData.canAccessRadiographTrash}<a href="/odonto/pacientes/papelera" class="inline-flex w-full justify-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641] md:w-auto">Papelera de imágenes</a>{/if}</div>
		<div class="md:justify-self-center">{#if hasMore}<button type="button" class="w-full rounded-full border border-neutral-300 px-5 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-60 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641] md:w-auto" disabled={loadingMore} onclick={() => fetchPage()}>{loadingMore ? 'Cargando…' : 'Ver más pacientes'}</button>{/if}</div>
		<div class="md:justify-self-end"><button type="button" class="w-full rounded-full bg-[#991b1b] px-4 py-2 text-sm font-semibold text-white md:w-auto" onclick={() => (showReport = !showReport)}>Reportar problema</button>{#if showReport}<div class="mt-2 max-w-md rounded-xl border border-red-200 bg-[#5c0d0d] p-4 text-sm text-white"><p class="font-semibold">¿Encontraste un problema?</p><p class="mt-1">Escribí a <span class="font-semibold">juanpabloaltamira@protonmail.com</span>.</p></div>{/if}</div>
	</footer>
</section>

<Modal open={showCreate} title="Alta rápida de paciente" on:close={closeModal}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="post" action="?/create_patient" use:enhance={createPatientEnhance} class="space-y-4" onkeydown={preventEnterSubmit}>
		{#if !canCreatePatient}<div class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.</div>{/if}
		<div class="space-y-2"><label class="text-sm font-semibold text-neutral-800 dark:text-white" for="full_name">Nombre y apellido *</label><input id="full_name" name="full_name" required bind:value={createFullName} placeholder="Ej: Juan Pérez" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-900 shadow-sm dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" /></div>
		<div class="grid gap-3 md:grid-cols-2"><div class="space-y-2"><label class="text-sm font-semibold text-neutral-800 dark:text-white" for="dni">DNI (opcional)</label><input id="dni" name="dni" inputmode="numeric" bind:value={createDni} placeholder="Solo números" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-900 shadow-sm dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" /></div><div class="space-y-2"><label class="text-sm font-semibold text-neutral-800 dark:text-white" for="phone">Teléfono (opcional)</label><input id="phone" name="phone" inputmode="tel" bind:value={createPhone} placeholder="Código + número" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-900 shadow-sm dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" /></div></div>
		{#if formState?.message}<div class={`rounded-xl px-4 py-3 text-sm font-semibold ${formState.duplicate ? 'border border-amber-300 bg-amber-50 text-amber-950' : 'border border-red-300 bg-red-50 text-red-800'}`}><p>{formState.message}</p>{#if formState.duplicate && formState.existingId}<a class="mt-3 inline-flex rounded-xl bg-amber-500 px-4 py-2 font-bold text-slate-950" href={`/odonto/pacientes/${formState.existingId}`}>Abrir paciente existente</a>{/if}</div>{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" class="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700" onclick={closeModal}>Cancelar</button><button type="submit" disabled={!canCreatePatient} class="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45">Crear paciente</button></div>
	</form>
</Modal>

<style>
	.patient-search::-webkit-search-cancel-button {
		display: none;
	}
</style>
