import { describe, expect, it } from 'vitest';
import {
	CLINICAL_VIEWER_MAX_ZOOM,
	clampClinicalViewerPan,
	clampClinicalViewerZoom,
	transformClinicalViewerAroundAnchor
} from './clinical-image-viewer';

describe('clinical image viewer geometry', () => {
	it('bounds zoom to the clinical viewer range', () => {
		expect(clampClinicalViewerZoom(0.2)).toBe(1);
		expect(clampClinicalViewerZoom(3.5)).toBe(3.5);
		expect(clampClinicalViewerZoom(30)).toBe(CLINICAL_VIEWER_MAX_ZOOM);
		expect(clampClinicalViewerZoom(Number.NaN)).toBe(1);
	});

	it('does not allow panning while the image is fitted', () => {
		expect(clampClinicalViewerPan(300, -200, 1, 1200, 800)).toEqual({ panX: 0, panY: 0 });
	});

	it('bounds panning so the enlarged canvas cannot be lost', () => {
		expect(clampClinicalViewerPan(900, -900, 2, 1000, 600)).toEqual({
			panX: 500,
			panY: -300
		});
	});

	it('uses the fitted image dimensions instead of draggable letterboxing', () => {
		expect(clampClinicalViewerPan(500, -900, 2, 1000, 800, 400, 800)).toEqual({
			panX: 0,
			panY: -400
		});
	});

	it('keeps the center stable when toolbar zoom is used', () => {
		expect(
			transformClinicalViewerAroundAnchor({
				zoom: 1,
				panX: 0,
				panY: 0,
				nextZoom: 2,
				anchorX: 600,
				anchorY: 400,
				width: 1200,
				height: 800
			})
		).toEqual({ zoom: 2, panX: 0, panY: 0 });
	});

	it('keeps the inspected point under the cursor while zooming', () => {
		const transformed = transformClinicalViewerAroundAnchor({
			zoom: 1,
			panX: 0,
			panY: 0,
			nextZoom: 2,
			anchorX: 750,
			anchorY: 300,
			width: 1000,
			height: 600
		});

		expect(transformed).toEqual({ zoom: 2, panX: -250, panY: 0 });
	});

	it('supports a moving midpoint for two-finger pinch and pan', () => {
		const transformed = transformClinicalViewerAroundAnchor({
			zoom: 1,
			panX: 0,
			panY: 0,
			nextZoom: 2,
			anchorX: 200,
			anchorY: 300,
			targetX: 240,
			targetY: 320,
			width: 400,
			height: 700
		});

		expect(transformed).toEqual({ zoom: 2, panX: 40, panY: 70 });
	});
});
