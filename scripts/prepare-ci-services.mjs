import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertHostedIntegrationResources, readVerificationResources } from './lib/verification-resources.mjs';
import { verificationImages, pullVerificationImage } from './lib/verification-images.mjs';

mkdirSync('.verification', { recursive: true });
const receipt = { ok: false, startedAt: new Date().toISOString(),
	resources: readVerificationResources(), attempts: [], images: [], scope: 'CI setup only; no application tests executed by this command.' };
const save = () => {
	writeFileSync('.verification/service-preparation.json.tmp', JSON.stringify(receipt, null, 2) + '\n');
	renameSync('.verification/service-preparation.json.tmp', '.verification/service-preparation.json');
};
save();
try {
	assertHostedIntegrationResources();
	for (const { image, source, digest } of verificationImages) {
		await pullVerificationImage(source, { onAttempt: attempt => {
			if (attempt.ok && attempt.digest !== digest) throw new Error('Downloaded image manifest does not match its pinned digest.');
			receipt.attempts.push({ ...attempt, at: new Date().toISOString() });
			save();
			console.log(`${image}: attempt ${attempt.attempt} ${attempt.ok ? 'ready' : attempt.retry ? 'transient failure; retrying with backoff' : 'failed'}`);
		} });
		// Identical official manifests were checked against the successful ECR
		// run. An explicit local alias preserves existing fixture contracts.
		const tagged = spawnSync('docker', ['tag', source, image], { encoding: 'utf8' });
		if (tagged.status !== 0 || tagged.error) throw new Error('Could not alias the pinned disposable image.');
		const inspected = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { encoding: 'utf8' });
		if (inspected.status !== 0 || inspected.error) throw new Error('Could not inspect the prepared disposable image.');
		receipt.images.push({ image, source, digest, imageId: inspected.stdout.trim() });
		save();
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
