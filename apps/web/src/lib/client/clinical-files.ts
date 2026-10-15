import {CLINICAL_DOCUMENT_MAX_BYTES,CLINICAL_DOCUMENT_MIMES,hasPdfHeader,hasPdfEof} from '$lib/clinical-documents';
export const CLINICAL_IMAGE_MAX_BYTES = CLINICAL_DOCUMENT_MAX_BYTES;
export const CLINICAL_IMAGE_MIME_TYPES = CLINICAL_DOCUMENT_MIMES;
export type ClinicalImageMime = (typeof CLINICAL_IMAGE_MIME_TYPES)[number];

export type ClinicalImageValidation =
	| { ok: true; mimeType: ClinicalImageMime }
	| { ok: false; message: string };

export const hasClinicalImageSignature = (bytes: Uint8Array, mimeType: ClinicalImageMime) => {
    if(mimeType==='application/pdf')return hasPdfHeader(bytes);
	if (mimeType === 'image/jpeg') {
		return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	}
	return (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	);
};

export const validateClinicalImageFile = async (file: File): Promise<ClinicalImageValidation> => {
	if (!CLINICAL_IMAGE_MIME_TYPES.includes(file.type as ClinicalImageMime)) {
		return { ok: false, message: 'Elegí un archivo JPG, PNG o PDF.' };
	}
	if (file.size < 1 || file.size > CLINICAL_IMAGE_MAX_BYTES) {
		return { ok: false, message: 'El archivo debe pesar hasta 5 MB.' };
	}
	if (!file.name.trim() || file.name.length > 160 || /[\\/]/.test(file.name)) {
		return { ok: false, message: 'El nombre del archivo no es válido.' };
	}

	const prefix = new Uint8Array(await file.slice(0, 32).arrayBuffer());
	const mimeType = file.type as ClinicalImageMime;
	if (!hasClinicalImageSignature(prefix, mimeType)) {
		return { ok: false, message: 'El contenido del archivo no coincide con su formato.' };
	}
    if(mimeType==='application/pdf'&&!hasPdfEof(new Uint8Array(await file.slice(-1024).arrayBuffer())))return {ok:false,message:'El PDF parece incompleto. Elegí una copia que se pueda abrir y probá nuevamente.'};
	return { ok: true, mimeType };
};

export const sha256File = async (file: File) => {
	const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const formatClinicalFileBytes = (value?: number | null) => {
	if (value == null || !Number.isFinite(Number(value))) return '';
	const units = ['B', 'KB', 'MB'];
	let current = Number(value);
	let index = 0;
	while (current >= 1000 && index < units.length - 1) {
		current /= 1000;
		index += 1;
	}
	return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

export const createClinicalImageThumbnail = async (file: File): Promise<Blob | null> => {
	if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
	let bitmap: ImageBitmap | null = null;
	try {
		bitmap = await createImageBitmap(file);
		const longest = Math.max(bitmap.width, bitmap.height);
		if (longest < 1) return null;
		const scale = Math.min(1, 480 / longest);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d', { alpha: false });
		if (!context) return null;
		context.drawImage(bitmap, 0, 0, width, height);
		return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.78));
	} catch {
		return null;
	} finally {
		bitmap?.close();
	}
};

export const uploadClinicalFileWithProgress = ({
	url,
	file,
	cacheControl = '0',
	onProgress
}: {
	url: string;
	file: Blob;
	cacheControl?: string;
	onProgress?: (percentage: number) => void;
}) =>
	new Promise<void>((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open('PUT', url, true);
		request.setRequestHeader('x-upsert', 'false');
		request.timeout = 10 * 60 * 1000;
		request.upload.onprogress = (event) => {
			if (!event.lengthComputable) return;
			onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
		};
		request.onerror = () => reject(new Error('No se pudo enviar el archivo. Revisá tu conexión.'));
		request.ontimeout = () => reject(new Error('La carga tardó demasiado. Probá de nuevo.'));
		request.onabort = () => reject(new Error('La carga fue cancelada.'));
		request.onload = () => {
			if (request.status >= 200 && request.status < 300) {
				onProgress?.(100);
				resolve();
				return;
			}
			reject(new Error('No pudimos guardar el archivo. Probá de nuevo.'));
		};

		const body = new FormData();
		body.append('cacheControl', cacheControl);
		body.append('', file);
		request.send(body);
	});
