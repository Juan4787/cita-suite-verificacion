import { readFileSync } from 'node:fs';
import { assertApprovedPlan } from './lib/plan-integrity.mjs';

const original = readFileSync(new URL('../docs/plans/refactorizacion-cita-suite.md', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('../docs/plans/refactorizacion-cita-suite.integridad.json', import.meta.url), 'utf8'));
assertApprovedPlan(original, metadata);
console.log('Approved plan, execution instructions and explicit user amendments match their preserved text (SHA-256).');
