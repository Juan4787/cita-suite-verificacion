<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import PatientExportPanel from '$lib/components/patient-export/PatientExportPanel.svelte';

	let { data } = $props<{
		data: {
			scope: 'patient' | 'all_patients';
			patient: { id: string; name: string } | null;
		};
	}>();

	const isPatientExport = $derived(data.scope === 'patient' && data.patient !== null);
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink
			href={isPatientExport && data.patient ? `/odonto/pacientes/${data.patient.id}` : '/odonto/pacientes'}
			label={isPatientExport ? 'Volver al paciente' : 'Volver a pacientes'}
			class="mb-5"
		/>
		<h1 class="ux-title">Exportar datos</h1>
		<p class="ux-subtitle">
			{isPatientExport
				? 'Prepará un Excel con la ficha completa de este paciente.'
				: 'Descargá un Excel con la información completa de tus pacientes.'}
		</p>
	</div>

	<div class="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
		<div class="space-y-5">
			<section class="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#0f1f36] sm:p-7" aria-labelledby="included-data-title">
				<div class="flex items-start gap-3">
					<span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-300/15 dark:text-emerald-200">
						<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
							<path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
					<div class="min-w-0">
						<h2 id="included-data-title" class="text-xl font-black text-neutral-950 dark:text-white">Qué incluye</h2>
						<p class="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
							El archivo contiene ocho hojas.
						</p>
					</div>
				</div>
				<ul class="mt-5 grid gap-3 text-sm leading-6 text-neutral-700 dark:text-neutral-200 sm:grid-cols-2">
					<li class="rounded-2xl bg-neutral-50 px-4 py-3 dark:bg-[#13243d]">Datos de pacientes y ficha clínica</li>
					<li class="rounded-2xl bg-neutral-50 px-4 py-3 dark:bg-[#13243d]">Datos adicionales de cada paciente</li>
					<li class="rounded-2xl bg-neutral-50 px-4 py-3 dark:bg-[#13243d]">Historia clínica e importes</li>
					<li class="rounded-2xl bg-neutral-50 px-4 py-3 dark:bg-[#13243d]">Turnos y profesionales asignados</li>
					<li class="rounded-2xl bg-neutral-50 px-4 py-3 dark:bg-[#13243d] sm:col-span-2">Seguimientos, incluidos los registros archivados que correspondan</li>
				</ul>
			</section>
			<div class="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm leading-6 text-neutral-600 dark:border-[#294568] dark:bg-[#13243d] dark:text-neutral-300">
				Exportar es una operación de lectura: no borra, archiva ni modifica ningún dato del consultorio.
			</div>
		</div>

		<div class="min-w-0 xl:sticky xl:top-24 xl:self-start">
			<PatientExportPanel
				scope={data.scope}
				patientId={data.patient?.id ?? null}
				patientName={data.patient?.name ?? ''}
			/>
		</div>
	</div>
</section>
