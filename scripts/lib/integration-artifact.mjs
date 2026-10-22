import { loadBuildArtifact } from './staging-deploy.mjs';

// Candidate and rollback are distinct claims. A baseline never certifies the
// candidate, and its revision must come from the successful packaging run.
export function assertIntegrationArtifact(release, sourceRevision, purpose, baselineRevision) {
	const sha = value => /^[0-9a-f]{40}$/.test(value ?? '');
	if (!sha(sourceRevision) || !['candidate', 'rollback'].includes(purpose) ||
		!release?.files?.has('.verification/cloudflare-bundle-production/_worker.js'))
		throw new Error('Invalid integration artifact purpose, source or production bundle.');
	if (purpose === 'candidate') {
		if (baselineRevision !== undefined || release.revision !== sourceRevision)
			throw new Error('The candidate artifact is not the revision under test.');
	} else if (!sha(baselineRevision) || baselineRevision === sourceRevision || release.revision !== baselineRevision) {
		throw new Error('The rollback artifact is not the explicitly identified previous baseline.');
	}
	return release;
}

export function loadRollbackArtifact(env, sourceRevision) {
	if (!env.CITA_ROLLBACK_ARTIFACT) throw new Error('Release requires an identified rollback artifact.');
	return assertIntegrationArtifact(loadBuildArtifact(env.CITA_ROLLBACK_ARTIFACT), sourceRevision, 'rollback', env.CITA_ROLLBACK_REVISION);
}
