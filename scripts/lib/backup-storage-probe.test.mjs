import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackupStorageProbe } from './backup-storage-probe.mjs';

test('an existing bucket is not adopted or changed by a backup rehearsal', async () => {
	const calls = [];
	await assert.rejects(createBackupStorageProbe(async (path, init) => {
		calls.push({ path, method: init.method });
		throw new Error('Storage POST answered 409.');
	}, 'cita-backup-rehearsal-1234abcd'), /409/);
	assert.deepEqual(calls, [{ path: 'bucket', method: 'POST' }]);
});

test('separate rehearsals own separate buckets and clean only their own object', async () => {
	const buckets = new Map();
	const storage = async (path, init) => {
		if (path === 'bucket' && init.method === 'POST') {
			const { id, public: exposed } = JSON.parse(init.body);
			assert.equal(exposed, false);
			if (buckets.has(id)) throw new Error('Storage POST answered 409.');
			buckets.set(id, new Set());
		} else if (path.startsWith('object/') && init.method === 'POST') {
			const [, bucket, ...parts] = path.split('/');buckets.get(bucket).add(parts.join('/'));
		} else if (path.startsWith('object/') && init.method === 'DELETE') {
			const objects = buckets.get(path.slice('object/'.length));
			for (const name of JSON.parse(init.body).prefixes) objects.delete(name);
		} else if (path.startsWith('bucket/') && init.method === 'DELETE') {
			const id = path.slice('bucket/'.length);
			if (buckets.get(id).size) throw new Error('Storage DELETE answered 400.');
			buckets.delete(id);
		} else throw new Error('Unexpected storage operation.');
	};
	const first = await createBackupStorageProbe(storage, 'cita-backup-rehearsal-1234abcd');
	const second = await createBackupStorageProbe(storage, 'cita-backup-rehearsal-5678abcd');
	assert.notEqual(first.bucket, second.bucket);
	await first.upload('first');await second.upload('second');
	assert.equal(await first.remove(), true);
	assert.deepEqual([...buckets.get(second.bucket)], [second.object]);
	// A partial/uncertain upload still leaves an owned bucket that can be cleaned.
	const third = await createBackupStorageProbe(storage, 'cita-backup-rehearsal-9012abcd');
	assert.equal(await third.remove(), true);
	const uncertain = await createBackupStorageProbe(async (path, init) => {
		const result = await storage(path, init);
		if (path.startsWith('object/') && init.method === 'POST') throw new Error('Upload response lost after acceptance.');
		return result;
	}, 'cita-backup-rehearsal-abcd1234');
	await assert.rejects(uncertain.upload('accepted'), /response lost/);
	assert.equal(await uncertain.remove(), true);
	assert.equal(buckets.has(uncertain.bucket), false);
	// Never empty the bucket to force cleanup if something else appeared in it.
	buckets.get(second.bucket).add('foreign.txt');
	assert.equal(await second.remove(), false);
	assert.deepEqual([...buckets.get(second.bucket)], ['foreign.txt']);
});
