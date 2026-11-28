// Extrae enlaces seguros (exclusivamente https://) de un texto libre para mostrarlos
// clicables tanto en pantallas Svelte como en correos HTML, manteniendo el resto escapado.
export type SafeTextPart =
	| { type: 'text'; value: string }
	| { type: 'link'; href: string; label: string };

const HTTPS_TOKEN = /https:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?'"»”’]+$/;

const trimTrailingDelimiters = (candidate: string) => {
	let end = candidate.length;
	while (end > 0) {
		const slice = candidate.slice(0, end);
		const punct = TRAILING_PUNCTUATION.exec(slice);
		if (punct) {
			end -= punct[0].length;
			continue;
		}
		const last = slice[end - 1];
		const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
		const opener = pairs[last];
		if (opener) {
			const opens = slice.split(opener).length - 1;
			const closes = slice.split(last).length - 1;
			if (closes > opens) {
				end -= 1;
				continue;
			}
		}
		break;
	}
	return { url: candidate.slice(0, end), trailing: candidate.slice(end) };
};

const isSafeHttpsUrl = (value: string) => {
	if (!value.startsWith('https://') || /[\u0000-\u001f\u007f]/.test(value)) return false;
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'https:' && parsed.hostname.length > 0 && parsed.hostname.includes('.');
	} catch {
		return false;
	}
};

export const splitTextWithHttpsLinks = (input: string): SafeTextPart[] => {
	if (!input) return [];
	const parts: SafeTextPart[] = [];
	const pushText = (value: string) => {
		if (!value) return;
		const previous = parts[parts.length - 1];
		if (previous?.type === 'text') previous.value += value;
		else parts.push({ type: 'text', value });
	};
	let cursor = 0;
	for (const match of input.matchAll(HTTPS_TOKEN)) {
		const index = match.index ?? 0;
		if (index > cursor) pushText(input.slice(cursor, index));
		const raw = match[0];
		const { url, trailing } = trimTrailingDelimiters(raw);
		if (isSafeHttpsUrl(url)) {
			parts.push({ type: 'link', href: url, label: url });
			pushText(trailing);
		} else {
			pushText(raw);
		}
		cursor = index + raw.length;
	}
	if (cursor < input.length) pushText(input.slice(cursor));
	return parts;
};
