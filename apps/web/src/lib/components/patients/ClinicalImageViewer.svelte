<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		CLINICAL_VIEWER_MAX_ZOOM,
		CLINICAL_VIEWER_MIN_ZOOM,
		clampClinicalViewerPan,
		transformClinicalViewerAroundAnchor,
		type ClinicalViewerTransform
	} from '$lib/client/clinical-image-viewer';

	type Point = { x: number; y: number };
	type PinchStart = ClinicalViewerTransform & {
		distance: number;
		anchorX: number;
		anchorY: number;
	};

	let {
		open = false,
		title = 'Imagen clínica',
		metadata = '',
		imageUrl = '',
		alt = 'Imagen clínica del paciente',
		busy = false,
		error = '',
		onclose,
		onretry
	} = $props<{
		open?: boolean;
		title?: string;
		metadata?: string;
		imageUrl?: string;
		alt?: string;
		busy?: boolean;
		error?: string;
		onclose: () => void;
		onretry?: () => void;
	}>();

	let dialogElement = $state<HTMLElement | null>(null);
	let stageElement = $state<HTMLElement | null>(null);
	let zoom = $state(CLINICAL_VIEWER_MIN_ZOOM);
	let panX = $state(0);
	let panY = $state(0);
	let dragging = $state(false);
	const pointers = new Map<number, Point>();
	let dragPoint: Point | null = null;
	let pinchStart: PinchStart | null = null;
	let imageNaturalWidth = $state(0);
	let imageNaturalHeight = $state(0);
	let fittedImageWidth = $state(0);
	let fittedImageHeight = $state(0);
	let renderError = $state('');

	const zoomed = $derived(zoom > CLINICAL_VIEWER_MIN_ZOOM + 0.001);
	const zoomPercent = $derived(Math.round(zoom * 100));
	const zoomLabel = $derived(zoomed ? `${zoomPercent}%` : 'Ajustada');
	const visibleError = $derived(error || renderError);

	$effect(() => {
		if (!open || typeof document === 'undefined') return;

		resetView();
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		void tick().then(() => dialogElement?.focus());

		return () => {
			document.body.style.overflow = previousOverflow;
			clearGesture();
		};
	});

	$effect(() => {
		if (!open) return;
		imageUrl;
		renderError = '';
		imageNaturalWidth = 0;
		imageNaturalHeight = 0;
	});

	$effect(() => {
		if (!open || !stageElement || typeof ResizeObserver === 'undefined') return;
		imageNaturalWidth;
		imageNaturalHeight;
		untrack(updateFittedImageSize);
		const observer = new ResizeObserver(updateFittedImageSize);
		observer.observe(stageElement);
		return () => observer.disconnect();
	});

	function fittedSize(width: number, height: number) {
		if (!width || !height || !imageNaturalWidth || !imageNaturalHeight) {
			return { width, height };
		}
		const ratio = Math.min(width / imageNaturalWidth, height / imageNaturalHeight);
		return {
			width: imageNaturalWidth * ratio,
			height: imageNaturalHeight * ratio
		};
	}

	function updateFittedImageSize() {
		const rect = stageElement?.getBoundingClientRect();
		const fitted = fittedSize(rect?.width ?? 0, rect?.height ?? 0);
		fittedImageWidth = fitted.width;
		fittedImageHeight = fitted.height;
		const bounded = clampClinicalViewerPan(
			panX,
			panY,
			zoom,
			rect?.width ?? 0,
			rect?.height ?? 0,
			fitted.width,
			fitted.height
		);
		panX = bounded.panX;
		panY = bounded.panY;
	}

	function stageSize() {
		const rect = stageElement?.getBoundingClientRect();
		const width = rect?.width ?? 0;
		const height = rect?.height ?? 0;
		const fitted = fittedSize(width, height);
		return {
			width,
			height,
			left: rect?.left ?? 0,
			top: rect?.top ?? 0,
			contentWidth: fitted.width,
			contentHeight: fitted.height
		};
	}

	function applyTransform(transform: ClinicalViewerTransform) {
		zoom = transform.zoom;
		panX = transform.panX;
		panY = transform.panY;
	}

	function resetView() {
		zoom = CLINICAL_VIEWER_MIN_ZOOM;
		panX = 0;
		panY = 0;
		dragging = false;
		clearGesture();
	}

	function clearGesture() {
		pointers.clear();
		dragPoint = null;
		pinchStart = null;
		dragging = false;
	}

	function zoomAround(nextZoom: number, anchorX?: number, anchorY?: number) {
		const size = stageSize();
		if (!size.width || !size.height) return;
		const pointX = anchorX ?? size.width / 2;
		const pointY = anchorY ?? size.height / 2;
		applyTransform(
			transformClinicalViewerAroundAnchor({
				zoom,
				panX,
				panY,
				nextZoom,
				anchorX: pointX,
				anchorY: pointY,
				width: size.width,
				height: size.height,
				contentWidth: size.contentWidth,
				contentHeight: size.contentHeight
			})
		);
	}

	function zoomIn() {
		zoomAround(zoom * 1.4);
	}

	function zoomOut() {
		zoomAround(zoom / 1.4);
	}

	function panBy(deltaX: number, deltaY: number) {
		const size = stageSize();
		const nextPan = clampClinicalViewerPan(
			panX + deltaX,
			panY + deltaY,
			zoom,
			size.width,
			size.height,
			size.contentWidth,
			size.contentHeight
		);
		panX = nextPan.panX;
		panY = nextPan.panY;
	}

	function handleWheel(event: WheelEvent) {
		if (!imageUrl || busy || visibleError) return;
		event.preventDefault();
		const size = stageSize();
		const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
		zoomAround(zoom * factor, event.clientX - size.left, event.clientY - size.top);
	}

	function midpoint(points: Point[]): Point {
		return {
			x: (points[0].x + points[1].x) / 2,
			y: (points[0].y + points[1].y) / 2
		};
	}

	function distance(points: Point[]): number {
		return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
	}

	function beginPinch() {
		const points = Array.from(pointers.values()).slice(0, 2);
		if (points.length < 2) return;
		const size = stageSize();
		const center = midpoint(points);
		pinchStart = {
			zoom,
			panX,
			panY,
			distance: Math.max(1, distance(points)),
			anchorX: center.x - size.left,
			anchorY: center.y - size.top
		};
	}

	function handlePointerDown(event: PointerEvent) {
		if (!imageUrl || busy || visibleError || (event.pointerType === 'mouse' && event.button !== 0)) return;
		event.preventDefault();
		stageElement?.setPointerCapture(event.pointerId);
		const point = { x: event.clientX, y: event.clientY };
		pointers.set(event.pointerId, point);

		if (pointers.size === 1) {
			dragPoint = point;
			dragging = zoomed;
		} else if (pointers.size === 2) {
			beginPinch();
			dragging = true;
		}
	}

	function handlePointerMove(event: PointerEvent) {
		if (!pointers.has(event.pointerId)) return;
		event.preventDefault();
		const point = { x: event.clientX, y: event.clientY };
		pointers.set(event.pointerId, point);

		if (pointers.size >= 2) {
			if (!pinchStart) beginPinch();
			if (!pinchStart) return;
			const points = Array.from(pointers.values()).slice(0, 2);
			const size = stageSize();
			const currentMidpoint = midpoint(points);
			applyTransform(
				transformClinicalViewerAroundAnchor({
					zoom: pinchStart.zoom,
					panX: pinchStart.panX,
					panY: pinchStart.panY,
					nextZoom: pinchStart.zoom * (distance(points) / pinchStart.distance),
					anchorX: pinchStart.anchorX,
					anchorY: pinchStart.anchorY,
					targetX: currentMidpoint.x - size.left,
					targetY: currentMidpoint.y - size.top,
					width: size.width,
					height: size.height,
					contentWidth: size.contentWidth,
					contentHeight: size.contentHeight
				})
			);
			return;
		}

		if (dragPoint && zoomed) {
			panBy(point.x - dragPoint.x, point.y - dragPoint.y);
			dragPoint = point;
			dragging = true;
		}
	}

	function handlePointerEnd(event: PointerEvent) {
		pointers.delete(event.pointerId);
		if (stageElement?.hasPointerCapture(event.pointerId)) {
			stageElement.releasePointerCapture(event.pointerId);
		}
		pinchStart = null;
		const remainingPoint = pointers.values().next().value as Point | undefined;
		dragPoint = remainingPoint ?? null;
		dragging = Boolean(remainingPoint) && zoomed;
	}

	function trapFocus(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !dialogElement) return;
		const focusable = Array.from(
			dialogElement.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
			)
		);
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogElement)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function handleDialogKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
			return;
		}
		if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			zoomIn();
			return;
		}
		if (event.key === '-' || event.key === '_') {
			event.preventDefault();
			zoomOut();
			return;
		}
		if (event.key === '0') {
			event.preventDefault();
			resetView();
			return;
		}
		if (zoomed && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
			event.preventDefault();
			const step = event.shiftKey ? 100 : 40;
			if (event.key === 'ArrowLeft') panBy(step, 0);
			if (event.key === 'ArrowRight') panBy(-step, 0);
			if (event.key === 'ArrowUp') panBy(0, step);
			if (event.key === 'ArrowDown') panBy(0, -step);
			return;
		}
		trapFocus(event);
	}

	function handleImageLoad(event: Event) {
		const image = event.currentTarget as HTMLImageElement;
		imageNaturalWidth = image.naturalWidth;
		imageNaturalHeight = image.naturalHeight;
		renderError = '';
		resetView();
		updateFittedImageSize();
	}

	function handleImageError() {
		renderError = 'La imagen no terminó de cargar. Probá abrirla nuevamente.';
	}

	function retryImage() {
		renderError = '';
		onretry?.();
	}
</script>

{#if open}
	<div class="clinical-viewer-overlay">
		<div
			bind:this={dialogElement}
			class="clinical-viewer-shell"
			role="dialog"
			aria-modal="true"
			aria-labelledby="clinical-viewer-title"
			aria-describedby="clinical-viewer-help"
			tabindex="-1"
			onkeydown={handleDialogKeydown}
		>
			<header class="clinical-viewer-header">
				<div class="min-w-0">
					<p class="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-cyan-200/70">Visor clínico</p>
					<h2 id="clinical-viewer-title" class="mt-0.5 truncate text-base font-semibold text-white sm:text-lg">{title}</h2>
					{#if metadata}
						<p class="mt-0.5 truncate text-xs text-slate-400">{metadata}</p>
					{/if}
				</div>
				<button type="button" class="clinical-viewer-close" aria-label="Cerrar visor" title="Cerrar (Esc)" onclick={onclose}>
					<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
						<path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</header>

			<div
				bind:this={stageElement}
				class:clinical-viewer-stage-zoomed={zoomed}
				class:clinical-viewer-stage-dragging={dragging}
				class="clinical-viewer-stage"
				role="group"
				aria-label="Área de observación de la imagen"
				onwheel={handleWheel}
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerEnd}
				onpointercancel={handlePointerEnd}
				onlostpointercapture={handlePointerEnd}
			>
				{#if busy}
					<div class="clinical-viewer-state" role="status">
						<span class="clinical-viewer-spinner" aria-hidden="true"></span>
						<p>Abriendo el original privado…</p>
					</div>
				{:else if visibleError}
					<div class="clinical-viewer-error" role="alert">
						<p class="font-semibold text-white">No pudimos mostrar la imagen</p>
						<p class="mt-1 text-sm text-slate-300">{visibleError}</p>
						{#if onretry}
							<button type="button" class="clinical-viewer-retry" onclick={retryImage}>Reintentar</button>
						{/if}
					</div>
				{:else if imageUrl}
					<div
						class="clinical-viewer-image-frame"
						style={`width: ${fittedImageWidth}px; height: ${fittedImageHeight}px; transform: translate3d(calc(-50% + ${panX}px), calc(-50% + ${panY}px), 0);`}
					>
						<img
							src={imageUrl}
							{alt}
							class="clinical-viewer-image"
							style={`transform: scale(${zoom});`}
							draggable="false"
							onload={handleImageLoad}
							onerror={handleImageError}
						/>
					</div>
				{/if}
			</div>

			<footer class="clinical-viewer-footer">
				<p id="clinical-viewer-help" class="clinical-viewer-help">
					{zoomed ? 'Arrastrá la imagen para recorrer el detalle.' : 'Usá la lupa o la rueda para examinar detalles.'}
				</p>

				<div class="clinical-viewer-desktop-controls" role="group" aria-label="Controles de zoom">
					<button type="button" class="clinical-viewer-fit" disabled={!zoomed} onclick={resetView}>
						<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4" />
						</svg>
						Ajustar
					</button>
					<span class="clinical-viewer-divider" aria-hidden="true"></span>
					<button
						type="button"
						class="clinical-viewer-zoom-button"
						aria-label="Alejar imagen"
						title="Alejar (−)"
						disabled={zoom <= CLINICAL_VIEWER_MIN_ZOOM + 0.001}
						onclick={zoomOut}
					>
						<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<circle cx="10.5" cy="10.5" r="6.5" />
							<path stroke-linecap="round" d="M7.5 10.5h6M15.5 15.5L21 21" />
						</svg>
					</button>
					<output class="clinical-viewer-zoom-value" aria-live="polite" aria-label="Nivel de zoom">{zoomLabel}</output>
					<button
						type="button"
						class="clinical-viewer-zoom-button"
						aria-label="Acercar imagen"
						title="Acercar (+)"
						disabled={zoom >= CLINICAL_VIEWER_MAX_ZOOM - 0.001}
						onclick={zoomIn}
					>
						<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<circle cx="10.5" cy="10.5" r="6.5" />
							<path stroke-linecap="round" d="M7.5 10.5h6M10.5 7.5v6M15.5 15.5L21 21" />
						</svg>
					</button>
				</div>

				<div class="clinical-viewer-touch-controls">
					<div class="flex min-w-0 items-center gap-2">
						<svg class="h-5 w-5 shrink-0 text-cyan-200/80" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8 13V6a2 2 0 114 0v5-3a2 2 0 114 0v4-2a2 2 0 114 0v4c0 4-2.8 7-7 7h-1.2c-2.2 0-4.3-1-5.6-2.8L4.5 15a2 2 0 012.8-.3L8 15.3" />
						</svg>
						<p class="truncate text-xs text-slate-300">
							{zoomed ? 'Pellizcá y arrastrá' : 'Pellizcá para ampliar'}
						</p>
					</div>
					<div class="flex shrink-0 items-center gap-2">
						<output class="clinical-viewer-touch-zoom" aria-live="polite" aria-label="Nivel de zoom">{zoomLabel}</output>
						{#if zoomed}
							<button type="button" class="clinical-viewer-touch-reset" onclick={resetView}>Restablecer</button>
						{/if}
					</div>
				</div>
			</footer>
		</div>
	</div>
{/if}

<style>
	.clinical-viewer-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		place-items: center;
		padding: 0.75rem;
		background: rgb(0 4 10 / 0.94);
		backdrop-filter: blur(10px);
	}

	.clinical-viewer-shell {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		width: min(112.5rem, calc(100vw - 1.5rem));
		min-width: 0;
		max-width: 100%;
		height: calc(100dvh - 1.5rem);
		overflow: hidden;
		border: 1px solid rgb(148 163 184 / 0.2);
		border-radius: 1.25rem;
		background: #050b13;
		box-shadow: 0 28px 90px rgb(0 0 0 / 0.58);
		outline: none;
	}

	.clinical-viewer-header,
	.clinical-viewer-footer {
		position: relative;
		z-index: 2;
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 1rem;
		background: rgb(9 18 31 / 0.97);
	}

	.clinical-viewer-header {
		min-height: 4.5rem;
		justify-content: space-between;
		border-bottom: 1px solid rgb(148 163 184 / 0.15);
		padding: 0.75rem 1rem;
	}

	.clinical-viewer-footer {
		min-height: 4rem;
		justify-content: space-between;
		border-top: 1px solid rgb(148 163 184 / 0.15);
		padding: 0.65rem 1rem;
	}

	.clinical-viewer-close,
	.clinical-viewer-zoom-button {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid rgb(148 163 184 / 0.2);
		border-radius: 999px;
		color: #e2e8f0;
		background: rgb(255 255 255 / 0.06);
		transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
	}

	.clinical-viewer-close:hover,
	.clinical-viewer-zoom-button:hover:not(:disabled) {
		border-color: rgb(103 232 249 / 0.5);
		color: white;
		background: rgb(34 211 238 / 0.12);
	}

	.clinical-viewer-close:focus-visible,
	.clinical-viewer-zoom-button:focus-visible,
	.clinical-viewer-fit:focus-visible,
	.clinical-viewer-touch-reset:focus-visible,
	.clinical-viewer-retry:focus-visible {
		outline: 2px solid #67e8f9;
		outline-offset: 2px;
	}

	.clinical-viewer-close svg,
	.clinical-viewer-zoom-button svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	.clinical-viewer-stage {
		position: relative;
		min-height: 0;
		overflow: hidden;
		background:
			radial-gradient(circle at center, rgb(20 31 45 / 0.5), transparent 55%),
			#010307;
		touch-action: none;
		overscroll-behavior: contain;
		user-select: none;
		-webkit-user-select: none;
	}

	.clinical-viewer-stage-zoomed {
		cursor: grab;
	}

	.clinical-viewer-stage-dragging {
		cursor: grabbing;
	}

	.clinical-viewer-image-frame {
		position: absolute;
		left: 50%;
		top: 50%;
		pointer-events: none;
		will-change: transform;
	}

	.clinical-viewer-image {
		display: block;
		width: 100%;
		height: 100%;
		transform-origin: center center;
		will-change: transform;
		pointer-events: none;
		-webkit-user-drag: none;
	}

	.clinical-viewer-state,
	.clinical-viewer-error {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		place-items: center;
		padding: 1.5rem;
		text-align: center;
		color: #cbd5e1;
	}

	.clinical-viewer-state {
		gap: 0.85rem;
		font-size: 0.875rem;
	}

	.clinical-viewer-spinner {
		width: 2rem;
		height: 2rem;
		border: 2px solid rgb(148 163 184 / 0.25);
		border-top-color: #67e8f9;
		border-radius: 999px;
		animation: clinical-viewer-spin 800ms linear infinite;
	}

	.clinical-viewer-error {
		max-width: 34rem;
		margin: auto;
	}

	.clinical-viewer-retry,
	.clinical-viewer-touch-reset {
		margin-top: 1rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 700;
		color: #082f49;
		background: #67e8f9;
	}

	.clinical-viewer-retry {
		padding: 0.65rem 1rem;
	}

	.clinical-viewer-help {
		min-width: 0;
		font-size: 0.75rem;
		color: #94a3b8;
	}

	.clinical-viewer-desktop-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.clinical-viewer-fit {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.75rem;
		border-radius: 999px;
		padding: 0 0.9rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: #e2e8f0;
		background: rgb(255 255 255 / 0.06);
	}

	.clinical-viewer-fit:disabled,
	.clinical-viewer-zoom-button:disabled {
		cursor: not-allowed;
		opacity: 0.38;
	}

	.clinical-viewer-fit svg {
		width: 1rem;
		height: 1rem;
	}

	.clinical-viewer-divider {
		width: 1px;
		height: 1.75rem;
		margin: 0 0.15rem;
		background: rgb(148 163 184 / 0.2);
	}

	.clinical-viewer-zoom-value {
		min-width: 4.25rem;
		text-align: center;
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: #f8fafc;
	}

	.clinical-viewer-touch-controls {
		display: none;
		width: 100%;
		min-width: 0;
		overflow: hidden;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.clinical-viewer-touch-zoom {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: #f8fafc;
	}

	.clinical-viewer-touch-reset {
		min-height: 2.5rem;
		margin-top: 0;
		padding: 0 0.8rem;
	}

	@keyframes clinical-viewer-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (min-width: 48rem) {
		.clinical-viewer-overlay {
			padding: 1rem;
		}

		.clinical-viewer-shell {
			width: min(112.5rem, calc(100vw - 2rem));
			height: calc(100dvh - 2rem);
		}

		.clinical-viewer-header,
		.clinical-viewer-footer {
			padding-inline: 1.25rem;
		}
	}

	@media (max-width: 47.999rem), (pointer: coarse) {
		.clinical-viewer-desktop-controls,
		.clinical-viewer-help {
			display: none;
		}

		.clinical-viewer-touch-controls {
			display: flex;
		}
	}

	@media (max-width: 39.999rem) {
		.clinical-viewer-overlay {
			padding: 0;
			background: #010307;
			backdrop-filter: none;
		}

		.clinical-viewer-shell {
			width: 100vw;
			max-width: 100vw;
			height: 100dvh;
			border: 0;
			border-radius: 0;
		}

		.clinical-viewer-header {
			min-height: 4rem;
			padding-top: max(0.6rem, env(safe-area-inset-top));
		}

		.clinical-viewer-footer {
			min-height: 4.25rem;
			padding-bottom: max(0.65rem, env(safe-area-inset-bottom));
		}

		.clinical-viewer-close {
			width: 2.75rem;
			height: 2.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.clinical-viewer-close,
		.clinical-viewer-zoom-button {
			transition: none;
		}

		.clinical-viewer-spinner {
			animation-duration: 1.6s;
		}
	}
</style>
