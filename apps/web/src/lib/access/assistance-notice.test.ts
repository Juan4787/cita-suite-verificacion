import { describe, expect, it } from 'vitest';
import { assistanceNoticeMode } from './assistance-notice';

const view = (status: string, showBanner: boolean, canActivate = status !== 'active') => ({ status, showBanner, canActivate });
const owner = (pathname: string, assistance: ReturnType<typeof view> | null) =>
	assistanceNoticeMode({ pathname, isMaster: false, isAssisting: false, hidden: false, assistance });

describe('assistance notice in the shell', () => {
	it('shows the active assistance to the owner on every page but Ayuda, which shows it itself', () => {
		expect(owner('/odonto/agenda', view('active', true))).toBe('active');
		expect(owner('/odonto/configuracion/negocio', view('active', true))).toBe('active');
		expect(owner('/odonto/configuracion/ayuda', view('active', true))).toBeNull();
	});

	it('says for 24 hours how it ended, and then offers it again as V10b did, outside the configuration', () => {
		expect(owner('/odonto/agenda', view('revoked', true))).toBe('ended');
		expect(owner('/odonto/configuracion/negocio', view('expired', true))).toBe('ended');
		expect(owner('/odonto/agenda', view('expired', false))).toBe('offer');
		expect(owner('/odonto/configuracion/negocio', view('expired', false))).toBeNull();
		expect(owner('/odonto/profesionales/x', view('available', true))).toBeNull();
		expect(owner('/odonto/agenda', view('available', true))).toBe('offer');
	});

	it('shows the master inside the account only while the assistance is active', () => {
		const master = (status: string) =>
			assistanceNoticeMode({ pathname: '/odonto/agenda', isMaster: true, isAssisting: true, hidden: false, assistance: view(status, false) });
		expect(master('active')).toBe('assisting');
		expect(master('revoked')).toBeNull();
	});

	it('shows nothing on the master panel, to the master outside an assistance, without access or without a state', () => {
		expect(assistanceNoticeMode({ pathname: '/odonto/maestro', isMaster: true, isAssisting: true, hidden: false, assistance: view('active', false) })).toBeNull();
		expect(assistanceNoticeMode({ pathname: '/odonto/agenda', isMaster: true, isAssisting: false, hidden: false, assistance: view('available', true) })).toBeNull();
		expect(assistanceNoticeMode({ pathname: '/odonto/agenda', isMaster: false, isAssisting: false, hidden: true, assistance: view('active', true) })).toBeNull();
		expect(owner('/odonto/agenda', null)).toBeNull();
	});

	it('shows no offer to someone who cannot give the assistance', () => {
		expect(owner('/odonto/agenda', view('available', false, false))).toBeNull();
		expect(owner('/odonto/agenda', view('expired', false, false))).toBeNull();
	});
});
