import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { assertHostedIntegrationResources, readVerificationResources } from './lib/verification-resources.mjs';
import { verificationImages, pullVerificationImage } from './lib/verification-images.mjs';

mkdirSync('.verification', { recursive: true });
const receipt = { ok: false, startedAt: new Date().toISOString(),
	resources: readVerificationResources(), attempts: [], scope: 'CI setup only; no application tests executed by this command.' };
const save = () => {
	writeFileSync('.verification/service-preparation.json.tmp', JSON.stringify(receipt, null, 2) + '\n');
	renameSync('.verification/service-preparation.json.tmp', '.verification/service-preparation.json');
};
save();
try {
	assertHostedIntegrationResources();
	for (const image of verificationImages) {
		await pullVerificationImage(image, { onAttempt: attempt => {
			receipt.attempts.push({ ...attempt, at: new Date().toISOString() });
			save();
			console.log(`${image}: attempt ${attempt.attempt} ${attempt.ok ? 'ready' : attempt.retry ? 'transient failure; retrying with backoff' : 'failed'}`);
		} });
	}
	receipt.ok = true;
} catch (error) {
	receipt.error = error.message;
	process.exitCode = 1;
	console.error(error.message);
} finally {
	receipt.finishedAt = new Date().toISOString();
	save();
}
