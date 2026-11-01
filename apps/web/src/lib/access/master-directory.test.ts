import { describe, expect, it } from 'vitest';
import {
	accessDetail,
	accessSummary,
	directoryCounts,
	filterDirectory,
	statusLabel,
	statusTone,
	type DirectoryAccess,
	type DirectoryBusiness
} from './master-directory';

const access = (overrides: Partial<DirectoryAccess> = {}): DirectoryAccess => ({
	commercialStatus: 'active',
	visualStatus: 'active',
	isPermanent: false,
	commercialAccessEnabled: true,
	paidUntil: '2027-11-02T00:33:49.024Z',
	graceUntil: null,
	restrictedUntil: null,
	archivedAt: null,
	...overrides
});
const practice = (name: string, overrides: Partial<DirectoryAccess> = {}, extra: Partial<DirectoryBusiness> = {}): DirectoryBusiness => ({
	name,
	slug: name.toLowerCase().replaceAll(' ', '-'),
	primaryOwnerEmail: `${name.toLowerCase().replaceAll(' ', '.')}@example.test`,
	members: [],
	access: access(overrides),
	mpSubscription: null,
	...extra
});

const active = practice('Consultorio Natalia Frutos');
const paused = practice('Consultorio pausado', { commercialAccessEnabled: false });
// What archive_business leaves (20260704130000): archived_at set and the access switched off.
const archivedByMaster = practice(
	'Duplicado archivado Natalia',
	{ commercialStatus: 'archived', visualStatus: 'archived', commercialAccessEnabled: false, archivedAt: '2026-11-01T00:49:27.739Z' },
	{ primaryOwnerEmail: null }
);
// What time does: the restricted period ends while the access is still switched on.
const archivedByTime = practice('Consultorio vencido', { commercialStatus: 'archived', visualStatus: 'archived', paidUntil: '2026-01-01T00:00:00.000Z' });
const restricted = practice('Consultorio restringido', {
	commercialStatus: 'restricted', visualStatus: 'restricted', restrictedUntil: '2026-11-26T22:46:00.000Z'
});
const directory = [active, paused, archivedByMaster, archivedByTime, restricted];
const dateTime = (value: string) => `fecha ${value.slice(0, 10)}`;

describe('master directory', () => {
	it('reads an archived practice as archived, not paused, however it was archived', () => {
		for (const business of [archivedByMaster, archivedByTime]) {
			expect(statusLabel(business)).toBe('Archivado');
			expect(statusTone(business)).toBe('neutral');
			expect(accessSummary(business, null)).toBe('Cuenta archivada');
		}
		expect(accessDetail(archivedByMaster, dateTime)).toBe('Archivado el fecha 2026-11-01');
		expect(accessDetail(archivedByTime, dateTime)).toBe('Requiere reactivación.');
		// Archiving keeps is_permanent: a permanent practice that is archived still reads as archived.
		const archivedPermanent = practice('Permanente archivado', {
			commercialStatus: 'archived', visualStatus: 'archived', isPermanent: true, commercialAccessEnabled: false, archivedAt: '2026-11-01T00:00:00.000Z'
		});
		expect(statusLabel(archivedPermanent)).toBe('Archivado');
		expect(accessSummary(archivedPermanent, null)).toBe('Cuenta archivada');
		expect(accessDetail(archivedPermanent, dateTime)).toBe('Archivado el fecha 2026-11-01');
	});

	it('keeps reading every other state as before', () => {
		expect([statusLabel(paused), statusTone(paused), accessSummary(paused, null), accessDetail(paused, dateTime)])
			.toEqual(['Pausado', 'danger', 'Acceso pausado manualmente', 'Reanudalo desde las opciones avanzadas.']);
		expect([statusLabel(active), statusTone(active), accessSummary(active, '366 días restantes'), accessDetail(active, dateTime)])
			.toEqual(['Activo', 'success', '366 días restantes', 'Vence el fecha 2027-11-02']);
		expect([statusLabel(restricted), statusTone(restricted), accessSummary(restricted, null), accessDetail(restricted, dateTime)])
			.toEqual(['Restringido', 'danger', 'Sin acceso operativo', 'Se archiva el fecha 2026-11-26']);
		const grace = practice('Consultorio en gracia', { commercialStatus: 'grace', visualStatus: 'grace', graceUntil: '2026-11-03T00:00:00.000Z' });
		expect([statusLabel(grace), statusTone(grace), accessSummary(grace, null), accessDetail(grace, dateTime)])
			.toEqual(['Vencido', 'warning', 'En período de gracia', 'Gracia hasta el fecha 2026-11-03']);
		const permanent = practice('Consultorio permanente', { visualStatus: 'permanent', isPermanent: true, paidUntil: null });
		expect([statusLabel(permanent), statusTone(permanent), accessSummary(permanent, null), accessDetail(permanent, dateTime)])
			.toEqual(['Permanente', 'success', 'Sin vencimiento', 'No requiere renovaciones.']);
	});

	it('lists archived practices only in their own view, and never in the others or their search', () => {
		expect(filterDirectory(directory, 'all', '')).toEqual([active, paused, restricted]);
		expect(filterDirectory(directory, 'active', '')).toEqual([active]);
		expect(filterDirectory(directory, 'attention', '')).toEqual([paused, restricted]);
		expect(filterDirectory(directory, 'all', 'natalia')).toEqual([active]);
		expect(filterDirectory(directory, 'attention', 'archivado')).toEqual([]);
		expect(filterDirectory(directory, 'archived', '')).toEqual([archivedByMaster, archivedByTime]);
		expect(filterDirectory(directory, 'archived', ' NATALIA ')).toEqual([archivedByMaster]);
		expect(directoryCounts(directory)).toEqual({ all: 3, active: 1, attention: 2, archived: 2 });
	});

	it('searches the name, the booking address and the owner and team emails', () => {
		const team = practice('Consultorio equipo', {}, { slug: 'centro-sur', primaryOwnerEmail: 'duena@example.test', members: [{ email: 'recepcion@example.test' }, { email: null }] });
		for (const search of ['equipo', 'centro-sur', 'duena@', 'RECEPCION@example.test']) expect(filterDirectory([team], 'all', search)).toEqual([team]);
		expect(filterDirectory([team], 'all', 'otra cosa')).toEqual([]);
	});
});
