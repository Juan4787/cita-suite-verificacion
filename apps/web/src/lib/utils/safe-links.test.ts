import { describe, expect, it } from 'vitest';
import { splitTextWithHttpsLinks } from './safe-links';

describe('P7: splitTextWithHttpsLinks', () => {
	it('convierte únicamente enlaces https:// en segmentos clicables y preserva signos finales como texto', () => {
		expect(
			splitTextWithHttpsLinks('Conectate 5 minutos antes en https://meet.google.com/abc-defg-hij. Te esperamos.')
		).toEqual([
			{ type: 'text', value: 'Conectate 5 minutos antes en ' },
			{ type: 'link', href: 'https://meet.google.com/abc-defg-hij', label: 'https://meet.google.com/abc-defg-hij' },
			{ type: 'text', value: '. Te esperamos.' }
		]);
	});

	it('no convierte http://, javascript:, data: ni HTML peligroso en enlaces', () => {
		const raw = 'Ver http://inseguro.test, javascript:alert(1), data:text/html,hola y <script>alert(1)</script>';
		expect(splitTextWithHttpsLinks(raw)).toEqual([{ type: 'text', value: raw }]);
	});

	it('maneja paréntesis alrededor de un enlace https:// y texto vacío', () => {
		expect(splitTextWithHttpsLinks('')).toEqual([]);
		expect(splitTextWithHttpsLinks('(https://meet.google.com/xyz-uvwx-rst)')).toEqual([
			{ type: 'text', value: '(' },
			{ type: 'link', href: 'https://meet.google.com/xyz-uvwx-rst', label: 'https://meet.google.com/xyz-uvwx-rst' },
			{ type: 'text', value: ')' }
		]);
	});
});
