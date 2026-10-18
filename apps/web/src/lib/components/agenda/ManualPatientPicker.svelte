<script lang="ts">
	import { onDestroy } from 'svelte';
	import { readManualBookingPatients, type ManualBookingPatient } from '$lib/patients/manual-booking';
	let {
		patients,
		loaded,
		loading,
		error,
		selectedId,
		query = $bindable(''),
		onSelect,
		onNeedPatients
	}: {
		patients: ManualBookingPatient[];
		loaded: boolean;
		loading: boolean;
		error: string;
		selectedId: string;
		query: string;
		onSelect: (patient: ManualBookingPatient) => void;
		onNeedPatients: () => void | Promise<void>;
	} = $props();
	let remote = $state<ManualBookingPatient[]>([]);
	let searching = $state(false),
		searchError = $state('');
	let generation = 0;
	let controller: AbortController | null = null;
	let destroyed = false;
	const searchingQuery = $derived(query.trim());
	const visible = $derived(
		(searchingQuery ? remote : patients)
			.filter((patient) => !patient.blocked)
			.slice(0, searchingQuery ? 12 : 8)
	);
	const dateFormatter = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC' });
	function disambiguation(patient: ManualBookingPatient) {
		const activity = new Date(patient.activity_at);
		const birth = patient.birth_date ? new Date(`${patient.birth_date}T00:00:00Z`) : null;
		return [
			patient.phone_e164,
			patient.dni ? `DNI ${patient.dni}` : null,
			birth && Number.isFinite(birth.getTime()) ? `Nac. ${dateFormatter.format(birth)}` : null,
			Number.isFinite(activity.getTime()) ? `Últ. actividad ${dateFormatter.format(activity)}` : null
		]
			.filter(Boolean)
			.join(' · ');
	}
	async function search(text: string, request: number) {
		controller?.abort();
		const pending = new AbortController();
		controller = pending;
		searching = true;
		searchError = '';
		try {
			const response = await fetch('/odonto/pacientes/buscar?q=' + encodeURIComponent(text), {
				signal: pending.signal,
				cache: 'no-store',
				headers: { accept: 'application/json' }
			});
			if (!response.ok) throw new Error('Patient search unavailable');
			const patients = readManualBookingPatients(await response.json());
			if (!destroyed && request === generation) remote = patients;
		} catch {
			if (destroyed || request !== generation || pending.signal.aborted) return;
			remote = [];
			searchError =
				'No pudimos buscar pacientes para crear el turno. Revisá tu conexión y volvé a intentar.';
		} finally {
			if (!destroyed && request === generation) searching = false;
			if (controller === pending) controller = null;
		}
	}
	$effect(() => {
		const text = searchingQuery;
		const request = ++generation;
		controller?.abort();
		controller = null;
		remote = [];
		searchError = '';
		searching = Boolean(text);
		if (!text) return;
		const timer = setTimeout(() => void search(text, request), 120);
		return () => clearTimeout(timer);
	});
	onDestroy(() => {
		destroyed = true;
		generation++;
		controller?.abort();
	});
	function retry() {
		void search(searchingQuery, ++generation);
	}
</script>

<div class="mt-6">
	<label>
		<span class="ux-label">Buscar por nombre, teléfono o DNI</span>
		<input bind:value={query} placeholder="Buscar paciente" class="ux-input" />
	</label>
	{#if searching}
		<p class="mt-3 text-base font-semibold text-white/55" role="status">Buscando pacientes…</p>
	{:else if loading && !searchingQuery}
		<p class="mt-3 text-base font-semibold text-white/55" role="status">Cargando fichas recientes…</p>
	{/if}
	{#if searchError}
		<div class="ux-alert mt-3" role="alert">
			{searchError}
			<button type="button" class="ml-2 font-bold underline" onclick={retry}>Reintentar búsqueda</button>
		</div>
	{:else if error && !searchingQuery}
		<div class="ux-alert mt-3" role="alert">
			{error}
			<button type="button" class="ml-2 font-bold underline" onclick={() => void onNeedPatients()}>Reintentar</button>
		</div>
	{/if}
	<div class="mt-3 grid gap-2">
		{#each visible as patient (patient.id)}
			<button type="button" onclick={() => onSelect(patient)} class="ux-choice min-w-0 break-words px-4 py-3 text-left"
				class:ux-choice-active={selectedId === patient.id} aria-pressed={selectedId === patient.id}>
				<span class="block text-base font-bold text-white">{patient.full_name}</span>
				{#if disambiguation(patient)}<span class="mt-1 block text-sm text-white/55">{disambiguation(patient)}</span>{/if}
			</button>
		{/each}
		{#if visible.length === 0 && !loading && !searching && !searchError && !(error && !searchingQuery)}
			<p class="ux-empty p-4 text-base">{searchingQuery ? 'No encontramos pacientes con esa búsqueda.' : loaded ? 'No hay fichas de pacientes para mostrar.' : 'Buscá una ficha.'}</p>
		{/if}
	</div>
</div>
