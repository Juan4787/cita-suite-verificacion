<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { PatientHistoryEntry } from '$lib/patients/contracts';
	import { readPatientHistoryPage } from '$lib/patients/history-contract';
	import { formatDate } from '$lib/utils/format';
	let {
		active,
		patientId,
		scope,
		historyRevision,
		entries = $bindable(),
		hasMoreEntries = $bindable(),
		businessTimeZone,
		canEditClinicalEntry,
		currentUserId,
		isProfessional,
		onEdit
	}: {
		active: boolean;
		patientId: string;
		scope: string;
		historyRevision: PatientHistoryEntry[];
		entries: PatientHistoryEntry[];
		hasMoreEntries: boolean;
		businessTimeZone?: string;
		canEditClinicalEntry: boolean;
		currentUserId?: string | null;
		isProfessional: boolean;
		onEdit: (entry: PatientHistoryEntry) => void;
	} = $props();
	let filterType = $state<'Todos' | 'Consulta' | 'Diagnóstico' | 'Tratamiento'>('Todos');
	let timelineSearch = $state('');
	let expandedId = $state<string | null>(null);
	let historyLoadError = $state('');
	let loadingMoreEntries = $state(false);
	let request: AbortController | null = null;
	let generation = 0;
	let destroyed = false;
	$effect(() => {
		// Refreshes and identity/permission changes invalidate the pending page,
		// independently of entries appended locally by this component.
		void patientId;
		void scope;
		void historyRevision;
		generation += 1;
		request?.abort();
		request = null;
		loadingMoreEntries = false;
		historyLoadError = '';
	});
	onDestroy(() => {
		destroyed = true;
		generation += 1;
		request?.abort();
	});
	const loadMoreEntries = async () => {
		if (loadingMoreEntries || !hasMoreEntries) return;
		const last = entries.at(-1);
		if (!last) {
			historyLoadError = 'No pudimos continuar el historial. Recargá la ficha y volvé a intentar.';
			return;
		}
		const requestedPatient = patientId,
			requestedScope = scope,
			revision = historyRevision,
			sequence = generation;
		const controller = new AbortController();
		request = controller;
		const isCurrent = () =>
			!destroyed &&
			sequence === generation &&
			requestedPatient === patientId &&
			requestedScope === scope &&
			revision === historyRevision &&
			!controller.signal.aborted;
		loadingMoreEntries = true;
		historyLoadError = '';
		try {
			const params = new URLSearchParams({ cursor_created_at: last.created_at, cursor_id: last.id });
			const response = await fetch(`/odonto/pacientes/${requestedPatient}/historial?${params}`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('Patient history unavailable');
			const payload = readPatientHistoryPage(await response.json(), last);
			if (!isCurrent()) return;
			const existing = new Set(entries.map((entry) => entry.id));
			entries = [...entries, ...payload.items.filter((entry) => !existing.has(entry.id))];
			hasMoreEntries = payload.has_more;
		} catch {
			if (isCurrent()) historyLoadError = 'No pudimos cargar más historial. Volvé a intentar.';
		} finally {
			if (isCurrent()) {
				loadingMoreEntries = false;
				request = null;
			}
		}
	};
	const fmtTime = (dateStr: string) =>
		new Intl.DateTimeFormat('es-AR', {
			...(businessTimeZone ? { timeZone: businessTimeZone } : {}),
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		}).format(new Date(dateStr));
	const mainTitle = (entry: PatientHistoryEntry) =>
		entry.title ?? entry.description ?? entry.entry_type;
	const isDuplicateDescription = (entry: PatientHistoryEntry) =>
		entry.description
			? entry.description.trim().toLowerCase() === mainTitle(entry).trim().toLowerCase()
			: false;
	const hasDistinctNote = (entry: PatientHistoryEntry) =>
		entry.internal_note &&
		entry.internal_note.trim() &&
		entry.internal_note.trim().toLowerCase() !== (entry.description ?? '').trim().toLowerCase();

	const entryMatches = (entry: PatientHistoryEntry) => {
		if (filterType !== 'Todos' && entry.entry_type !== filterType) return false;
		if (timelineSearch.trim()) {
			const q = timelineSearch.toLowerCase();
			const dateText = formatDate(entry.created_at, businessTimeZone);
			const haystack =
				`${entry.entry_type} ${entry.description ?? ''} ${entry.internal_note ?? ''} ${entry.teeth ?? ''} ${dateText} ${entry.created_at}`.toLowerCase();
			if (!haystack.includes(q)) return false;
		}
		return true;
	};

	const canEditEntry = (entry: PatientHistoryEntry) => {
		if (!canEditClinicalEntry) return false;
		if (!isProfessional) return true;
		const ownsEntry = entry.created_by_user_id && entry.created_by_user_id === currentUserId;
		const lockedAt = entry.locked_after ? new Date(entry.locked_after).getTime() : null;
		const isUnlocked = lockedAt === null || Date.now() <= lockedAt;
		return Boolean(ownsEntry && isUnlocked);
	};

	const formatCurrency = (value?: number | string | null) => {
		if (value == null || value === '') return '';
		const normalized = typeof value === 'string' ? value.replace(/\./g, '').replace(',', '.') : value;
		const numeric = Number(normalized);
		if (!Number.isFinite(numeric)) return '';
		const formatted = new Intl.NumberFormat('es-AR', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(numeric);
		return `$ ${formatted}`;
	};
</script>

{#if active}
		<div class="ux-card">
			<div class="flex flex-col gap-3 text-sm sm:flex-row sm:items-center">
				<div class="relative w-full sm:max-w-xs">
					<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 5h18M6 12h12M10 19h4" />
						</svg>
					</span>
					<select
						bind:value={filterType}
						aria-label="Tipo de consulta"
						class="w-full rounded-full border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]"
					>
						<option value="Todos">Filtrar por tipo: Todos</option>
						<option value="Consulta">Filtrar por tipo: Consulta</option>
						<option value="Diagnóstico">Filtrar por tipo: Diagnóstico</option>
						<option value="Tratamiento">Filtrar por tipo: Tratamiento</option>
					</select>
				</div>
				<div class="relative w-full">
					<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="11" cy="11" r="7" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M20 20l-3.5-3.5" />
						</svg>
					</span>
					<input
						type="search"
						aria-label="Buscar en el historial"
						placeholder="Buscar (palabra, fecha)"
						class="w-full rounded-full border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-700 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-50"
						bind:value={timelineSearch}
					/>
					</div>
				</div>
				{#if historyLoadError}
					<div class="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100" role="alert">
						<p>{historyLoadError}</p>
						<button type="button" class="font-semibold underline" onclick={() => (historyLoadError = '')}>Cerrar</button>
					</div>
				{/if}
				<div class="mt-4">
				{#if entries.length === 0}
					<p class="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-200">
						<span class="md:hidden">Sin consultas registradas. Cargá la primera tocando el botón + de abajo a la derecha.</span>
						<span class="hidden md:inline">Sin consultas registradas. Cargá la primera desde “Registrar consulta”.</span>
					</p>
				{:else}
					<div class="relative pl-8">
						<span class="absolute left-2 top-0 h-full w-px bg-neutral-200 dark:bg-[#1f3554]/60"></span>
						<div class="space-y-3">
							{#each entries as entry (entry.id ?? entry.created_at)}
								{#if entryMatches(entry)}
									{#key entry.id ?? entry.created_at}
										<div
											role="button"
											tabindex="0"
											onclick={() => (expandedId = expandedId === (entry.id ?? entry.created_at) ? null : entry.id ?? entry.created_at)}
											onkeydown={(e) => e.key === 'Enter' && (expandedId = expandedId === (entry.id ?? entry.created_at) ? null : entry.id ?? entry.created_at)}
											class="group relative overflow-hidden rounded-xl border border-neutral-100 bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] dark:border-[#1f3554] dark:bg-[#0f1f36]"
										>
											<span class="absolute left-[-14px] top-5 h-3 w-3 rounded-full border-2 border-white bg-[#7c3aed] shadow dark:border-[#0f1f36]"></span>
											<div class="flex flex-wrap items-start gap-3">
												<div class="flex min-w-0 flex-1 items-center gap-3">
													<span class="rounded-full bg-[#7c3aed]/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#5b21b6] dark:bg-[#7c3aed]/20 dark:text-[#d9c5ff]">
														{entry.entry_type}
													</span>
													<p class="text-[16px] font-semibold text-neutral-900 dark:text-white line-clamp-1">
														{mainTitle(entry)}
													</p>
												</div>
												<div class="flex w-full items-center justify-end gap-2 sm:w-auto sm:shrink-0 sm:justify-start">
													{#if entry.amount}
														<span class="text-[15px] font-semibold text-neutral-800 whitespace-nowrap dark:text-neutral-100">
															{formatCurrency(entry.amount)}
														</span>
													{/if}
													{#if canEditEntry(entry)}
														<button
															type="button"
															class="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641]"
															onclick={(event) => {
																event.stopPropagation();
																onEdit(entry);
															}}
														>
															<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
																<path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9" />
																<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
															</svg>
															Editar
														</button>
													{/if}
												</div>
											</div>
											{#if entry.description && !isDuplicateDescription(entry)}
												<p class="mt-1 text-[13px] font-medium text-neutral-700 opacity-85 line-clamp-1 dark:text-neutral-200">
													{entry.description}
												</p>
											{/if}
											<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-300">
												<span>{formatDate(entry.created_at, businessTimeZone)}</span>
												<span>·</span>
												<span>{fmtTime(entry.created_at)}</span>
												{#if entry.teeth}
													<span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-white/10 dark:text-neutral-200">
														Zona {entry.teeth}
													</span>
												{/if}
											</div>
											{#if hasDistinctNote(entry)}
												<p class="mt-2 text-xs text-neutral-500 dark:text-neutral-300 line-clamp-1">
													Nota: {entry.internal_note}
												</p>
											{/if}
											{#if expandedId === (entry.id ?? entry.created_at)}
												<div class="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-100">
													{#if entry.amount}
														<p><span class="font-semibold">Importe:</span> {formatCurrency(entry.amount)}</p>
													{/if}
													{#if entry.internal_note}
														<p><span class="font-semibold">Nota completa:</span> {entry.internal_note}</p>
													{/if}
												</div>
											{/if}
										</div>
									{/key}
								{/if}
							{/each}
						</div>
					</div>
					{#if hasMoreEntries}
						<div class="mt-4 flex justify-center">
							<button
								type="button"
								class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-200 dark:hover:bg-[#122641] disabled:cursor-not-allowed disabled:opacity-60"
								onclick={loadMoreEntries}
								disabled={loadingMoreEntries}
							>
								{loadingMoreEntries ? 'Cargando...' : 'Cargar más historial'}
							</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>
{/if}
