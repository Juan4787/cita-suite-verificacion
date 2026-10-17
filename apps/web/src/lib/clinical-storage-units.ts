// Exact decimal MB, with Argentine decimal comma and no grouping ambiguity.
export function parseStorageMegabytes(value: string): number | null {
	const match = value.trim().match(/^(\d{1,10})(?:,(\d{1,6}))?$/);
	if (!match) return null;
	const bytes = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
	return bytes > 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : null;
}
export function storageMegabytesInput(bytes: number): string {
	if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid storage byte amount.');
	const amount = BigInt(bytes);
	const fraction = String(amount % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
	return String(amount / 1_000_000n) + (fraction ? ',' + fraction : '');
}
