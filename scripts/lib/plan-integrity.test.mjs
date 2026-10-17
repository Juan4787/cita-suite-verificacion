import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertApprovedPlan } from './plan-integrity.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture() {
	const base = 'approved plan\n\n---\n\n# Instrucción de ejecución aprobada por el usuario\n\nexecute exactly\n\n# Directivas de preservación y continuidad\n\nkeep original\n';
	const branding = '\n---\n\n# Branding\nuser amendment one\n';
	const production = '\n---\n\n# Production\nuser amendment two\n';
	const document = base + branding + production;
	return { document, metadata: {
		originalPlanSha256: hash('approved plan'), executionInstructionSha256: hash('execute exactly'),
		documentSha256: hash(document), documentBeforeBrandingAmendmentSha256: hash(base),
		documentBeforeProductionAuthorizationSha256: hash(base + branding),
		amendments: [{ heading: '# Branding', sha256: hash(branding) }, { heading: '# Production', sha256: hash(production) }]
	} };
}
test('explicit later authorization preserves every earlier approved segment', () => {
	const { document, metadata } = fixture();
	assert.doesNotThrow(() => assertApprovedPlan(document, metadata));
});
test('altered plan, execution, continuity or either amendment is rejected', () => {
	for (const content of ['approved plan', 'execute exactly', 'keep original', 'amendment one', 'amendment two']) {
		const { document, metadata } = fixture();
		const altered = document.replace(content, content + ' changed');
		// Even updating the outer hash cannot erase the independent segment guarantees.
		metadata.documentSha256 = hash(altered);
		assert.throws(() => assertApprovedPlan(altered, metadata), /approved plan/);
	}
});
test('missing, repeated or reordered amendment headings are rejected', () => {
	for (const mutate of [
		s => s.replace('# Branding', '# Unknown'),
		s => s + '\n---\n\n# Branding\nrepeated',
		s => s.replace('# Branding', '# Temporary').replace('# Production', '# Branding').replace('# Temporary', '# Production')
	]) {
		const { document, metadata } = fixture();
		const altered = mutate(document); metadata.documentSha256 = hash(altered);
		assert.throws(() => assertApprovedPlan(altered, metadata), /approved plan/);
	}
});
test('changing or dropping an earlier amendment receipt cannot pass as a later authorization', () => {
	for (const mutate of [m => { m.amendments[0].sha256 = '0'.repeat(64); }, m => m.amendments.shift()]) {
		const { document, metadata } = fixture(); mutate(metadata);
		assert.throws(() => assertApprovedPlan(document, metadata), /approved plan/);
	}
});
