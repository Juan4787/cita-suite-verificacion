import { describe, expect, it } from 'vitest';
import {
	PatientExportTextError,
	decodePatientExportOoxmlText,
	escapePatientExportTextForOoxml
} from './ooxml';

describe('patient export OOXML text adapter', () => {
	it('preserves literal escape-looking text and encodes controls reversibly', () => {
		const original =
			'=_x000D_ + _xAbCd_\r\n\t\u0000\u0001\u007f\u0085\u009f\uFFFD\uFDD0\u{1FFFE}😀';
		const escaped = escapePatientExportTextForOoxml(original);

		expect(escaped).toContain('_x005F_x000D_');
		expect(escaped).toContain('_x000D_');
		expect(escaped).toContain('_x0000_');
		expect(escaped).toContain('_x007F_');
		expect(escaped).toContain('_xD83F__xDFFE_');
		expect(escaped).toContain('😀');
		expect(decodePatientExportOoxmlText(escaped)).toBe(original);
	});

	it('keeps tabs and line feeds literal', () => {
		const escaped = escapePatientExportTextForOoxml('a\tb\nc');
		expect(escaped).toBe('a\tb\nc');
	});

	it.each(['\ud800', '\udfff', `ok\ud800x`])(
		'rejects malformed Unicode instead of dropping it silently',
		(value) => {
			expect(() => escapePatientExportTextForOoxml(value)).toThrow(PatientExportTextError);
		}
	);
});
