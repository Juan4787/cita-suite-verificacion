// Storage adapter is injected: this helper never receives credentials or data rows.
export async function createBackupStorageProbe(storage, runId) {
	if (!/^cita-backup-rehearsal-[0-9a-f]{8}$/.test(runId)) throw new Error('Invalid backup probe owner.');
	const bucket = runId;
	const object = `rehearsal/${runId}.txt`;
	await storage('bucket', { method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: bucket, name: bucket, public: false }) });
	return {
		bucket, object,
		upload: body => storage(`object/${bucket}/${object}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body }),
		async remove() {
			try {
				await storage(`object/${bucket}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [object] }) });
				await storage(`bucket/${bucket}`, { method: 'DELETE' });
				return true;
			} catch { return false; }
		}
	};
}
