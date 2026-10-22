import { describe, expect, it } from 'vitest';
import { withSupabaseOrigin } from './content-security';

const rendered = "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com";

describe('política de contenido con el proyecto Supabase configurado', () => {
	it('agrega sólo el origen del proyecto y su socket, sin tocar el resto', () => {
		expect(withSupabaseOrigin(rendered, 'https://abcdefghij1234567890.supabase.co')).toBe(
			"default-src 'self'; img-src 'self' data: blob: https://abcdefghij1234567890.supabase.co; " +
				"connect-src 'self' https://accounts.google.com https://abcdefghij1234567890.supabase.co wss://abcdefghij1234567890.supabase.co; " +
				'frame-src https://accounts.google.com'
		);
	});

	it('admite HTTP sólo en loopback, para la plataforma descartable de verificación', () => {
		expect(withSupabaseOrigin("connect-src 'self'", 'http://127.0.0.1:54321')).toBe(
			"connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321"
		);
		expect(withSupabaseOrigin("connect-src 'self'", 'http://project.supabase.co')).toBe("connect-src 'self'");
	});

	it('una configuración inválida no amplía la política: la conexión queda bloqueada', () => {
		for (const value of [undefined, '', 'not a url', 'https://user:secret@project.supabase.co', 'https://project.supabase.co/rest/v1', 'ftp://project.supabase.co'])
			expect(withSupabaseOrigin(rendered, value)).toBe(rendered);
		expect(withSupabaseOrigin('', 'https://project.supabase.co')).toBe('');
	});
});
