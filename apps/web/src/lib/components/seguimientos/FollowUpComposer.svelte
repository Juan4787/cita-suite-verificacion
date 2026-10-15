<script lang="ts">
	import { onDestroy } from 'svelte';
	import FollowUpDatePicker from './FollowUpDatePicker.svelte';

	type PatientLite = { id: string; full_name: string };
	type ProfLite = {
		id: string;
		name: string;
		source?: 'patient_link' | 'owner_admin_attending';
	};
	type ExistingFollowUp = {
		id: string;
		patient: PatientLite;
		remindOn: string;
		message: string | null;
		assignedProfessionalId: string | null;
		expectedUpdatedAt?: string;
	};

	let {
		patient = null,
		canAssign,
		todayISO,
		mode = 'create',
		existing = null,
		onCancel,
		onCreated
	} = $props<{
		patient?: PatientLite | null;
		canAssign: boolean;
		todayISO: string;
		mode?: 'create' | 'edit';
		existing?: ExistingFollowUp | null;
		onCancel: () => void;
		onCreated: () => void;
	}>();

	const LEGACY_DRAFT_KEY = 'seguimiento-draft';
	const FIXED_PATIENT_DRAFT_PREFIX = 'seguimiento-draft:patient:';

	let step = $state<'patient' | 'data' | 'confirm'>('patient');
	let selectedPatient = $state<PatientLite | null>(null);
	let remindOn = $state('');
	let message = $state('');

	// Búsqueda de paciente (solo modo crear desde la sección)
	let query = $state('');
	let results = $state<Array<{ id: string; full_name: string; phone_e164: string | null }>>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let searchController: AbortController | null = null;
	let searchRequest = 0;
	const searchCache = new Map<
		string,
		Array<{ id: string; full_name: string; phone_e164: string | null }>
	>();

	// Asignación (solo canAssign)
	let professionals = $state<ProfLite[]>([]);
	let selectedProfessionalId = $state('');
	let loadingProfs = $state(false);
	let profsLoaded = $state(false);
	let loadedForPatientId = $state('');

	let submitting = $state(false);
	let errorMsg = $state('');

	const hasFixedPatient = $derived(Boolean(patient) || mode === 'edit');

	const draftKey = $derived(patient ? `${FIXED_PATIENT_DRAFT_PREFIX}${patient.id}` : '');

	const readDraft = (key: string): {
		patientId?: string;
		patientName?: string;
		remindOn?: string;
		message?: string;
	} | null => {
		if (typeof sessionStorage === 'undefined' || !key) return null;
		try {
			const raw = sessionStorage.getItem(key);
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	};
	const clearDraft = (key = draftKey) => {
		if (typeof sessionStorage === 'undefined') return;
		try {
			if (key) sessionStorage.removeItem(key);
			sessionStorage.removeItem(LEGACY_DRAFT_KEY);
		} catch {
			/* noop */
		}
	};

	const initializeFromProps = (
		initialMode: 'create' | 'edit',
		initialExisting: ExistingFollowUp | null,
		initialPatient: PatientLite | null
	) => {
		if (initialMode === 'edit' && initialExisting) {
			selectedPatient = initialExisting.patient;
			remindOn = initialExisting.remindOn;
			message = initialExisting.message ?? '';
			step = 'data';
		} else if (initialPatient) {
			selectedPatient = initialPatient;
			step = 'data';
			const d = readDraft(`${FIXED_PATIENT_DRAFT_PREFIX}${initialPatient.id}`);
			if (d && d.patientId === initialPatient.id) {
				remindOn = d.remindOn ?? '';
				message = d.message ?? '';
			}
		} else {
			clearDraft('');
		}
	};

	// --- Inicialización: edición (prefill) o creación (restaurar borrador) ---
	// svelte-ignore state_referenced_locally
	initializeFromProps(mode, existing, patient);

	const fullLabel = (iso: string) => {
		if (!iso) return '';
		return new Intl.DateTimeFormat('es-AR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		})
			.format(new Date(`${iso}T12:00:00`))
			.toUpperCase();
	};

	const runSearch = (value: string) => {
		query = value;
		if (searchTimer) clearTimeout(searchTimer);
		searchController?.abort();
		searchController = null;
		searchRequest += 1;
		const q = value.trim();
		if (q.length < 2) {
			results = [];
			searching = false;
			return;
		}
		const cacheKey = q.toLocaleLowerCase('es-AR');
		const cached = searchCache.get(cacheKey);
		if (cached) {
			results = cached;
			searching = false;
			return;
		}
		searching = true;
		searchTimer = setTimeout(async () => {
			const requestId = searchRequest;
			const controller = new AbortController();
			searchController = controller;
			try {
				const res = await fetch(`/odonto/seguimientos/buscar?q=${encodeURIComponent(q)}`, {
					signal: controller.signal
				});
				if (!res.ok) throw new Error('No pudimos buscar pacientes para el seguimiento. Revisá tu conexión y volvé a intentar.');
				const data = await res.json();
				if (requestId !== searchRequest) return;
				const next = Array.isArray(data?.patients) ? data.patients : [];
				if (searchCache.size >= 20) {
					const oldestKey = searchCache.keys().next().value;
					if (typeof oldestKey === 'string') searchCache.delete(oldestKey);
				}
				searchCache.set(cacheKey, next);
				results = next;
			} catch (error) {
				if (requestId === searchRequest && (error as { name?: string })?.name !== 'AbortError') {
					results = [];
				}
			} finally {
				if (requestId === searchRequest) {
					searching = false;
					searchController = null;
				}
			}
		}, 250);
	};

	onDestroy(() => {
		if (searchTimer) clearTimeout(searchTimer);
		searchController?.abort();
	});

	const loadProfessionals = async (patientId: string, preselectId = '') => {
		if (!canAssign) return;
		loadingProfs = true;
		profsLoaded = false;
		professionals = [];
		selectedProfessionalId = '';
		try {
			const res = await fetch(
				`/odonto/seguimientos/profesionales?patient_id=${encodeURIComponent(patientId)}`
			);
			const data = await res.json();
			professionals = Array.isArray(data?.professionals) ? data.professionals : [];
			if (preselectId && professionals.some((p) => p.id === preselectId)) {
				selectedProfessionalId = preselectId;
			} else if (professionals.length === 1) {
				selectedProfessionalId = professionals[0].id;
			}
		} catch {
			professionals = [];
		} finally {
			loadingProfs = false;
			profsLoaded = true;
		}
	};

	const pickPatient = (p: PatientLite) => {
		searchController?.abort();
		searchController = null;
		searchRequest += 1;
		selectedPatient = p;
		results = [];
		query = '';
		step = 'data';
	};

	// Carga de profesionales: una sola vez por paciente; recarga al cambiar de paciente.
	const effectivePatientId = $derived(selectedPatient?.id ?? '');
	$effect(() => {
		const pid = effectivePatientId;
		if (canAssign && pid && pid !== loadedForPatientId) {
			loadedForPatientId = pid;
			const preselect =
				mode === 'edit' && existing && pid === existing.patient.id
					? existing.assignedProfessionalId ?? ''
					: '';
			void loadProfessionals(pid, preselect);
		}
	});

	// Guardado temporal del borrador: solo cuando el punto de entrada ya fija el paciente.
	$effect(() => {
		if (mode === 'edit') return;
		if (!patient) return;
		if (typeof sessionStorage === 'undefined') return;
		const snapshot = {
			patientId: selectedPatient?.id ?? '',
			patientName: selectedPatient?.full_name ?? '',
			remindOn,
			message
		};
		try {
			sessionStorage.setItem(draftKey, JSON.stringify(snapshot));
		} catch {
			/* noop */
		}
	});

	const noLinkedProfessional = $derived(canAssign && profsLoaded && professionals.length === 0);
	const linkedProfessionals = $derived(
		professionals.filter((prof) => prof.source === 'patient_link' || !prof.source)
	);
	const ownerAdminProfessionals = $derived(
		professionals.filter((prof) => prof.source === 'owner_admin_attending')
	);

	const canContinue = $derived(
		Boolean(selectedPatient) &&
			Boolean(remindOn) &&
			(!canAssign || (!noLinkedProfessional && Boolean(selectedProfessionalId)))
	);

	const assignedName = $derived(
		canAssign ? professionals.find((p) => p.id === selectedProfessionalId)?.name ?? '' : ''
	);

	const goConfirm = () => {
		errorMsg = '';
		if (!canContinue) return;
		step = 'confirm';
	};

	const save = async () => {
		if (!selectedPatient || submitting) return;
		submitting = true;
		errorMsg = '';
		try {
			const url =
				mode === 'edit' && existing
					? `/odonto/seguimientos/${existing.id}/editar`
					: '/odonto/seguimientos/crear';
			const base = {
				remind_on: remindOn,
				message: message.trim() || null,
				assigned_professional_id: canAssign ? selectedProfessionalId : null,
				...(mode === 'edit' && existing?.expectedUpdatedAt
					? { expected_updated_at: existing.expectedUpdatedAt }
					: {})
			};
			const body =
				mode === 'edit' ? base : { ...base, patient_id: selectedPatient.id };
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				errorMsg = data?.message ?? 'No se pudo guardar el seguimiento.';
				step = 'data';
				return;
			}
			clearDraft();
			onCreated();
		} catch {
			errorMsg = 'No se pudo guardar el seguimiento. Revisá tu conexión.';
			step = 'data';
		} finally {
			submitting = false;
		}
	};
</script>

<div class="space-y-5 text-white">
	{#if step === 'patient'}
		<div class="space-y-3">
			<label class="block text-sm font-bold text-white/80" for="fu-patient">Paciente</label>
			<input
				id="fu-patient"
				type="text"
				value={query}
				oninput={(e) => runSearch((e.target as HTMLInputElement).value)}
				placeholder="Buscá por nombre, teléfono o DNI"
				class="ux-input"
				autocomplete="off"
			/>
			{#if searching}
				<p class="text-sm text-white/50">Buscando…</p>
			{:else if query.trim().length >= 2 && results.length === 0}
				<p class="text-sm text-white/50">No se encontraron pacientes.</p>
			{/if}
			{#if results.length > 0}
				<div class="grid gap-2">
					{#each results as p}
						<button type="button" onclick={() => pickPatient({ id: p.id, full_name: p.full_name })} class="ux-choice flex items-center justify-between gap-3 px-4 py-3 text-left">
							<span class="font-bold text-white">{p.full_name}</span>
							{#if p.phone_e164}<span class="text-sm text-white/45">{p.phone_e164}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		<div class="flex justify-end">
			<button type="button" onclick={onCancel} class="ux-btn-secondary">Cancelar</button>
		</div>
	{:else if step === 'data'}
		<div class="space-y-5">
			<div class="rounded-xl bg-white/5 px-4 py-3">
				<p class="text-[11px] font-black uppercase tracking-wide text-white/40">Paciente</p>
				<p class="mt-0.5 font-bold text-white">{selectedPatient?.full_name}</p>
			</div>

			<FollowUpDatePicker bind:value={remindOn} {todayISO} />

			<div class="space-y-2">
				<label class="block text-sm font-bold text-white/80" for="fu-message">Mensaje / nota (opcional)</label>
				<textarea
					id="fu-message"
					bind:value={message}
					maxlength="500"
					rows="3"
					placeholder="Ej: llamar al papá para coordinar control."
					class="ux-textarea"
				></textarea>
			</div>

			{#if canAssign}
				<div class="space-y-2">
					<label class="block text-sm font-bold text-white/80" for="fu-prof">Asignar a</label>
					{#if loadingProfs}
						<p class="text-sm text-white/50">Cargando profesionales…</p>
					{:else if noLinkedProfessional}
						<p class="ux-alert">
							No hay perfiles profesionales atendibles para asignar este seguimiento.
						</p>
					{:else}
						<select id="fu-prof" bind:value={selectedProfessionalId} class="ux-select">
							<option value="" disabled>Elegí un profesional…</option>
							{#if linkedProfessionals.length > 0}
								<optgroup label="Vinculados a este paciente">
									{#each linkedProfessionals as prof}
										<option value={prof.id}>{prof.name}</option>
									{/each}
								</optgroup>
							{/if}
							{#if ownerAdminProfessionals.length > 0}
								<optgroup label="Dueños y administradores atendibles">
									{#each ownerAdminProfessionals as prof}
										<option value={prof.id}>{prof.name}</option>
									{/each}
								</optgroup>
							{/if}
						</select>
					{/if}
				</div>
			{/if}

			{#if errorMsg}<p class="ux-alert">{errorMsg}</p>{/if}

			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
				<button type="button" onclick={hasFixedPatient ? onCancel : () => (step = 'patient')} class="ux-btn-secondary">
					{hasFixedPatient ? 'Cancelar' : 'Volver'}
				</button>
				<button type="button" onclick={goConfirm} disabled={!canContinue} class="ux-btn-primary disabled:opacity-40">
					Continuar
				</button>
			</div>
		</div>
	{:else}
		<div class="space-y-4">
			<p class="text-sm font-bold uppercase tracking-wide text-white/40">
				{mode === 'edit' ? 'Confirmar cambios' : 'Confirmar seguimiento'}
			</p>

			<div class="rounded-2xl border border-[#7c3aed]/50 bg-[#7c3aed]/15 px-4 py-6 text-center shadow-lg shadow-[#7c3aed]/10">
				<p class="text-xs font-black uppercase tracking-[0.15em] text-[#b89bff]">Fecha del recordatorio</p>
				<p class="mt-2 text-2xl font-black leading-tight text-white sm:text-3xl">{fullLabel(remindOn)}</p>
			</div>

			<div class="grid gap-3">
				<div class="rounded-xl bg-white/5 px-4 py-3">
					<p class="text-[11px] font-black uppercase tracking-wide text-white/40">Paciente</p>
					<p class="mt-0.5 font-bold text-white">{selectedPatient?.full_name}</p>
				</div>
				{#if message.trim()}
					<div class="rounded-xl bg-white/5 px-4 py-3">
						<p class="text-[11px] font-black uppercase tracking-wide text-white/40">Mensaje</p>
						<p class="mt-0.5 text-white/90">{message.trim()}</p>
					</div>
				{/if}
				{#if canAssign && assignedName}
					<div class="rounded-xl bg-white/5 px-4 py-3">
						<p class="text-[11px] font-black uppercase tracking-wide text-white/40">Asignado a</p>
						<p class="mt-0.5 font-bold text-white">{assignedName}</p>
					</div>
				{/if}
			</div>

			{#if errorMsg}<p class="ux-alert">{errorMsg}</p>{/if}

			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
				<button type="button" onclick={() => (step = 'data')} disabled={submitting} class="ux-btn-secondary">Editar</button>
				<button type="button" onclick={save} disabled={submitting} class="ux-btn-primary disabled:opacity-50">
					{submitting ? 'Guardando…' : mode === 'edit' ? 'Guardar cambios' : 'Guardar seguimiento'}
				</button>
			</div>
		</div>
	{/if}
</div>
