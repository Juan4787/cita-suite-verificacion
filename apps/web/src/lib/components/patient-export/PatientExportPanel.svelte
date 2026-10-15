<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import type { PatientExportDataset, PatientExportScope } from '$lib/patient-export/contract';
	import type {
		PatientExportClientErrorCode,
		PatientExportProgress,
		PreparedPatientExport
	} from '$lib/patient-export/orchestrator';

	let {
		scope,
		patientId = null,
		patientName = ''
	} = $props<{
		scope: PatientExportScope;
		patientId?: string | null;
		patientName?: string;
	}>();

	type PanelState = 'idle' | 'running' | 'success' | 'cancelled' | 'error';

	const datasetLabels: Record<PatientExportDataset, string> = {
		patients: 'Pacientes',
		custom_fields: 'Datos adicionales',
		clinical_entries: 'Historia clínica',
		appointments: 'Turnos',
		appointment_professionals: 'Profesionales de turnos',
		follow_ups: 'Seguimientos'
	};
	const datasets: PatientExportDataset[] = [
		'patients',
		'custom_fields',
		'clinical_entries',
		'appointments',
		'appointment_professionals',
		'follow_ups'
	];

	let panelState = $state<PanelState>('idle');
	let progress = $state<PatientExportProgress | null>(null);
	let prepared = $state<PreparedPatientExport | null>(null);
	let errorMessage = $state('');
	let errorCode = $state<PatientExportClientErrorCode | null>(null);
	let retryable = $state(false);
	let cancelling = $state(false);
	let terminalSummary = $state<HTMLElement | null>(null);
	let controller: AbortController | null = null;
	let cancelServerSession: (() => void) | null = null;
	let destroyed = false;
	const objectUrls = new Set<string>();
	const revokeTimers = new Set<ReturnType<typeof setTimeout>>();

	const progressMessage = $derived.by(() => {
		if (cancelling) return 'Cancelando la exportación…';
		if (!progress) return 'Preparando la exportación…';
		switch (progress.stage) {
			case 'starting':
				return 'Comprobando permisos y preparando los datos…';
			case 'fetching': {
				const label = datasetLabels[progress.dataset];
				if (progress.expected === 0) return `${label}: no hay registros para esta hoja.`;
				return `${label}: ${progress.received.toLocaleString('es-AR')} de ${progress.expected.toLocaleString('es-AR')} registros.`;
			}
			case 'validating':
				return 'Comprobando que el archivo esté completo…';
			case 'retrying':
				return 'Los datos cambiaron durante la preparación. Reintentando desde el inicio…';
			case 'transforming':
				return 'Organizando las hojas del archivo…';
			case 'writing':
				return 'Creando el archivo Excel…';
		}
	});

	const formatBytes = (bytes: number) => {
		if (bytes < 1024) return `${bytes.toLocaleString('es-AR')} bytes`;
		if (bytes < 1024 * 1024) {
			return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`;
		}
		return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
	};

	const revokeObjectUrl = (url: string) => {
		if (!objectUrls.delete(url)) return;
		URL.revokeObjectURL(url);
	};

	const downloadPreparedFile = () => {
		if (!prepared || typeof URL.createObjectURL !== 'function') return;
		const url = URL.createObjectURL(prepared.blob);
		objectUrls.add(url);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = prepared.filename;
		anchor.rel = 'noopener';
		anchor.hidden = true;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		const timer = setTimeout(() => {
			revokeTimers.delete(timer);
			revokeObjectUrl(url);
		}, 1_000);
		revokeTimers.add(timer);
	};

	const focusTerminalSummary = async () => {
		await tick();
		terminalSummary?.focus();
	};

	const startExport = async () => {
		if (panelState === 'running') return;
		panelState = 'running';
		progress = { stage: 'starting', attempt: 1 };
		prepared = null;
		errorMessage = '';
		errorCode = null;
		retryable = false;
		cancelling = false;
		cancelServerSession = null;
		controller = new AbortController();
		const currentController = controller;

		try {
			const exportModule = await import('$lib/patient-export/orchestrator');
			const result = await exportModule.preparePatientExport({
				scope,
				patientId,
				signal: currentController.signal,
				onSessionCancelChange: (nextCancel) => {
					if (!destroyed && controller === currentController) {
						cancelServerSession = nextCancel;
					} else {
						nextCancel?.();
					}
				},
				onProgress: (nextProgress) => {
					if (!destroyed && controller === currentController) progress = nextProgress;
				}
			});
			if (destroyed || controller !== currentController) return;
			prepared = result;
			panelState = 'success';
			controller = null;
			downloadPreparedFile();
			await focusTerminalSummary();
		} catch (error) {
			if (destroyed || controller !== currentController) return;
			controller = null;
			if (
				error instanceof Error &&
				error.name === 'PatientExportOrchestrationError' &&
				'code' in error &&
				typeof error.code === 'string'
			) {
				const safeError = error as Error & {
					code: PatientExportClientErrorCode;
					retryable?: boolean;
				};
				if (safeError.code === 'EXPORT_CANCELLED') {
					panelState = 'cancelled';
				} else {
					panelState = 'error';
					errorMessage = safeError.message;
					errorCode = safeError.code;
					retryable = Boolean(safeError.retryable);
				}
			} else {
				panelState = 'error';
				errorMessage = 'No pudimos preparar el archivo. Recargá la página e intentá nuevamente.';
				retryable = true;
			}
			cancelling = false;
			await focusTerminalSummary();
		}
	};

	const cancelExport = () => {
		if (panelState !== 'running' || !controller || cancelling) return;
		cancelling = true;
		cancelServerSession?.();
		cancelServerSession = null;
		controller.abort();
	};

	const cancelActiveExport = () => {
		const wasRunning = panelState === 'running' && controller !== null;
		cancelServerSession?.();
		cancelServerSession = null;
		controller?.abort();
		controller = null;
		// Si el documento entra en BFCache, el estado del componente puede volver
		// a mostrarse en pageshow. Nunca debe reaparecer como una operacion activa
		// sin controlador ni sesion servidor.
		if (wasRunning) {
			panelState = 'cancelled';
			cancelling = false;
		}
	};

	onMount(() => {
		// onDestroy cubre la navegacion interna de SvelteKit. pagehide agrega la
		// barrera necesaria para recargas, cierre de pestana y navegacion externa,
		// donde el framework no siempre alcanza a desmontar el componente.
		window.addEventListener('pagehide', cancelActiveExport);
		return () => window.removeEventListener('pagehide', cancelActiveExport);
	});

	onDestroy(() => {
		destroyed = true;
		cancelActiveExport();
		for (const timer of revokeTimers) clearTimeout(timer);
		revokeTimers.clear();
		for (const url of objectUrls) URL.revokeObjectURL(url);
		objectUrls.clear();
		prepared = null;
	});
</script>

<div class="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#0f1f36] sm:p-7">
	{#if scope === 'patient'}
		<div class="rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-400/25 dark:bg-violet-400/10">
			<p class="text-xs font-black uppercase tracking-[0.18em] text-violet-700 dark:text-violet-200">Paciente seleccionado</p>
			<p class="mt-2 break-words text-lg font-bold text-neutral-950 dark:text-white">
				{patientName || 'Paciente'}
			</p>
		</div>
	{/if}

	{#if panelState === 'idle'}
		<div class={scope === 'patient' ? 'mt-5' : ''}>
			<p class="text-sm leading-6 text-neutral-600 dark:text-neutral-300">
				La preparación puede tardar si hay muchos registros. Mantené esta pestaña abierta hasta que aparezca el archivo.
			</p>
			<button
				type="button"
				class="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#6d28d9] px-5 py-3 text-base font-black text-white shadow-lg shadow-violet-900/15 transition hover:-translate-y-0.5 hover:bg-[#5b21b6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] sm:w-auto"
				onclick={startExport}
			>
				<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
					<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				Preparar archivo Excel
			</button>
		</div>
	{:else if panelState === 'running'}
		<div class={scope === 'patient' ? 'mt-5' : ''} aria-live="polite" aria-atomic="true">
			<div class="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-400/25 dark:bg-violet-400/10">
				<span class="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-300/15 dark:text-violet-200">
					<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5 motion-safe:animate-spin">
						<path d="M21 12a9 9 0 1 1-6.2-8.56" stroke-linecap="round" />
					</svg>
				</span>
				<div class="min-w-0">
					<p class="font-bold text-neutral-950 dark:text-white">Preparando el archivo</p>
					<p class="mt-1 break-words text-sm leading-6 text-neutral-600 dark:text-neutral-300">{progressMessage}</p>
				</div>
			</div>
			<p class="mt-3 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
				No cierres esta pestaña. Tus datos no se modifican durante la exportación.
			</p>
			<button
				type="button"
				class="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-bold text-neutral-800 transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] disabled:cursor-wait disabled:opacity-60 dark:border-[#315078] dark:bg-[#13243d] dark:text-white dark:hover:bg-[#182d4b] sm:w-auto"
				onclick={cancelExport}
				disabled={cancelling}
			>
				{cancelling ? 'Cancelando…' : 'Cancelar'}
			</button>
		</div>
	{:else if panelState === 'success' && prepared}
		<div
			class={scope === 'patient' ? 'mt-5' : ''}
			role="status"
			aria-live="polite"
			tabindex="-1"
			bind:this={terminalSummary}
		>
			<div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-400/25 dark:bg-emerald-400/10">
				<div class="flex items-start gap-3">
					<span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-300/15 dark:text-emerald-200">
						<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="h-5 w-5">
							<path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
					<div class="min-w-0">
						<p class="font-black text-emerald-950 dark:text-emerald-100">Archivo listo</p>
						<p class="mt-1 break-words text-sm leading-6 text-emerald-900/80 dark:text-emerald-50/75">
							{prepared.filename} · {formatBytes(prepared.byteLength)}
						</p>
					</div>
				</div>
			</div>

			<div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
				{#each datasets as dataset}
					<div class="min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 dark:border-[#294568] dark:bg-[#13243d]">
						<p class="break-words text-[11px] font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
							{datasetLabels[dataset]}
						</p>
						<p class="mt-1 text-lg font-black text-neutral-950 dark:text-white">{prepared.counts[dataset].toLocaleString('es-AR')}</p>
					</div>
				{/each}
			</div>

			<p class="mt-4 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
				El archivo se intentó descargar automáticamente. Si no apareció, podés iniciarlo de nuevo.
			</p>
			<button
				type="button"
				class="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#6d28d9] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#5b21b6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] sm:w-auto"
				onclick={downloadPreparedFile}
			>
				Descargar otra vez
			</button>
		</div>
	{:else if panelState === 'cancelled'}
		<div
			class={scope === 'patient' ? 'mt-5' : ''}
			role="status"
			aria-live="polite"
			tabindex="-1"
			bind:this={terminalSummary}
		>
			<div class="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-[#294568] dark:bg-[#13243d]">
				<p class="font-black text-neutral-950 dark:text-white">Exportación cancelada</p>
				<p class="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
					No se guardó ningún archivo y los datos del consultorio no se modificaron.
				</p>
			</div>
			<button
				type="button"
				class="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#6d28d9] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#5b21b6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] sm:w-auto"
				onclick={startExport}
			>
				Preparar de nuevo
			</button>
		</div>
	{:else if panelState === 'error'}
		<div
			class={scope === 'patient' ? 'mt-5' : ''}
			role="alert"
			tabindex="-1"
			bind:this={terminalSummary}
		>
			<div class="rounded-2xl border border-red-200 bg-red-50 p-4 outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-400/30 dark:bg-red-400/10">
				<p class="font-black text-red-950 dark:text-red-100">No pudimos preparar el archivo</p>
				<p class="mt-1 break-words text-sm leading-6 text-red-900/80 dark:text-red-50/80">{errorMessage}</p>
			</div>
			{#if retryable}
				<button
					type="button"
					class="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#6d28d9] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#5b21b6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] sm:w-auto"
					onclick={startExport}
				>
					Intentar nuevamente
				</button>
			{:else if errorCode === 'EXPORT_NOT_AUTHENTICATED'}
				<a
					href="/login"
					class="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#6d28d9] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#5b21b6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] sm:w-auto"
				>
					Volver a ingresar
				</a>
			{/if}
		</div>
	{/if}
</div>
