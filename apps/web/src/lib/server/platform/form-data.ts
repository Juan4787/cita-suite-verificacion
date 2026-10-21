/** Bounded HTTP body reading shared by operations; no reservation or provider dependency. */

/** The body's bytes, or null once it passes `maxBytes`: the rest is never read. */
export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > maxBytes) { await reader.cancel(); return null; }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
	return body;
}

export async function readBoundedBookingForm(request: Request, repeatableFields: readonly string[] = ['professional_ids']): Promise<FormData> {
	if (!request.body) throw new Error('BOOKING_FORM_INVALID');
	const body = await readBoundedBytes(request, 65536);
	if (!body) throw new Error('BOOKING_FORM_INVALID');
	const parsed = await new Request(request.url, { method: 'POST', headers: request.headers, body }).formData();
	for (const [key, value] of parsed) {
		if (typeof value !== 'string' || key.length > 80 || (!repeatableFields.includes(key) && parsed.getAll(key).length > 1)) throw new Error('BOOKING_FORM_INVALID');
	}
	return parsed;
}
