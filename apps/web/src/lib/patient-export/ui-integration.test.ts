import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('patient export UI integration contract', () => {
	it('keeps the orchestrator and XLSX runtime behind the explicit export click', () => {
		const panel = source('../components/patient-export/PatientExportPanel.svelte');
		const layout = source('../../routes/odonto/+layout.svelte');
		const layoutServer = source('../../routes/odonto/+layout.server.ts');
		expect(panel).toContain("await import('$lib/patient-export/orchestrator')");
		expect(panel).not.toMatch(/import\s+\{[^}]*preparePatientExport[^}]*\}\s+from/);
		expect(layout).not.toContain('patient-export-permissions');
		expect(layout).toContain('Boolean(data?.canExportPatientData)');
		expect(layoutServer).toContain('canExportPatientData(activeBusiness)');

		for (const ordinaryRoute of [
			'../../routes/odonto/+layout.svelte',
			'../../routes/odonto/configuracion/+page.svelte',
			'../../routes/odonto/pacientes/[id]/+page.svelte'
		]) {
			const route = source(ordinaryRoute);
			expect(route).not.toContain('preparePatientExport');
			expect(route).not.toContain('patient-export/client');
			expect(route).not.toContain('write-excel-file');
			expect(route).not.toContain('/api/odonto/exportaciones');
		}
	});

	it('publishes the precise tabular export scope without obsolete promises', () => {
		const terms = source('../../routes/terminos/+page.svelte');
		const privacy = source('../../routes/privacidad/+page.svelte');
		for (const document of [terms, privacy]) {
			expect(document).toContain('datos tabulares');
			expect(document).toMatch(/no incluye radiografías|no contiene radiografías/i);
			expect(document).toMatch(/no (?:es|constituye) un backup restaurable|no es una copia de seguridad\s+restaurable/i);
		}
		expect(terms).not.toContain('La versión actual no incluye una herramienta de exportación masiva');
		expect(terms).not.toContain('no existe una exportación masiva garantizada');
	});
});
