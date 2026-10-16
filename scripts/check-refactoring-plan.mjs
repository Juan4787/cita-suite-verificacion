import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const original = readFileSync(new URL('../docs/plans/refactorizacion-cita-suite.md', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('../docs/plans/refactorizacion-cita-suite.integridad.json', import.meta.url), 'utf8'));
const separator = '\n\n---\n\n# Instrucción de ejecución aprobada por el usuario\n\n';
const [plan, appendix] = original.split(separator);
const instruction = appendix?.split('\n\n# Directivas de preservación y continuidad\n\n')[0];
const digest = text => createHash('sha256').update(text).digest('hex');
const amendmentSeparator = '\n---\n\n# Ampliación aprobada por el usuario: identidad unificada «Cita Suite»';
const amendmentIndex = original.indexOf(amendmentSeparator);
const baseDocument = amendmentIndex < 0 ? original : original.slice(0, amendmentIndex);
const amendment = amendmentIndex < 0 ? '' : original.slice(amendmentIndex);
if (!plan || !instruction || digest(plan) !== metadata.originalPlanSha256 ||
	digest(instruction) !== metadata.executionInstructionSha256 || digest(original) !== metadata.documentSha256 ||
	digest(baseDocument) !== metadata.documentBeforeBrandingAmendmentSha256 ||
	metadata.amendments?.length !== 1 || digest(amendment) !== metadata.amendments[0].sha256)
	throw new Error('The approved plan or execution instructions changed. Restore the original; record implementation decisions separately.');
console.log('Approved plan, execution instructions and explicit user amendment match their preserved text (SHA-256).');
