<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { formatDateTime } from '$lib/utils/format';

	let { data } = $props<{
		data: {
			professional: { id: string; name: string } | null;
			appointments: Array<{
				id: string;
				starts_at: string;
				status: string;
				service_name_snapshot: string | null;
				patient_id: string;
				patients?: { full_name: string } | null;
			}>;
			entries: Array<{
				id: string;
				created_at: string;
				entry_type: string | null;
				description: string | null;
				patient_id: string;
				patients?: { full_name: string } | null;
			}>;
			loadError: string | null;
			demo: boolean;
		};
	}>();

	const statusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Reprogramar'
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href={`/odonto/profesionales/${data.professional?.id ?? ''}`} label="Volver al profesional" class="mb-5" />
		<h1 class="ux-title">Historial de {data.professional?.name ?? 'profesional'}</h1>
		<p class="ux-subtitle">
			Turnos y consultas de este profesional. Pertenecen a los pacientes: para poder eliminar al profesional,
			primero hay que resolver estos registros.
		</p>
	</div>

	{#if data.loadError}
		<p class="ux-alert">{data.loadError}</p>
	{/if}

	<div class="ux-card">
		<div class="flex items-center justify-between gap-3">
			<h2 class="ux-section-title">Turnos</h2>
			<span class="ux-badge">{data.appointments.length}</span>
		</div>
		<div class="mt-5 grid gap-3">
			{#each data.appointments as appt}
				<a href={`/odonto/turnos/${appt.id}`} class="ux-choice flex items-center gap-3 p-4">
					<div class="min-w-0 flex-1">
						<p class="truncate font-bold text-white">{appt.patients?.full_name ?? 'Paciente'}</p>
						<p class="mt-0.5 text-sm text-white/55">
							{formatDateTime(appt.starts_at)}{appt.service_name_snapshot ? ` · ${appt.service_name_snapshot}` : ''} · {statusLabels[appt.status] ?? appt.status}
						</p>
					</div>
					<svg class="h-5 w-5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
				</a>
			{/each}
			{#if data.appointments.length === 0}
				<EmptyState title="Sin turnos" description="Este profesional no tiene turnos cargados." />
			{/if}
		</div>
	</div>

	<div class="ux-card">
		<div class="flex items-center justify-between gap-3">
			<h2 class="ux-section-title">Consultas</h2>
			<span class="ux-badge">{data.entries.length}</span>
		</div>
		<div class="mt-5 grid gap-3">
			{#each data.entries as entry}
				<a href={`/odonto/pacientes/${entry.patient_id}`} class="ux-choice flex items-center gap-3 p-4">
					<div class="min-w-0 flex-1">
						<p class="truncate font-bold text-white">{entry.patients?.full_name ?? 'Paciente'}</p>
						<p class="mt-0.5 text-sm text-white/55">
							{formatDateTime(entry.created_at)}{entry.entry_type ? ` · ${entry.entry_type}` : ''}
						</p>
						{#if entry.description}
							<p class="mt-2 text-sm text-white/70">{entry.description}</p>
						{/if}
					</div>
					<svg class="h-5 w-5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
				</a>
			{/each}
			{#if data.entries.length === 0}
				<EmptyState title="Sin consultas" description="Este profesional no tiene consultas cargadas." />
			{/if}
		</div>
	</div>
</section>
