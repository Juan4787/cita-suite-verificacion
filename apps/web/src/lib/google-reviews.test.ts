import { describe, expect, it } from 'vitest';
import {
	GOOGLE_REVIEW_DEFAULT_ACTION_LABEL,
	GOOGLE_REVIEW_DEFAULT_BODY,
	GOOGLE_REVIEW_DEFAULT_TITLE,
	isValidGoogleReviewUrl,
	trimGoogleReviewMessage
} from './google-reviews';

describe('configuración de reseñas de Google', () => {
	it('conserva exactamente el mensaje original acordado', () => {
		expect(GOOGLE_REVIEW_DEFAULT_TITLE).toBe(
			'✨ Esperamos que hayas tenido una buena experiencia con nosotros.'
		);
		expect(GOOGLE_REVIEW_DEFAULT_BODY).toBe(
			'Si querés, compartí tu opinión en Google. Puede ayudar a otros que estén buscando dónde atenderse.'
		);
		expect(GOOGLE_REVIEW_DEFAULT_ACTION_LABEL).toBe('Compartir mi opinión');
	});

	it('acepta enlaces directos y cortos administrados por Google', () => {
		for (const url of [
			'https://g.page/r/AbCdEf123/review',
			'https://g.page/r/AbCdEf123/review?gm',
			'https://search.google.com/local/writereview?placeid=abc123',
			'https://www.google.com/maps/place/Consultorio/data=!4m2!3m1!1sabc',
			'https://maps.app.goo.gl/AbCdEf123',
			'https://goo.gl/maps/AbCdEf123'
		]) {
			expect(isValidGoogleReviewUrl(url), url).toBe(true);
		}
	});

	it('rechaza destinos externos, credenciales, fragmentos y rutas de redirección', () => {
		for (const url of [
			'https://example.com/review',
			'http://g.page/r/abc/review',
			'https://user:pass@g.page/r/abc/review',
			'https://g.page/r/abc/review#fragment',
			'https://www.google.com/url?q=https://example.com',
			'https://maps.app.goo.gl/'
		]) {
			expect(isValidGoogleReviewUrl(url), url).toBe(false);
		}
	});

	it('recorta espacios sin alterar el contenido editable', () => {
		expect(
			trimGoogleReviewMessage({
				title: '  Título  ',
				body: '  Texto\ncon dos líneas  ',
				actionLabel: '  Abrir  '
			})
		).toEqual({ title: 'Título', body: 'Texto\ncon dos líneas', actionLabel: 'Abrir' });
	});
});
