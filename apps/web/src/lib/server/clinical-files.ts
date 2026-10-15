import {isHttpError,isRedirect,type RequestEvent} from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOdontoContext } from './odonto-context';
import { createSupabaseAdminClient } from './supabase';
import { RateLimitExceededError } from './rate-limits';
import {CLINICAL_DOCUMENT_MAX_BYTES,CLINICAL_DOCUMENT_MIMES,hasPdfHeader,hasPdfEof} from '$lib/clinical-documents';
export async function readClinicalJson(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new ClinicalFileHttpError(400,'No pudimos leer los datos del archivo.',{code:'INVALID_REQUEST'});
 const decoder=new TextDecoder();let text='';let count=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>4096)throw new ClinicalFileHttpError(400,'Los datos del archivo son demasiado extensos.',{code:'INVALID_REQUEST'});text+=decoder.decode(value,{stream:true});}text+=decoder.decode();const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('invalid');return data as Record<string,unknown>;}catch(cause){if(cause instanceof ClinicalFileHttpError)throw cause;throw new ClinicalFileHttpError(400,'Revisá los datos del archivo antes de enviar.',{code:'INVALID_REQUEST'});}finally{await reader.cancel().catch(()=>undefined);}
}

export const CLINICAL_FILES_BUCKET = 'patient-clinical-files';
export const CLINICAL_FILE_MAX_BYTES = CLINICAL_DOCUMENT_MAX_BYTES;
export const CLINICAL_FILE_MIME_TYPES = CLINICAL_DOCUMENT_MIMES;
export const CLINICAL_FILE_THUMBNAIL_MIME = 'image/webp';
export const CLINICAL_FILE_ORIGINAL_URL_TTL_SECONDS = 60;
export const CLINICAL_FILE_THUMBNAIL_URL_TTL_SECONDS = 5 * 60;

export type ClinicalFileMime = (typeof CLINICAL_FILE_MIME_TYPES)[number];
export type ClinicalFileErrorCode =
	| 'AUTH_REQUIRED'
	| 'ACCESS_DENIED'
	| 'ROLE_NOT_ALLOWED'
	| 'PATIENT_NOT_FOUND'
	| 'FILE_NOT_FOUND'
	| 'INVALID_REQUEST'
	| 'INVALID_FILE_TYPE'
	| 'FILE_TOO_LARGE'
	| 'INVALID_METADATA'
	| 'RATE_LIMIT_REACHED'
	| 'UPLOAD_LIMIT_REACHED'
	| 'UPLOAD_CONFLICT'
	| 'FILE_UNAVAILABLE'
	| 'STATE_CONFLICT'
	| 'STORAGE_UNAVAILABLE'
	| 'OPERATION_FAILED';

export type ClinicalFileRequestContext = {
	supabase: SupabaseClient;
	admin: SupabaseClient;
	businessId: string;
	userId: string;
	role: 'owner' | 'admin' | 'reception' | 'professional' | 'readonly';
	canView: boolean;
	canUpload: boolean;
	canViewTrash: boolean;
	canTrash: boolean;
};

export class ClinicalFileHttpError extends Error {
	status: number;
	code: ClinicalFileErrorCode;
	userMessage: string;
	retryAfterSeconds?: number;

	constructor(
		status: number,
		userMessage: string,
		options?: { code?: ClinicalFileErrorCode; retryAfterSeconds?: number }
	) {
		super(userMessage);
		this.name = 'ClinicalFileHttpError';
		this.status = status;
		this.code = options?.code ?? 'OPERATION_FAILED';
		this.userMessage = userMessage;
		this.retryAfterSeconds = options?.retryAfterSeconds;
	}
}

export const clinicalFileErrorBody = (error: ClinicalFileHttpError) => ({
	code: error.code,
	message: error.userMessage,
	...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
});

const errorText = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object' && 'message' in error) return String(error.message ?? '');
	return String(error ?? '');
};

export const clinicalFileError = (
	error: unknown,
	fallback = 'No pudimos completar la operación. Probá de nuevo.'
): ClinicalFileHttpError => {
	if (error instanceof ClinicalFileHttpError) return error;
 if(isRedirect(error))return new ClinicalFileHttpError(401,'Tu sesión terminó. Volvé a iniciar sesión.',{code:'AUTH_REQUIRED'});
 if(isHttpError(error)&&[401,403,404,429,503].includes(error.status))return new ClinicalFileHttpError(error.status,error.body.message,{code:error.status===429?'RATE_LIMIT_REACHED':error.status===401?'AUTH_REQUIRED':error.status===403?'ACCESS_DENIED':error.status===404?'FILE_UNAVAILABLE':'STORAGE_UNAVAILABLE'});
	if (error instanceof RateLimitExceededError) {
		return new ClinicalFileHttpError(429, error.userMessage, {
			code: 'RATE_LIMIT_REACHED',
			retryAfterSeconds: error.retryAfterSeconds
		});
	}

	const message = errorText(error);
 if(message.includes('BOOKING_INFORMATION_UNAVAILABLE'))return new ClinicalFileHttpError(404,'El enlace del turno ya no permite esta carga. Contactá al consultorio.',{code:'FILE_UNAVAILABLE'});
 if(message.includes('RADIOGRAPH_UPLOAD_INVALID'))return new ClinicalFileHttpError(400,'Revisá el nombre, el formato y el tamaño del archivo.',{code:'INVALID_METADATA'});
    if(message.includes('CLINICAL_STORAGE_QUOTA'))return new ClinicalFileHttpError(409,'El consultorio no tiene espacio disponible para nuevas cargas. Tu turno y los archivos anteriores se conservan.',{code:'UPLOAD_LIMIT_REACHED'});
    if(message.includes('CLINICAL_PATIENT_QUOTA'))return new ClinicalFileHttpError(409,'Podés adjuntar hasta tres documentos y 10 MB en total para este turno. Contactá al consultorio si necesitás enviar más.',{code:'UPLOAD_LIMIT_REACHED'});
    if(message.includes('CLINICAL_PATIENT_DOCUMENTS_DISABLED'))return new ClinicalFileHttpError(409,'El consultorio todavía no habilitó el envío de documentos. Tu turno se conserva.',{code:'ACCESS_DENIED'});
	if (message.includes('AUTH_REQUIRED')) {
		return new ClinicalFileHttpError(401, 'Tu sesión terminó. Volvé a iniciar sesión.', {
			code: 'AUTH_REQUIRED'
		});
	}
	if (message.includes('PATIENT_NOT_FOUND')) {
		return new ClinicalFileHttpError(404, 'No encontramos ese paciente en este consultorio.', {
			code: 'PATIENT_NOT_FOUND'
		});
	}
	if (message.includes('RADIOGRAPH_NOT_FOUND')) {
		return new ClinicalFileHttpError(404, 'La imagen ya no está disponible en esta ficha.', {
			code: 'FILE_NOT_FOUND'
		});
	}
	if (message.includes('BUSINESS_ACCESS_RESTRICTED')) {
		return new ClinicalFileHttpError(
			403,
			'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a cargar archivos.',
			{ code: 'ACCESS_DENIED' }
		);
	}
	if (
		message.includes('RADIOGRAPH_SERVER_REQUIRED') ||
		message.includes('RADIOGRAPH_ACCESS_DENIED') ||
		message.includes('RADIOGRAPH_UPLOAD_OWNER_REQUIRED') ||
		message.includes('RADIOGRAPH_TRASH_DENIED') ||
		message.includes('RADIOGRAPH_RESTORE_DENIED')
	) {
		return new ClinicalFileHttpError(403, 'No tenés permiso para realizar esta acción.', {
			code: 'ACCESS_DENIED'
		});
	}
	if (message.includes('RADIOGRAPH_FORMAT_INVALID')) {
		return new ClinicalFileHttpError(400, 'Elegí una imagen JPG o PNG.', {
			code: 'INVALID_FILE_TYPE'
		});
	}
	if (message.includes('RADIOGRAPH_SIZE_INVALID')) {
		return new ClinicalFileHttpError(400, 'La imagen debe pesar hasta 25 MB.', {
			code: 'FILE_TOO_LARGE'
		});
	}
	if (message.includes('RADIOGRAPH_DATE_INVALID')) {
		return new ClinicalFileHttpError(400, 'La fecha de la imagen no puede estar en el futuro.', {
			code: 'INVALID_METADATA'
		});
	}
	if (
		message.includes('RADIOGRAPH_CHECKSUM_INVALID') ||
		message.includes('RADIOGRAPH_FILENAME_INVALID') ||
		message.includes('RADIOGRAPH_NOTE_INVALID') ||
		message.includes('RADIOGRAPH_UPLOAD_INVALID')
	) {
		return new ClinicalFileHttpError(400, 'Revisá los datos de la imagen e intentá de nuevo.', {
			code: 'INVALID_METADATA'
		});
	}
	if (message.includes('RADIOGRAPH_PENDING_LIMIT')) {
		return new ClinicalFileHttpError(
			409,
			'Esperá a que terminen las cargas anteriores antes de iniciar otra.',
			{ code: 'UPLOAD_LIMIT_REACHED' }
		);
	}
	if (message.includes('RADIOGRAPH_REQUEST_CONFLICT')) {
		return new ClinicalFileHttpError(409, 'Esta carga cambió. Volvé a elegir la imagen.', {
			code: 'UPLOAD_CONFLICT'
		});
	}
	if (message.includes('RADIOGRAPH_INTEGRITY_INVALID')) {
		return new ClinicalFileHttpError(
			409,
			'El archivo no está disponible. Informá el problema para que podamos revisarlo.',
			{ code: 'FILE_UNAVAILABLE' }
		);
	}
	if (
		message.includes('RADIOGRAPH_STATE_INVALID') ||
		message.includes('RADIOGRAPH_OBJECT_MISMATCH') ||
		message.includes('RADIOGRAPH_PROVIDER_INVALID')
	) {
		return new ClinicalFileHttpError(
			409,
			'La imagen cambió de estado. Actualizá la ficha e intentá de nuevo.',
			{ code: 'STATE_CONFLICT' }
		);
	}

	return new ClinicalFileHttpError(500, fallback, { code: 'OPERATION_FAILED' });
};

export const getClinicalFileRequestContext = async (
	event: Pick<RequestEvent, 'locals' | 'fetch' | 'cookies'>
): Promise<ClinicalFileRequestContext> => {
	const context = await getOdontoContext(event);
	const admin = await createSupabaseAdminClient('odonto', event.fetch);
	const role = context.business.role;
	const access = context.business.access;
	const capabilities = access.allowedCapabilities;
	const isManager = role === 'owner' || role === 'admin';
	const isProfessional = role === 'professional';
	const canView =
		(isManager || isProfessional) &&
		capabilities.canViewExistingClinicalNotes &&
		(isManager ? access.canEnterApp : access.canUseBusiness);
	const canUpload = canView && capabilities.canManagePatientFiles && access.canUseBusiness;
	const canViewTrash =
		isManager && capabilities.canViewExistingClinicalNotes && access.canEnterApp;
	const canTrash =
		isManager &&
		capabilities.canManagePatientFiles &&
		access.canUseBusiness;

	return {
		supabase: context.supabase,
		admin,
		businessId: context.business.business.id,
		userId: context.userId,
		role,
		canView,
		canUpload,
		canViewTrash,
		canTrash
	};
};

export const requireClinicalFileView = (context: ClinicalFileRequestContext) => {
	if (!context.canView) {
		throw new ClinicalFileHttpError(403, 'Tu rol no permite ver imágenes clínicas.', {
			code: 'ROLE_NOT_ALLOWED'
		});
	}
};

export const requireClinicalFileUpload = (context: ClinicalFileRequestContext) => {
	if (!context.canUpload) {
		throw new ClinicalFileHttpError(
			403,
			'Tu rol o acceso actual no permite cargar imágenes clínicas.',
			{ code: 'ROLE_NOT_ALLOWED' }
		);
	}
};

export const requireClinicalFileTrash = (context: ClinicalFileRequestContext) => {
	if (!context.canTrash) {
		throw new ClinicalFileHttpError(
			403,
			'Sólo el dueño o un administrador puede usar la papelera.',
			{ code: 'ROLE_NOT_ALLOWED' }
		);
	}
};

export const requireClinicalFileTrashView = (context: ClinicalFileRequestContext) => {
	if (!context.canViewTrash) {
		throw new ClinicalFileHttpError(
			403,
			'Sólo el dueño o un administrador puede consultar la papelera.',
			{ code: 'ROLE_NOT_ALLOWED' }
		);
	}
};

export const isClinicalFileMime = (value: unknown): value is ClinicalFileMime =>
	CLINICAL_FILE_MIME_TYPES.includes(value as ClinicalFileMime);

export const normalizeClinicalFilename = (value: unknown) => {
	const filename = String(value ?? '').trim();
	if (!filename || filename.length > 160 || /[\\/]/.test(filename)) return null;
	return filename;
};

export const normalizeClinicalDate = (value: unknown) => {
	const raw = String(value ?? '').trim();
	if (!raw) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
	const parsed = new Date(`${raw}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return undefined;
	return raw;
};

export const normalizeClinicalNote = (value: unknown) => {
	const note = String(value ?? '').trim();
	if (note.length > 500) return undefined;
	return note || null;
};

export const hasImageMagicBytes = (bytes: Uint8Array, mimeType: ClinicalFileMime) => {
 if(mimeType==='application/pdf')return false;
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

export const hasWebpMagicBytes = (bytes: Uint8Array) =>
	bytes.length >= 12 &&
	bytes[0] === 0x52 &&
	bytes[1] === 0x49 &&
	bytes[2] === 0x46 &&
	bytes[3] === 0x46 &&
	bytes[8] === 0x57 &&
	bytes[9] === 0x45 &&
	bytes[10] === 0x42 &&
	bytes[11] === 0x50;

const readResponsePrefix = async (response: Response, maxBytes = 32) => {
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: number[] = [];
	try {
		while (chunks.length < maxBytes) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const byte of value) {
				chunks.push(byte);
				if (chunks.length >= maxBytes) break;
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return Uint8Array.from(chunks);
};

export const createClinicalFileUploadUrls = async (
	admin: SupabaseClient,
	paths: { original: string; thumbnail: string | null }
) => {
	const bucket = admin.storage.from(CLINICAL_FILES_BUCKET);
	const [original, thumbnail] = await Promise.all([
		bucket.createSignedUploadUrl(paths.original, { upsert: false }),
		paths.thumbnail?bucket.createSignedUploadUrl(paths.thumbnail, { upsert: false }):Promise.resolve({data:{signedUrl:null},error:null})
	]);

	if (original.error || !original.data?.signedUrl || thumbnail.error || (paths.thumbnail&&!thumbnail.data?.signedUrl)) {
		throw new ClinicalFileHttpError(
			503,
			'No pudimos preparar la carga. Esperá un momento e intentá de nuevo.',
			{ code: 'STORAGE_UNAVAILABLE' }
		);
	}

	return {
		originalUrl: original.data.signedUrl,
		thumbnailUrl: thumbnail.data.signedUrl
	};
};

export const createSignedClinicalFileUrl = async ({
	admin,
	bucket,
	path,
	expiresIn,
	download
}: {
	admin: SupabaseClient;
	bucket: string;
	path: string;
	expiresIn: number;
	download?: string | boolean;
}) => {
	if (bucket !== CLINICAL_FILES_BUCKET || !path) {
		throw new ClinicalFileHttpError(409, 'La referencia del archivo no es válida.', {
			code: 'STATE_CONFLICT'
		});
	}
	const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, expiresIn, { download });
	if (error || !data?.signedUrl) {
		throw new ClinicalFileHttpError(
			503,
			'No pudimos abrir el archivo. Esperá un momento e intentá de nuevo.',
			{ code: 'STORAGE_UNAVAILABLE' }
		);
	}
	return data.signedUrl;
};

export const verifyStoredClinicalImage = async ({
	admin,
	bucket,
	path,
	expectedBytes,
	expectedMime
}: {
	admin: SupabaseClient;
	bucket: string;
	path: string;
	expectedBytes: number;
	expectedMime: ClinicalFileMime;
}) => {
	if (bucket !== CLINICAL_FILES_BUCKET || !path) {
		throw new ClinicalFileHttpError(409, 'La referencia del archivo no es válida.', {
			code: 'STATE_CONFLICT'
		});
	}

	const storage = admin.storage.from(bucket);
	const { data: info, error: infoError } = await storage.info(path);
	if (infoError || !info) {
		throw new ClinicalFileHttpError(409, 'La carga no terminó. Volvé a intentarlo.', {
			code: 'UPLOAD_CONFLICT'
		});
	}
	if (Number(info.size) !== expectedBytes || info.contentType !== expectedMime) {
		throw new ClinicalFileHttpError(409, 'El archivo recibido no coincide con el que elegiste.', {
			code: 'UPLOAD_CONFLICT'
		});
	}

	const signedUrl = await createSignedClinicalFileUrl({
		admin,
		bucket,
		path,
		expiresIn: 30
	});
	let response: Response;
	try {
		response = await globalThis.fetch(signedUrl, {
			headers: { Range: expectedMime==='application/pdf'?'bytes=0-1023':'bytes=0-31' },
			// Workers only supports "follow" and "manual". Manual preserves the
			// no-redirect boundary because every 3xx response fails the ok check below.
			redirect: 'manual',
			signal: AbortSignal.timeout(10_000)
		});
	} catch {
		// Never propagate the fetch error: runtimes may include the signed URL in
		// its cause and route boundaries log failures for operational diagnosis.
		throw new ClinicalFileHttpError(
			409,
			'No pudimos verificar el archivo cargado. Volvé a intentarlo.',
			{ code: 'UPLOAD_CONFLICT' }
		);
	}
	if (!response.ok) {
		throw new ClinicalFileHttpError(
			409,
			'No pudimos verificar el archivo cargado. Volvé a intentarlo.',
			{ code: 'UPLOAD_CONFLICT' }
		);
	}
    if(expectedMime==='application/pdf'){
        const prefix=await readResponsePrefix(response,1024);
        if(prefix.length!==Math.min(1024,expectedBytes)||(expectedBytes>1024&&response.status!==206)||!hasPdfHeader(prefix))throw new ClinicalFileHttpError(400,'No pudimos verificar el PDF. Elegí una copia completa y probá nuevamente.',{code:'INVALID_FILE_TYPE'});
        const headerRange=response.headers.get('content-range');
        if(response.status===206&&headerRange!==`bytes 0-${Math.min(1023,expectedBytes-1)}/${expectedBytes}`)throw new ClinicalFileHttpError(409,'No pudimos comprobar el archivo completo. Probá de nuevo.',{code:'UPLOAD_CONFLICT'});
        let tail:Response;
        try{tail=await globalThis.fetch(signedUrl,{headers:{Range:`bytes=${Math.max(0,expectedBytes-1024)}-${expectedBytes-1}`},redirect:'manual',signal:AbortSignal.timeout(10_000)});}catch{throw new ClinicalFileHttpError(409,'No pudimos verificar el PDF. Probá de nuevo.',{code:'UPLOAD_CONFLICT'});}
        if(!tail.ok||(tail.status!==206&&expectedBytes>1024)){await tail.body?.cancel();throw new ClinicalFileHttpError(409,'No pudimos comprobar el final del PDF. Probá de nuevo.',{code:'UPLOAD_CONFLICT'});}
        if(tail.status===206&&tail.headers.get('content-range')!==`bytes ${Math.max(0,expectedBytes-1024)}-${expectedBytes-1}/${expectedBytes}`){await tail.body?.cancel();throw new ClinicalFileHttpError(409,'La respuesta del archivo está incompleta. Probá de nuevo.',{code:'UPLOAD_CONFLICT'});}
        const end=await readResponsePrefix(tail,1024);
        if(end.length!==Math.min(1024,expectedBytes)||!hasPdfEof(end))throw new ClinicalFileHttpError(400,'El PDF parece incompleto. Elegí otra copia.',{code:'INVALID_FILE_TYPE'});
        return {bytes:Number(info.size),mimeType:expectedMime};
    }
	const prefix = await readResponsePrefix(response);
	if (!hasImageMagicBytes(prefix, expectedMime)) {
		throw new ClinicalFileHttpError(
			400,
			'El archivo no contiene una imagen JPG o PNG válida.',
			{ code: 'INVALID_FILE_TYPE' }
		);
	}

	return { bytes: Number(info.size), mimeType: info.contentType as ClinicalFileMime };
};

export const verifyStoredClinicalThumbnail = async ({
	admin,
	bucket,
	path
}: {
	admin: SupabaseClient;
	bucket: string;
	path: string;
}) => {
	if (bucket !== CLINICAL_FILES_BUCKET || !path) return false;
	const storage = admin.storage.from(bucket);
	const { data: info, error: infoError } = await storage.info(path);
	if (
		infoError ||
		!info ||
		info.contentType !== CLINICAL_FILE_THUMBNAIL_MIME ||
		!info.size ||
		info.size > 1024 * 1024
	) {
		return false;
	}

	try {
		const signedUrl = await createSignedClinicalFileUrl({ admin, bucket, path, expiresIn: 30 });
		const response = await globalThis.fetch(signedUrl, {
			headers: { Range: 'bytes=0-31' },
			// Do not follow a signed-storage redirect; see the original-image check.
			redirect: 'manual',
			signal: AbortSignal.timeout(10_000)
		});
		if (!response.ok) return false;
		return hasWebpMagicBytes(await readResponsePrefix(response));
	} catch {
		return false;
	}
};

export const clinicalFileCacheHeaders = {
	'cache-control': 'private, no-store',
	vary: 'Cookie'
};
