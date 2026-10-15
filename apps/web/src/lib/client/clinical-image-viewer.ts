export const CLINICAL_VIEWER_MIN_ZOOM = 1;
export const CLINICAL_VIEWER_MAX_ZOOM = 8;

export type ClinicalViewerTransform = {
	zoom: number;
	panX: number;
	panY: number;
};

type ViewerSize = {
	width: number;
	height: number;
	contentWidth?: number;
	contentHeight?: number;
};

type ViewerAnchorTransform = ClinicalViewerTransform &
	ViewerSize & {
		nextZoom: number;
		anchorX: number;
		anchorY: number;
		targetX?: number;
		targetY?: number;
	};

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

export function clampClinicalViewerZoom(value: number): number {
	return Math.min(
		CLINICAL_VIEWER_MAX_ZOOM,
		Math.max(CLINICAL_VIEWER_MIN_ZOOM, finiteOr(value, CLINICAL_VIEWER_MIN_ZOOM))
	);
}

export function clampClinicalViewerPan(
	panX: number,
	panY: number,
	zoom: number,
	width: number,
	height: number,
	contentWidth = width,
	contentHeight = height
): Pick<ClinicalViewerTransform, 'panX' | 'panY'> {
	const safeZoom = clampClinicalViewerZoom(zoom);
	const safeWidth = Math.max(0, finiteOr(width, 0));
	const safeHeight = Math.max(0, finiteOr(height, 0));
	const safeContentWidth = Math.max(0, finiteOr(contentWidth, safeWidth));
	const safeContentHeight = Math.max(0, finiteOr(contentHeight, safeHeight));
	const maxPanX = Math.max(0, (safeContentWidth * safeZoom - safeWidth) / 2);
	const maxPanY = Math.max(0, (safeContentHeight * safeZoom - safeHeight) / 2);
	const clampAxis = (value: number, maximum: number) =>
		maximum <= 0 ? 0 : Math.min(maximum, Math.max(-maximum, finiteOr(value, 0)));

	return {
		panX: clampAxis(panX, maxPanX),
		panY: clampAxis(panY, maxPanY)
	};
}

/**
 * Changes zoom while keeping the image point under `anchor` beneath `target`.
 * Buttons and the mouse wheel use the same anchor and target; pinch gestures
 * move the target with the midpoint between both fingers.
 */
export function transformClinicalViewerAroundAnchor({
	zoom,
	panX,
	panY,
	nextZoom,
	anchorX,
	anchorY,
	targetX = anchorX,
	targetY = anchorY,
	width,
	height,
	contentWidth = width,
	contentHeight = height
}: ViewerAnchorTransform): ClinicalViewerTransform {
	const currentZoom = clampClinicalViewerZoom(zoom);
	const boundedZoom = clampClinicalViewerZoom(nextZoom);
	const safeWidth = Math.max(0, finiteOr(width, 0));
	const safeHeight = Math.max(0, finiteOr(height, 0));
	const centerX = safeWidth / 2;
	const centerY = safeHeight / 2;
	const contentX = (finiteOr(anchorX, centerX) - centerX - finiteOr(panX, 0)) / currentZoom;
	const contentY = (finiteOr(anchorY, centerY) - centerY - finiteOr(panY, 0)) / currentZoom;
	const nextPan = clampClinicalViewerPan(
		finiteOr(targetX, centerX) - centerX - contentX * boundedZoom,
		finiteOr(targetY, centerY) - centerY - contentY * boundedZoom,
		boundedZoom,
		safeWidth,
		safeHeight,
		contentWidth,
		contentHeight
	);

	return { zoom: boundedZoom, ...nextPan };
}
