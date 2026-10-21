<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import ClinicalImageViewer from '$lib/components/patients/ClinicalImageViewer.svelte';
	import {
		createClinicalImageThumbnail,
		formatClinicalFileBytes,
		sha256File,
		uploadClinicalFileWithProgress,
		validateClinicalImageFile
	} from '$lib/client/clinical-files';
	import {
		getCachedPatientRadiographOriginal,
		getOrLoadPatientRadiographOriginal,
		invalidatePatientRadiographListing,
		loadPatientRadiographPage,
		removePatientRadiographFromCache,
		type PatientRadiographItem
	} from '$lib/client/patient-radiographs-cache';
	import { formatDate } from '$lib/utils/format';

	type RadiographItem = PatientRadiographItem;

	class ClinicalRequestError extends Error {
		status: number;
		code: string;

		constructor(status: number, code: string, message: string) {
			super(message);
			this.name = 'ClinicalRequestError';
			this.status = status;
			this.code = code;
		}
	}

	let {
		patientId,
		cacheScope,
		initialItems = [],
		canView = false,
		canUpload = false,
		uploadAvailability = 'available',
		canViewTrash = false,
		canTrash = false,
		todayISO,
		demo = false
	}: {
		patientId: string;
		cacheScope: string;
		initialItems?: RadiographItem[];
		canView?: boolean;
		canUpload?: boolean;
		uploadAvailability?: 'available' | 'paused' | 'unavailable' | 'not_permitted';
		canViewTrash?: boolean;
		canTrash?: boolean;
		todayISO: string;
		demo?: boolean;
	} = $props();

	let items = $state<RadiographItem[]>([]);
	let loaded = $state(false);
	let loading = $state(false);
	let loadingMore = $state(false);
	let loadError = $state('');
	let nextCursor = $state<string | null>(null);
	let hasMore = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let cameraInput = $state<HTMLInputElement | null>(null);
	let selectedFile = $state<File | null>(null);
	let clientRequestId = $state('');
	let showUpload = $state(false);
	let uploadBusy = $state(false);
	let uploadProgress = $state(0);
	let uploadStatus = $state('');
	let pendingCompletionId = $state('');
	let pendingThumbnailUploaded = $state(false);
	let message = $state('');
	let errorMessage = $state('');
	let takenAt = $state('');
	let note = $state('');
	let thumbnailFailures = $state<Record<string, boolean>>({});
	let viewerItem = $state<RadiographItem | null>(null);
	let viewerUrl = $state('');
	let viewerBusy = $state(false);
	let viewerError = $state('');
	let viewerTrigger = $state<HTMLElement | null>(null);
	let viewerRequestSequence = 0;
	let trashTarget = $state<RadiographItem | null>(null);
	let trashBusy = $state(false);
	let patientGeneration = 0;
	let activeScope = '';
	let activeDemoItems: RadiographItem[] = [];

	const endpoint = $derived(`/odonto/pacientes/${patientId}/radiografias`);
	$effect(() => {
		const scope = `${cacheScope}:${patientId}:${demo ? 'demo' : 'live'}:${canView ? 'view' : 'hidden'}`;
		const demoItems = initialItems;
		if (scope === activeScope) {
			if (demo && demoItems !== activeDemoItems) {
				activeDemoItems = demoItems;
				items = demoItems;
			}
			return;
		}

		activeScope = scope;
		activeDemoItems = demoItems;
		patientGeneration += 1;
		items = demo ? demoItems : [];
		loaded = demo;
		loading = false;
		loadingMore = false;
		loadError = '';
		nextCursor = null;
		hasMore = false;
		thumbnailFailures = {};
		viewerItem = null;
		viewerRequestSequence += 1;
		viewerUrl = '';
		viewerBusy = false;
		viewerError = '';
		viewerTrigger = null;
		trashTarget = null;
		trashBusy = false;
		message = '';
		errorMessage = '';
		showUpload = false;
		selectedFile = null;
		clientRequestId = '';
		takenAt = '';
		note = '';
		uploadProgress = 0;
		uploadStatus = '';
		pendingCompletionId = '';
		pendingThumbnailUploaded = false;
		resetPicker();

		if (!demo && canView) {
			void loadItems({ generation: patientGeneration });
		}
	});

	async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
		const response = await fetch(url, options);
		const payload = (await response.json().catch(() => ({}))) as T & {
			code?: string;
			message?: string;
		};
		if (!response.ok) {
			throw new ClinicalRequestError(
				response.status,
				String(payload.code ?? ''),
				payload.message || 'No pudimos completar la operación. Probá de nuevo.'
			);
		}
		return payload;
	}

	const discardRejectedCompletion = (error: unknown) => {
		if (
			!(error instanceof ClinicalRequestError) ||
			error.status < 400 ||
			error.status >= 500 ||
			error.status === 429
		) {
			return false;
		}
		showUpload = false;
		selectedFile = null;
		clientRequestId = '';
		pendingCompletionId = '';
		pendingThumbnailUploaded = false;
		takenAt = '';
		note = '';
		uploadProgress = 0;
		resetPicker();
		return true;
	};

	const loadItems = async ({
		append = false,
		generation = patientGeneration,
		refresh = false
	}: { append?: boolean; generation?: number; refresh?: boolean } = {}) => {
		if (demo || !canView || (append ? loadingMore : loading)) return;
		if (append && !nextCursor) return;
		const requestEndpoint = `/odonto/pacientes/${patientId}/radiografias`;
		const requestedCursor = append ? nextCursor : null;
		if (refresh) invalidatePatientRadiographListing(cacheScope);
		append ? (loadingMore = true) : (loading = true);
		loadError = '';
		try {
			const payload = await loadPatientRadiographPage({
				cacheScope,
				endpoint: requestEndpoint,
				cursor: requestedCursor
			});
			if (generation !== patientGeneration) return;
			const incoming = Array.isArray(payload.items) ? payload.items : [];
			if (append) {
				const existing = new Set(items.map((item) => item.id));
				items = [...items, ...incoming.filter((item) => !existing.has(item.id))];
			} else {
				items = incoming;
			}
			hasMore = payload.has_more;
			nextCursor = payload.next_cursor;
			loaded = true;
		} catch (error) {
			if (generation !== patientGeneration) return;
			loadError = error instanceof Error ? error.message : 'No pudimos cargar los documentos.';
		} finally {
			if (generation === patientGeneration) {
				append ? (loadingMore = false) : (loading = false);
			}
		}
	};

	const resetPicker = () => {
		if (fileInput) fileInput.value = '';
		if (cameraInput) cameraInput.value = '';
	};

	const closeUpload = () => {
		if (uploadBusy) return;
		showUpload = false;
		selectedFile = null;
		clientRequestId = '';
		takenAt = '';
		note = '';
		uploadProgress = 0;
		uploadStatus = '';
		pendingCompletionId = '';
		pendingThumbnailUploaded = false;
		resetPicker();
	};

	const chooseFile = (mode: 'files' | 'camera', retry?: RadiographItem) => {
		if (!canUpload || uploadBusy) return;
		errorMessage = '';
		message = '';
		pendingCompletionId = '';
		pendingThumbnailUploaded = false;
		clientRequestId = '';
		takenAt = retry?.taken_at ?? '';
		note = retry?.note ?? '';
		(mode === 'camera' ? cameraInput : fileInput)?.click();
	};

	const handleFile = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (!file) return;
		const validation = await validateClinicalImageFile(file);
		if (!validation.ok) {
			errorMessage = validation.message;
			input.value = '';
			return;
		}
		selectedFile = file;
		clientRequestId = crypto.randomUUID();
		showUpload = true;
	};

	const notifyFailedUpload = async (
		radiographId: string,
		reason: string,
		requestEndpoint = endpoint
	) => {
		try {
			await fetch(`${requestEndpoint}/${radiographId}/failed`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ reason })
			});
		} catch {
			// El error principal ya queda visible; este estado es de mejor esfuerzo.
		}
	};

	const upload = async () => {
		if (!selectedFile || uploadBusy || !canUpload) return;
		const file = selectedFile;
		const requestEndpoint = endpoint;
		const generation = patientGeneration;
		if (takenAt && takenAt > todayISO) {
			errorMessage = 'La fecha del estudio no puede estar en el futuro.';
			return;
		}

		uploadBusy = true;
		uploadProgress = 0;
		errorMessage = '';
		message = '';
		const completionId = pendingCompletionId;
		const thumbnailWasUploaded = pendingThumbnailUploaded;
		if (completionId) {
			try {
				uploadStatus = 'Confirmando…';
				uploadProgress = 97;
				await fetchJson(`${requestEndpoint}/${completionId}/complete`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ thumbnailUploaded: thumbnailWasUploaded })
				});
				if (generation === patientGeneration) {
					message = 'Documento guardado en la ficha del paciente.';
					showUpload = false;
					selectedFile = null;
					clientRequestId = '';
					pendingCompletionId = '';
					pendingThumbnailUploaded = false;
					resetPicker();
					await loadItems({ generation, refresh: true });
				}
			} catch (error) {
				if (generation === patientGeneration) {
					errorMessage = error instanceof Error ? error.message : 'No pudimos confirmar la carga.';
					discardRejectedCompletion(error);
				}
			} finally {
				uploadBusy = false;
				if (generation === patientGeneration) uploadStatus = '';
			}
			return;
		}
		let radiographId = '';
		let originalUploadStarted = false;
		let completionStarted = false;
		try {
			const validation = await validateClinicalImageFile(file);
			if (!validation.ok) throw new Error(validation.message);

			uploadStatus = 'Preparando el archivo…';
			const sha256 = await sha256File(file);
			const thumbnail = validation.mimeType==='application/pdf'?null:await createClinicalImageThumbnail(file);
			const started = await fetchJson<{
				id: string;
				upload_url?: string;
				thumbnail_upload_url?: string;
				already_complete?: boolean;
			}>(`${requestEndpoint}/uploads`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					clientRequestId: clientRequestId || (clientRequestId = crypto.randomUUID()),
					originalFilename: file.name,
					mimeType: validation.mimeType,
					bytes: file.size,
					sha256,
					takenAt: takenAt || null,
					note: note.trim() || null
				})
			});
			radiographId = started.id;
			if (started.already_complete) {
				if (generation === patientGeneration) {
					message = 'El archivo ya estaba guardado.';
					showUpload = false;
					selectedFile = null;
					clientRequestId = '';
					resetPicker();
					await loadItems({ generation, refresh: true });
				}
				return;
			}
			if (!started.upload_url) throw new Error('No pudimos preparar la carga. Probá de nuevo.');

			uploadStatus = 'Subiendo archivo…';
			originalUploadStarted = true;
			await uploadClinicalFileWithProgress({
				url: started.upload_url,
				file,
				onProgress: (progress) => {
					if (generation === patientGeneration) uploadProgress = Math.round(progress * 0.9);
				}
			});

			let thumbnailUploaded = false;
			if (thumbnail && started.thumbnail_upload_url) {
				uploadStatus = 'Preparando vista previa…';
				try {
					await uploadClinicalFileWithProgress({
						url: started.thumbnail_upload_url,
						file: thumbnail,
						onProgress: (progress) => (uploadProgress = 90 + Math.round(progress * 0.05))
					});
					thumbnailUploaded = true;
				} catch {
					thumbnailUploaded = false;
				}
			}

			uploadStatus = 'Confirmando…';
			uploadProgress = 97;
			completionStarted = true;
			pendingCompletionId = radiographId;
			pendingThumbnailUploaded = thumbnailUploaded;
			await fetchJson(`${requestEndpoint}/${radiographId}/complete`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ thumbnailUploaded })
			});
			if (generation === patientGeneration) {
				uploadProgress = 100;
				message = 'Documento guardado en la ficha del paciente.';
				showUpload = false;
				selectedFile = null;
				clientRequestId = '';
				pendingCompletionId = '';
				pendingThumbnailUploaded = false;
				takenAt = '';
				note = '';
				resetPicker();
				await loadItems({ generation, refresh: true });
			}
		} catch (error) {
			if (radiographId && originalUploadStarted && !completionStarted) {
				void notifyFailedUpload(radiographId, 'client_upload_failed', requestEndpoint);
			}
			if (generation === patientGeneration) {
				errorMessage = error instanceof Error ? error.message : 'No pudimos guardar el archivo.';
				if (completionStarted) discardRejectedCompletion(error);
			}
		} finally {
			uploadBusy = false;
			if (generation === patientGeneration) uploadStatus = '';
		}
	};

	const requestViewerAccess = async (item: RadiographItem) => {
		const generation = patientGeneration;
		const requestEndpoint = endpoint;
		const sequence = ++viewerRequestSequence;
		viewerUrl = '';
		viewerError = '';
		viewerBusy = true;
		try {
            if(item.mime_type==='application/pdf'){const payload=await fetchJson<{url:string}>(`${requestEndpoint}/${item.id}/access-grants`,{method:'POST'});if(generation===patientGeneration)window.location.assign(payload.url);return;}
			const url = await getOrLoadPatientRadiographOriginal({
				cacheScope,
				radiographId: item.id,
				load: async (signal) => {
					const payload = await fetchJson<{ url: string }>(
						`${requestEndpoint}/${item.id}/access-grants`,
						{ method: 'POST', signal }
					);
					const response = await fetch(payload.url, {
						signal,
						credentials: 'omit',
						cache: 'no-store',
						referrerPolicy: 'no-referrer'
					});
					if (!response.ok) {
						throw new Error('No pudimos descargar la imagen. Probá de nuevo.');
					}
					const blob = await response.blob();
					if (blob.type && !blob.type.startsWith('image/')) {
						throw new Error('El archivo recibido no es una imagen válida. Probá de nuevo.');
					}
					return blob;
				}
			});
			if (generation === patientGeneration && sequence === viewerRequestSequence) {
				viewerUrl = url;
			}
		} catch (error) {
			if (generation === patientGeneration && sequence === viewerRequestSequence) {
				viewerError = error instanceof Error ? error.message : 'No pudimos abrir la imagen.';
			}
		} finally {
			if (generation === patientGeneration && sequence === viewerRequestSequence) {
				viewerBusy = false;
			}
		}
	};

	const openViewer = (item: RadiographItem, trigger: HTMLElement) => {
        if(item.mime_type==='application/pdf'){void requestViewerAccess(item);return;}
		if (demo) {
			errorMessage = 'La vista de imágenes no está disponible en el modo de demostración.';
			return;
		}
		if (item.integrity_status !== 'ok') {
			errorMessage = 'El archivo no está disponible. Informá el problema para que podamos revisarlo.';
			return;
		}
		viewerTrigger = trigger;
		viewerItem = item;
		const cachedUrl = getCachedPatientRadiographOriginal(cacheScope, item.id);
		if (cachedUrl) {
			viewerRequestSequence += 1;
			viewerUrl = cachedUrl;
			viewerBusy = false;
			viewerError = '';
		} else {
			void requestViewerAccess(item);
		}
	};

	const retryViewer = () => {
		if (viewerItem) void requestViewerAccess(viewerItem);
	};

	const closeViewer = () => {
		const trigger = viewerTrigger;
		viewerRequestSequence += 1;
		viewerItem = null;
		viewerUrl = '';
		viewerBusy = false;
		viewerError = '';
		viewerTrigger = null;
		queueMicrotask(() => trigger?.focus());
	};

	const moveToTrash = async () => {
		if (!trashTarget || trashBusy) return;
		const target = trashTarget;
		const generation = patientGeneration;
		const requestEndpoint = endpoint;
		trashBusy = true;
		errorMessage = '';
		try {
			await fetchJson(`${requestEndpoint}/${target.id}/trash`, { method: 'POST' });
			if (generation === patientGeneration) {
				removePatientRadiographFromCache(cacheScope, target.id);
				items = items.filter((item) => item.id !== target.id);
				message = 'Imagen movida a la papelera. Podés restaurarla cuando la necesites.';
				trashTarget = null;
			}
		} catch (error) {
			if (generation === patientGeneration) {
				errorMessage = error instanceof Error ? error.message : 'No pudimos mover el documento a la papelera.';
			}
		} finally {
			if (generation === patientGeneration) trashBusy = false;
		}
	};

	const titleFor = (item: Partial<RadiographItem>) => item.note?.trim() || item.original_filename || 'Documento clínico';
	const metadataFor = (item: RadiographItem) =>
		[
			item.taken_at || item.ready_at || item.created_at
				? formatDate(item.taken_at || item.ready_at || item.created_at)
				: '',
			item.mime_type === 'application/pdf' ? 'PDF' : item.mime_type === 'image/png' ? 'PNG' : 'JPG',
			formatClinicalFileBytes(item.bytes)
		]
			.filter(Boolean)
			.join(' · ');
</script>

<section class="ux-card" aria-labelledby="clinical-images-title">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<h2 id="clinical-images-title" class="ux-section-title">Estudios y documentos</h2>
			<p class="mt-2 max-w-2xl text-sm text-white/60">
				El equipo autorizado puede consultarlos desde esta ficha. Los originales permanecen privados.
			</p>
		</div>
		{#if canUpload}
			<div class="flex flex-col gap-2 sm:flex-row">
				<input
					bind:this={cameraInput}
					type="file"
					accept="image/jpeg,image/png"
					capture="environment"
					class="sr-only"
					onchange={handleFile}
				/>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/jpeg,image/png,application/pdf"
					class="sr-only"
					onchange={handleFile}
				/>
				<button type="button" class="ux-btn-secondary" disabled={uploadBusy || demo} onclick={() => chooseFile('camera')}>
					Usar cámara
				</button>
				<button type="button" class="ux-btn-primary" disabled={uploadBusy || demo} onclick={() => chooseFile('files')}>
					Añadir documento
				</button>
			</div>
		{/if}
	</div>
	{#if canView && uploadAvailability === 'paused'}
		<p class="ux-alert mt-4">La carga de documentos está pausada. Podés consultar los documentos guardados.</p>
	{:else if canView && uploadAvailability === 'unavailable'}
		<p class="ux-alert mt-4" role="alert">No pudimos consultar la disponibilidad para nuevas cargas. Recargá para volver a intentar; los documentos guardados siguen disponibles.</p>
	{/if}

	{#if !canView}
		<p class="ux-alert mt-5">Tu rol no permite ver documentos clínicos.</p>
	{:else}
		{#if demo}
			<p class="ux-alert mt-5">En el modo de demostración podés recorrer la ficha, pero no cargar ni abrir archivos.</p>
		{/if}
		{#if errorMessage}
			<div class="mt-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100" role="alert">
				<p>{errorMessage}</p>
				<button type="button" class="font-semibold underline" onclick={() => (errorMessage = '')}>Cerrar</button>
			</div>
		{/if}
		{#if message}
			<div class="mt-5 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-100" role="status">
				<p>{message}</p>
				<button type="button" class="font-semibold underline" onclick={() => (message = '')}>Cerrar</button>
			</div>
		{/if}

		{#if loading}
			<div class="mt-6 grid gap-3" aria-label="Cargando documentos">
				{#each [1, 2, 3] as placeholder}
					<div class="h-24 animate-pulse rounded-xl bg-white/5" aria-hidden="true"></div>
				{/each}
			</div>
		{:else if loadError}
			<div class="ux-alert mt-6">
				<p>{loadError}</p>
				<button type="button" class="mt-3 font-semibold underline" onclick={() => loadItems()}>Reintentar</button>
			</div>
		{:else if loaded && items.length === 0}
			<div class="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-5 py-8 text-center">
				<p class="text-base font-semibold text-white">Todavía no hay documentos en esta ficha</p>
				<p class="mx-auto mt-2 max-w-lg text-sm text-white/55">
					{#if canUpload && !demo}
						Podés adjuntar imágenes y estudios en JPG, PNG o PDF, de hasta 5 MB.
					{:else}
						Los documentos guardados aparecerán en esta ficha.
					{/if}
				</p>
				{#if canUpload && !demo}
					<button type="button" class="ux-btn-primary mt-5" onclick={() => chooseFile('files')}>Añadir el primer documento</button>
				{/if}
			</div>
		{:else}
			<div class="mt-6 grid gap-3">
				{#each items as item (item.id)}
					<article class="flex min-w-0 flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center">
						<div class="h-20 w-full shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#0b1626] sm:w-24">
							{#if item.thumbnail_url && !thumbnailFailures[item.id]}
								<img
									src={item.thumbnail_url}
									alt=""
									class="h-full w-full object-cover"
									loading="lazy"
									onerror={() => (thumbnailFailures = { ...thumbnailFailures, [item.id]: true })}
								/>
							{:else}
								<div class="grid h-full place-items-center text-white/45" aria-hidden="true">
									<svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
										<rect x="3" y="4" width="18" height="16" rx="2" />
										<circle cx="9" cy="10" r="1.5" />
										<path stroke-linecap="round" stroke-linejoin="round" d="M21 16l-5-4-4 3-3-2-4 3" />
									</svg>
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<h3 class="break-words text-sm font-semibold text-white" title={item.original_filename ?? ''}>{titleFor(item)}</h3>
 {#if item.source==='patient'}<p class="text-xs text-white/75">Adjuntado desde el enlace del turno</p>{/if}
							<p class="mt-1 text-xs text-white/50">{metadataFor(item)}</p>
							{#if item.status === 'ready' && item.integrity_status !== 'ok'}
								<p class="mt-2 text-xs font-semibold text-red-300">Archivo temporalmente no disponible</p>
							{:else if item.status === 'failed'}
								<p class="mt-2 text-xs font-semibold text-red-300">La carga no se completó</p>
							{:else if item.status === 'uploading'}
								<p class="mt-2 text-xs font-semibold text-amber-200">Carga pendiente</p>
							{/if}
						</div>
						<div class="flex flex-col gap-2 sm:flex-row">
							{#if item.status === 'ready'}
								<button type="button" class="ux-btn-primary" onclick={(event) => openViewer(item, event.currentTarget)}>{item.mime_type==='application/pdf'?'Descargar PDF':'Ver imagen'}</button>
							{:else if canUpload && !demo}
								<button type="button" class="ux-btn-secondary" onclick={() => chooseFile('files', item)}>Reintentar</button>
							{/if}
							{#if canTrash && item.status === 'ready'}
								<button type="button" class="ux-btn-secondary" onclick={() => (trashTarget = item)}>Mover a papelera</button>
							{/if}
						</div>
					</article>
				{/each}
			</div>
			{#if hasMore}
				<div class="mt-5 flex justify-center">
					<button type="button" class="ux-btn-secondary" disabled={loadingMore} onclick={() => loadItems({ append: true })}>
						{loadingMore ? 'Cargando…' : 'Ver más documentos'}
					</button>
				</div>
			{/if}
		{/if}

		<div class="mt-6 flex flex-col gap-3 border-t border-white/10 pt-5 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
			<p>El acceso se controla con los permisos de la ficha del paciente.</p>
			{#if canViewTrash}
				<a class="font-semibold text-white/75 hover:text-white hover:underline" href="/odonto/pacientes/papelera">Abrir papelera de documentos</a>
			{/if}
		</div>
	{/if}
</section>

<Modal open={showUpload} title="Añadir documento clínico" closable={!uploadBusy} on:close={closeUpload}>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<div class="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-[#1f3554] dark:bg-[#122641]">
			<p class="break-words font-semibold text-neutral-900 dark:text-white">{selectedFile?.name ?? 'Imagen seleccionada'}</p>
			<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">{formatClinicalFileBytes(selectedFile?.size)}</p>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<label for="clinical-image-date" class="text-xs font-semibold">Fecha de toma (opcional)</label>
				<input id="clinical-image-date" type="date" max={todayISO} bind:value={takenAt} disabled={uploadBusy} class="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-[#1f3554] dark:bg-[#0b1626]" />
			</div>
			<div class="space-y-2">
				<label for="clinical-image-note" class="text-xs font-semibold">Descripción (opcional)</label>
				<input id="clinical-image-note" maxlength="500" placeholder="Ej: Panorámica inicial" bind:value={note} disabled={uploadBusy} class="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-[#1f3554] dark:bg-[#0b1626]" />
			</div>
		</div>
		{#if errorMessage}
			<p class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100" role="alert">{errorMessage}</p>
		{/if}
		{#if uploadBusy}
			<div class="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 dark:border-primary-400/30 dark:bg-primary-500/10">
				<div class="flex items-center justify-between gap-3 text-xs font-semibold">
					<span>{uploadStatus}</span>
					<span>{uploadProgress}%</span>
				</div>
				<div class="mt-2 h-2 overflow-hidden rounded-full bg-primary-100 dark:bg-white/10" role="progressbar" aria-label="Progreso de carga" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadProgress}>
					<div class="h-full rounded-full bg-primary-600 transition-[width]" style={`width: ${uploadProgress}%`}></div>
				</div>
				<p class="mt-2 text-xs text-neutral-600 dark:text-neutral-300">No cierres esta pantalla hasta que termine.</p>
			</div>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<button type="button" class="ux-btn-secondary" disabled={uploadBusy} onclick={closeUpload}>Cancelar</button>
			<button type="button" class="ux-btn-primary" disabled={!selectedFile || uploadBusy} onclick={upload}>
				{uploadBusy ? 'Guardando…' : pendingCompletionId ? 'Reintentar confirmación' : 'Guardar documento'}
			</button>
		</div>
	</div>
</Modal>

<ClinicalImageViewer
	open={Boolean(viewerItem)}
	title={titleFor(viewerItem ?? {})}
	metadata={viewerItem ? metadataFor(viewerItem) : ''}
	imageUrl={viewerUrl}
	alt={viewerItem?.note || 'Imagen clínica del paciente'}
	busy={viewerBusy}
	error={viewerError}
	onclose={closeViewer}
	onretry={retryViewer}
/>

<Modal open={Boolean(trashTarget)} title="Mover documento a la papelera" dismissible={!trashBusy} on:close={() => !trashBusy && (trashTarget = null)}>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>El documento dejará de verse en la ficha, pero no se borrará físicamente. El dueño o un administrador podrá restaurarla desde la papelera.</p>
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<button type="button" class="ux-btn-secondary" disabled={trashBusy} onclick={() => (trashTarget = null)}>Cancelar</button>
			<button type="button" class="ux-btn-primary" disabled={trashBusy} onclick={moveToTrash}>{trashBusy ? 'Moviendo…' : 'Mover a papelera'}</button>
		</div>
	</div>
</Modal>
