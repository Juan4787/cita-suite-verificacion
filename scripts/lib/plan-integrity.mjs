import { createHash } from 'node:crypto';

const digest = text => createHash('sha256').update(text).digest('hex');

export function assertApprovedPlan(original, metadata) {
	const separator = '\n\n---\n\n# Instrucción de ejecución aprobada por el usuario\n\n';
	const [plan, appendix] = original.split(separator);
	const instruction = appendix?.split('\n\n# Directivas de preservación y continuidad\n\n')[0];
	const amendments = metadata.amendments;
	let valid = Boolean(plan && instruction && Array.isArray(amendments) && amendments.length > 0) &&
		digest(plan) === metadata.originalPlanSha256 && digest(instruction) === metadata.executionInstructionSha256 &&
		digest(original) === metadata.documentSha256;
	const indexes = (amendments ?? []).map(entry => original.indexOf('\n---\n\n' + entry.heading));
	valid &&= indexes[0] > 0 && digest(original.slice(0, indexes[0])) === metadata.documentBeforeBrandingAmendmentSha256;
	for (let i = 0; i < indexes.length; i++) {
		const start = indexes[i];
		const end = indexes[i + 1] ?? original.length;
		valid &&= start >= 0 && end > start &&
			original.indexOf('\n---\n\n' + amendments[i].heading, start + 1) < 0 &&
			digest(original.slice(start, end)) === amendments[i].sha256;
	}
	if (metadata.documentBeforeProductionAuthorizationSha256) {
		valid &&= indexes.length >= 2 &&
			digest(original.slice(0, indexes[1])) === metadata.documentBeforeProductionAuthorizationSha256;
	}
	// A later amendment names the whole document it was appended to.
	for (let i = 0; i < indexes.length; i++) {
		if (amendments[i].documentBeforeSha256 !== undefined)
			valid &&= digest(original.slice(0, indexes[i])) === amendments[i].documentBeforeSha256;
	}
	if (!valid) throw new Error('The approved plan or execution instructions changed. Restore the original; record implementation decisions separately.');
}
