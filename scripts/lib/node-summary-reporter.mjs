// Node 22 emits one summary per isolated file plus a cumulative final summary.
// No test stdout or error payload is copied into this machine-readable receipt.
export default async function* nodeSummaryReporter(source) {
	for await (const event of source) {
		if (event.type === 'test:summary') yield JSON.stringify(event.data) + '\n';
	}
}
