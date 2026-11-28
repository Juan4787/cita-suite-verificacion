import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({ SUPPORT_WHATSAPP_PHONE: undefined as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env: envState }));

import { buildSupportWhatsAppLinks } from './support-whatsapp';

describe('P2: configuración centralizada del WhatsApp de soporte', () => {
	beforeEach(() => {
		envState.SUPPORT_WHATSAPP_PHONE = undefined;
	});

	it('devuelve null cuando SUPPORT_WHATSAPP_PHONE no está configurado o es inválido', () => {
		expect(buildSupportWhatsAppLinks({ businessName: 'Consultorio Norte', topic: 'configuración de señas' })).toBeNull();
		envState.SUPPORT_WHATSAPP_PHONE = '   ';
		expect(buildSupportWhatsAppLinks({ businessName: 'Consultorio Norte', topic: 'configuración de señas' })).toBeNull();
		envState.SUPPORT_WHATSAPP_PHONE = '123';
		expect(buildSupportWhatsAppLinks({ businessName: 'Consultorio Norte', topic: 'configuración de señas' })).toBeNull();
	});

	it('arma enlaces de WhatsApp móvil y web nombrando al consultorio y el tema', () => {
		envState.SUPPORT_WHATSAPP_PHONE = '+54 9 341 555-0199';
		const links = buildSupportWhatsAppLinks({
			businessName: 'Consultorio Norte',
			topic: 'plazos de seña'
		});
		expect(links).not.toBeNull();
		expect(links!.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5493415550199\?text=/);
		expect(links!.whatsappWebUrl).toMatch(/^https:\/\/web\.whatsapp\.com\/send\?phone=5493415550199&text=/);
		expect(links!.message).toContain('Consultorio Norte');
		expect(links!.message).toContain('plazos de seña');
		expect(decodeURIComponent(links!.whatsappUrl)).toContain('Consultorio Norte');
	});
});
