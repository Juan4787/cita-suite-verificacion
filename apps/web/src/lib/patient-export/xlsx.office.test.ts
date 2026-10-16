// Mandatory native artifact integration. Runs only in the hosted full profile.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
import writeXlsxFile from 'write-excel-file/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPatientExportWorkbook } from './workbook';
import { makePatientExportWorkbookInput } from './test-fixtures';
import { toPatientExportWritableSheets } from './xlsx-adapter';
import { assertHostedIntegrationResources } from '../../../../../scripts/lib/verification-resources.mjs';

assertHostedIntegrationResources();
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
 JSDOM: new (xml: string, options: { contentType: string }) => { window: { document: Document } };
};
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const parseXml = (xml: string): Document => {
 const document = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
 expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
 return document;
};
describe('native patient export XLSX', () => {
 let xlsxBuffer: Buffer;
 beforeAll(async () => {
  const input = makePatientExportWorkbookInput();
  input.datasets.patients[0]!.allergies = 'literal _x000D_ y control \u0001';
  xlsxBuffer = await writeXlsxFile(toPatientExportWritableSheets(buildPatientExportWorkbook(input))).toBuffer();
 });
	it(
		'reopens the generated file with LibreOffice',
		async () => {
			const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cita-suite-export-'));
			const sourceDirectory = join(temporaryDirectory, 'source');
			const outputDirectory = join(temporaryDirectory, 'reopened');
			const profileDirectory = join(temporaryDirectory, 'libreoffice-profile');
			try {
				await Promise.all([
					mkdir(sourceDirectory),
					mkdir(outputDirectory),
					mkdir(profileDirectory)
				]);
				const sourcePath = join(sourceDirectory, 'exportacion.xlsx');
				await writeFile(sourcePath, xlsxBuffer);
				const result = spawnSync(
					'/usr/bin/libreoffice',
					[
						'--headless',
						'--nologo',
						'--nodefault',
						'--nolockcheck',
						'--nofirststartwizard',
						`-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
						'--convert-to',
						'ods',
						'--outdir',
						outputDirectory,
						sourcePath
					],
					{ encoding: 'utf8', timeout: 60_000 }
				);
				expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
				const reopened = unzipSync(
					new Uint8Array(await readFile(join(outputDirectory, 'exportacion.ods')))
				);
				const content = parseXml(decode(reopened['content.xml']!));
				expect(content.getElementsByTagName('table:table')).toHaveLength(8);
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		},
		70_000
	);
});
