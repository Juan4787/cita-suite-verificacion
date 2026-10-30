export const EMAIL_CONFIRMATION_PATH = '/confirmar-correo';
export const validConfirmationEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validConfirmationAccessToken = (value: string) => value.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);

export type EmailConfirmationFragment =
	| { kind: 'none' }
	| { kind: 'invalid' }
	| { kind: 'token'; accessToken: string; type: 'signup' | 'email' };

// A fragment is only input for Auth verification. It is never a confirmed state.
// Recovery and OAuth retain their own routes and cookies.
export const emailConfirmationFragment = (hash: string): EmailConfirmationFragment => {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	const type = params.get('type');
	if (type && type !== 'signup' && type !== 'email') return { kind: 'none' };
	if (params.has('error') || params.has('error_code')) return { kind: 'invalid' };
	if (type !== 'signup' && type !== 'email') return { kind: 'none' };
	const accessToken = params.get('access_token') ?? '';
	return validConfirmationAccessToken(accessToken) ? { kind: 'token', accessToken, type } : { kind: 'invalid' };
};
