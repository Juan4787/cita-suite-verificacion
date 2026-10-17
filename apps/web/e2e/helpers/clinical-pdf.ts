/** Minimal real PDF with a catalog, one page and a valid cross-reference table. */
export function clinicalPdfFixture(): Buffer {
	let source = '%PDF-1.4\n';
	const offsets = [0];
	for (const [index, object] of [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
		'<< /Length 0 >>\nstream\n\nendstream'
	].entries()) {
		offsets.push(Buffer.byteLength(source));
		source += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(source);
	source += 'xref\n0 5\n0000000000 65535 f \n' + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
	source += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(source);
}
