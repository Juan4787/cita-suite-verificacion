/** Bounded HTTP form parsing shared by operations; no reservation or provider dependency. */
export async function readBoundedBookingForm(request: Request, repeatableFields: readonly string[] = ['professional_ids']): Promise<FormData> {
	const reader = request.body?.getReader();
	if (!reader) throw new Error('BOOKING_FORM_INVALID');
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > 65536) { await reader.cancel(); throw new Error('BOOKING_FORM_INVALID'); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
	const parsed = await new Request(request.url, { method: 'POST', headers: request.headers, body }).formData();
	for (const [key, value] of parsed) {
		if (typeof value !== 'string' || key.length > 80 || (!repeatableFields.includes(key) && parsed.getAll(key).length > 1)) throw new Error('BOOKING_FORM_INVALID');
	}
	return parsed;
}
