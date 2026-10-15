import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CLINICAL_IMAGE_MAX_BYTES,
	formatClinicalFileBytes,
	hasClinicalImageSignature,
	sha256File,
	uploadClinicalFileWithProgress,
	validateClinicalImageFile
} from './clinical-files';

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe('clinical image client boundary', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('accepts JPEG/PNG only when declared type and binary signature agree', async () => {
		await expect(
			validateClinicalImageFile(new File([jpegBytes], 'panoramica.jpg', { type: 'image/jpeg' }))
		).resolves.toEqual({ ok: true, mimeType: 'image/jpeg' });
		await expect(
			validateClinicalImageFile(new File([pngBytes], 'periapical.png', { type: 'image/png' }))
		).resolves.toEqual({ ok: true, mimeType: 'image/png' });
		await expect(
			validateClinicalImageFile(new File([pngBytes], 'falsa.jpg', { type: 'image/jpeg' }))
		).resolves.toEqual({
			ok: false,
			message: 'El contenido del archivo no coincide con su formato.'
		});
		expect(hasClinicalImageSignature(jpegBytes, 'image/jpeg')).toBe(true);
		expect(hasClinicalImageSignature(pngBytes, 'image/png')).toBe(true);
	});

	it('rejects unsupported formats, unsafe names, empty files and oversized files before upload', async () => {
		await expect(
			validateClinicalImageFile(new File([jpegBytes], 'estudio.pdf', { type: 'application/pdf' }))
		).resolves.toEqual({ ok: false, message: 'El contenido del archivo no coincide con su formato.' });
		await expect(
			validateClinicalImageFile(new File([jpegBytes], '../imagen.jpg', { type: 'image/jpeg' }))
		).resolves.toEqual({ ok: false, message: 'El nombre del archivo no es válido.' });
		await expect(
			validateClinicalImageFile(new File([], 'vacia.jpg', { type: 'image/jpeg' }))
		).resolves.toEqual({ ok: false, message: 'El archivo debe pesar hasta 5 MB.' });

		const oversized = {
			type: 'image/jpeg',
			name: 'grande.jpg',
			size: CLINICAL_IMAGE_MAX_BYTES + 1,
			slice: vi.fn()
		} as unknown as File;
		await expect(validateClinicalImageFile(oversized)).resolves.toEqual({
			ok: false,
			message: 'El archivo debe pesar hasta 5 MB.'
		});
		expect(oversized.slice).not.toHaveBeenCalled();
	});

	it('calculates a stable SHA-256 and formats byte sizes without clinical metadata', async () => {
		await expect(sha256File(new File(['abc'], 'contenido.bin'))).resolves.toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
		expect(formatClinicalFileBytes(0)).toBe('0 B');
		expect(formatClinicalFileBytes(1536)).toBe('1.5 KB');
		expect(formatClinicalFileBytes(5_000_000)).toBe('5.0 MB');
		expect(formatClinicalFileBytes(null)).toBe('');
	});

	it('uploads to the exact signed URL without upsert and reports progress', async () => {
		let instance!: FakeXmlHttpRequest;
		class FakeXmlHttpRequest {
			upload: { onprogress?: (event: ProgressEvent) => void } = {};
			timeout = 0;
			status = 201;
			onerror?: () => void;
			onabort?: () => void;
			ontimeout?: () => void;
			onload?: () => void;
			method = '';
			url = '';
			headers = new Map<string, string>();
			body: FormData | null = null;

			constructor() {
				instance = this;
			}
			open(method: string, url: string) {
				this.method = method;
				this.url = url;
			}
			setRequestHeader(name: string, value: string) {
				this.headers.set(name, value);
			}
			send(body: FormData) {
				this.body = body;
				this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
				this.onload?.();
			}
		}
		vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
		const progress = vi.fn();
		const file = new File([jpegBytes], 'rx.jpg', { type: 'image/jpeg' });

		await uploadClinicalFileWithProgress({
			url: 'https://storage.example.test/object/upload/sign/exact-path?token=temporary',
			file,
			onProgress: progress
		});

		expect(instance).toMatchObject({
			method: 'PUT',
			url: 'https://storage.example.test/object/upload/sign/exact-path?token=temporary',
			timeout: 10 * 60 * 1000
		});
		expect(instance.headers.get('x-upsert')).toBe('false');
		expect(instance.body?.get('cacheControl')).toBe('0');
		expect(instance.body?.get('')).toBeInstanceOf(File);
		expect(progress).toHaveBeenCalledWith(50);
		expect(progress).toHaveBeenLastCalledWith(100);
	});
});

describe('basic PDF client boundary',()=>{
 it.each(['1.7','2.0'])('accepts PDF %s without treating it as an image',async version=>{
  expect(await validateClinicalImageFile(new File([`%PDF-${version}\ncontent\n%%EOF\n`],'estudio.pdf',{type:'application/pdf'}))).toEqual({ok:true,mimeType:'application/pdf'});
 });
 it('rejects a PDF without its closing marker',async()=>{
  expect(await validateClinicalImageFile(new File(['%PDF-1.7\ncontent'],'incompleto.pdf',{type:'application/pdf'}))).toMatchObject({ok:false,message:expect.stringContaining('incompleto')});
 });
});
