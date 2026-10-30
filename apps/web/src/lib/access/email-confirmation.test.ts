import { describe, expect, it } from 'vitest';
import { emailConfirmationFragment, validConfirmationEmail } from './email-confirmation';

describe('email confirmation input, never proof', () => {
	it('extrae sólo el token que debe verificar Auth y descarta el refresh token', () => {
		expect(emailConfirmationFragment('#type=signup&access_token=header.payload.signature&refresh_token=private'))
			.toEqual({ kind: 'token', type: 'signup', accessToken: 'header.payload.signature' });
	});
	it('no desvía recuperación, magic links ni OAuth a la confirmación', () => {
		for (const type of ['recovery', 'magiclink', 'invite', 'oauth']) expect(emailConfirmationFragment(`#type=${type}&access_token=a.b.c`)).toEqual({ kind: 'none' });
	});
	it('no acepta una supuesta confirmación, un token ausente o uno demasiado largo', () => {
		expect(emailConfirmationFragment('#confirmed=true')).toEqual({ kind: 'none' });
		expect(emailConfirmationFragment('#type=signup')).toEqual({ kind: 'invalid' });
		expect(emailConfirmationFragment('#type=email&access_token=' + 'a'.repeat(8200) + '.b.c')).toEqual({ kind: 'invalid' });
	});
	it('nunca propaga la descripción técnica del error a la interfaz', () => {
		expect(emailConfirmationFragment('#error=access_denied&error_code=otp_expired&error_description=PRIVATE')).toEqual({ kind: 'invalid' });
	});
	it('valida la dirección sin convertirla en un dato de URL', () => {
		expect(validConfirmationEmail('cuenta+prueba@example.com')).toBe(true);
		for (const email of ['', 'no-es-correo', 'a @example.com', 'a'.repeat(250) + '@x.com']) expect(validConfirmationEmail(email)).toBe(false);
	});
});
