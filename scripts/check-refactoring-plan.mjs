import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const original = readFileSync(new URL('../docs/plans/refactorizacion-cita-suite.md', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('../docs/plans/refactorizacion-cita-suite.integridad.json', import.meta.url), 'utf8'));
const separator = '\n\n---\n\n# Instrucción de ejecución aprobada por el usuario\n\n';
const [plan, appendix] = original.split(separator);
const instruction = appendix?.split('\n\n# Directivas de preservación y continuidad\n\n')[0];
const digest = text => createHash('sha256').update(text).digest('hex');
if (!plan || !instruction || digest(plan) !== metadata.originalPlanSha256 ||
	digest(instruction) !== metadata.executionInstructionSha256 || digest(original) !== metadata.documentSha256)
	throw new Error('The approved plan or execution instructions changed. Restore the original; record implementation decisions separately.');
console.log('Approved plan and execution instructions match their original conversation text (SHA-256).');
