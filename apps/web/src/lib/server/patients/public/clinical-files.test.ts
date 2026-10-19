import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getOdontoContext: vi.fn(),
	createSupabaseAdminClient: vi.fn()
}));

vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

const {
	CLINICAL_FILES_BUCKET,
	ClinicalFileHttpError,
	clinicalFileErrorBody,
	clinicalFileError,
	createClinicalFileUploadUrls,
	getClinicalFileRequestContext,
	hasImageMagicBytes,
	hasWebpMagicBytes,
	normalizeClinicalDate,
	normalizeClinicalFilename,
	normalizeClinicalNote,
	verifyStoredClinicalImage,
	verifyStoredClinicalThumbnail,
	cleanupAbandonedClinicalUploads,
	readExpiredClinicalUploads,
	reconcileClinicalStorage,
	removeExpiredClinicalUploads
} = await import('$lib/server/patients/public/clinical-files');
const { InvalidDataContractError } = await import('$lib/contracts/json');

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
]);

describe('clinical files server boundary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createSupabaseAdminClient.mockResolvedValue({ storage: {} });
	});

	afterEach(() => vi.unstubAllGlobals());

	it('derives the approved role matrix from clinical access and commercial capabilities', async () => {
		for (const [role, expected] of [
			['owner', { canView: true, canUpload: true, canViewTrash: true, canTrash: true }],
			['admin', { canView: true, canUpload: true, canViewTrash: true, canTrash: true }],
			['professional', { canView: true, canUpload: true, canViewTrash: false, canTrash: false }],
			['reception', { canView: false, canUpload: false, canViewTrash: false, canTrash: false }],
			['readonly', { canView: false, canUpload: false, canViewTrash: false, canTrash: false }]
		] as const) {
			mocks.getOdontoContext.mockResolvedValueOnce({
				supabase: {},
				userId: `user-${role}`,
				business: {
					business: { id: 'business-1' },
					role,
					// `canOperate` intentionally excludes professionals elsewhere in the
					// product; clinical files must use subscription capabilities instead.
					canOperate: role !== 'professional',
					access: {
						canEnterApp: true,
						canUseBusiness: true,
						allowedCapabilities: {
							canViewExistingClinicalNotes: true,
							canManagePatientFiles: true
						}
					}
				}
			});

			await expect(
				getClinicalFileRequestContext({ fetch: vi.fn(), cookies: {}, locals: {} } as never)
			).resolves.toMatchObject({ role, ...expected });
		}

		mocks.getOdontoContext.mockResolvedValueOnce({
			supabase: {},
			userId: 'professional-restricted',
			business: {
				business: { id: 'business-1' },
				role: 'professional',
				canOperate: false,
				access: {
					canEnterApp: true,
					canUseBusiness: false,
					allowedCapabilities: {
						canViewExistingClinicalNotes: true,
						canManagePatientFiles: false
					}
				}
			}
		});
		await expect(
			getClinicalFileRequestContext({ fetch: vi.fn(), cookies: {}, locals: {} } as never)
		).resolves.toMatchObject({
			canView: false,
			canUpload: false,
			canViewTrash: false,
			canTrash: false
		});

		mocks.getOdontoContext.mockResolvedValueOnce({
			supabase: {},
			userId: 'owner-restricted',
			business: {
				business: { id: 'business-1' },
				role: 'owner',
				canOperate: false,
				access: {
					canEnterApp: true,
					canUseBusiness: false,
					allowedCapabilities: {
						canViewExistingClinicalNotes: true,
						canManagePatientFiles: false
					}
				}
			}
		});
		await expect(
			getClinicalFileRequestContext({ fetch: vi.fn(), cookies: {}, locals: {} } as never)
		).resolves.toMatchObject({
			canView: true,
			canUpload: false,
			canViewTrash: true,
			canTrash: false
		});
	});

	it('normalizes metadata conservatively and recognizes only expected binary signatures', () => {
		expect(normalizeClinicalFilename(' panorámica 01.jpg ')).toBe('panorámica 01.jpg');
		expect(normalizeClinicalFilename('../panoramica.jpg')).toBeNull();
		expect(normalizeClinicalDate('2026-08-20')).toBe('2026-08-20');
		expect(normalizeClinicalDate('2026-02-30')).toBeUndefined();
		expect(normalizeClinicalDate('')).toBeNull();
		expect(normalizeClinicalNote('  control  ')).toBe('control');
		expect(normalizeClinicalNote('x'.repeat(501))).toBeUndefined();
		expect(hasImageMagicBytes(jpeg, 'image/jpeg')).toBe(true);
		expect(hasImageMagicBytes(png, 'image/png')).toBe(true);
		expect(hasImageMagicBytes(png, 'image/jpeg')).toBe(false);
		expect(hasWebpMagicBytes(webp)).toBe(true);
		expect(hasWebpMagicBytes(jpeg)).toBe(false);
	});

	it('maps backend failures to stable human messages without exposing internals', () => {
		expect(clinicalFileError(new Error('RADIOGRAPH_SIZE_INVALID'))).toMatchObject({
			status: 400, code: 'FILE_TOO_LARGE', userMessage: 'El archivo debe pesar hasta 5 MB.'
		});
		expect(clinicalFileError(new Error('RADIOGRAPH_FORMAT_INVALID'))).toMatchObject({
			status: 400, code: 'INVALID_FILE_TYPE', userMessage: 'Elegí un archivo PDF, JPG o PNG.'
		});
		expect(clinicalFileError(new Error('RADIOGRAPH_ACCESS_DENIED: row 123'))).toMatchObject({
			status: 403,
			code: 'ACCESS_DENIED',
			userMessage: 'No tenés permiso para realizar esta acción.'
		});
		expect(clinicalFileError(new Error('RADIOGRAPH_SERVER_REQUIRED'))).toMatchObject({
			status: 403,
			code: 'ACCESS_DENIED',
			userMessage: 'No tenés permiso para realizar esta acción.'
		});
		expect(clinicalFileError(new Error('RADIOGRAPH_INTEGRITY_INVALID'))).toMatchObject({
			status: 409,
			code: 'FILE_UNAVAILABLE',
			userMessage: 'El archivo no está disponible. Informá el problema para que podamos revisarlo.'
		});
		const unknown = clinicalFileError(
			new Error('PostgREST 42702 secret_table internal detail'),
			'No pudimos abrir la imagen. Probá de nuevo.'
		);
		expect(unknown).toBeInstanceOf(ClinicalFileHttpError);
		expect(unknown).toMatchObject({
			status: 500,
			code: 'OPERATION_FAILED',
			userMessage: 'No pudimos abrir la imagen. Probá de nuevo.'
		});
		expect(unknown.userMessage).not.toMatch(/42702|PostgREST|secret_table/i);
		expect(
			clinicalFileErrorBody(
				new ClinicalFileHttpError(429, 'Probá más tarde.', {
					code: 'RATE_LIMIT_REACHED',
					retryAfterSeconds: 90
				})
			)
		).toEqual({
			code: 'RATE_LIMIT_REACHED',
			message: 'Probá más tarde.',
			retryAfterSeconds: 90
		});
	});

	it('creates two exact non-upsert upload grants and fails closed if either one is unavailable', async () => {
		const expires = Math.floor(Date.now() / 1000) + 4 * 3600;
		const token = 'synthetic.' + Buffer.from(JSON.stringify({ exp: expires })).toString('base64url') + '.signature';
		const originalToken = 'synthetic.' + Buffer.from(JSON.stringify({ exp: expires - 3600 })).toString('base64url') + '.signature';
		const createSignedUploadUrl = vi
			.fn()
			.mockResolvedValueOnce({ data: { signedUrl: 'https://storage/original', token: originalToken }, error: null })
			.mockResolvedValueOnce({ data: { signedUrl: 'https://storage/thumbnail', token }, error: null });
		const protect = vi.fn().mockResolvedValue({ data: null, error: null });
		const admin = { rpc: protect, storage: { from: vi.fn(() => ({ createSignedUploadUrl })) } } as never;

		await expect(
			createClinicalFileUploadUrls(admin, {
				original: 'business/patient/file/original.jpg',
				thumbnail: 'business/patient/file/thumbnail.webp'
			})
		).resolves.toEqual({
			originalUrl: 'https://storage/original',
			thumbnailUrl: 'https://storage/thumbnail'
		});
		expect(protect).toHaveBeenCalledWith('protect_clinical_upload_urls', {
			p_bucket: 'patient-clinical-files', p_paths: ['business/patient/file/original.jpg', 'business/patient/file/thumbnail.webp'],
			p_expires_at: new Date(expires * 1000).toISOString()
		});
		expect(createSignedUploadUrl).toHaveBeenNthCalledWith(
			1,
			'business/patient/file/original.jpg',
			{ upsert: false }
		);
		expect(createSignedUploadUrl).toHaveBeenNthCalledWith(
			2,
			'business/patient/file/thumbnail.webp',
			{ upsert: false }
		);

		createSignedUploadUrl.mockReset();
		createSignedUploadUrl
			.mockResolvedValueOnce({ data: { signedUrl: 'https://storage/original' }, error: null })
			.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
		await expect(
			createClinicalFileUploadUrls(admin, {
				original: 'business/patient/file/original.jpg',
				thumbnail: 'business/patient/file/thumbnail.webp'
			})
		).rejects.toMatchObject({ status: 503 });
	});

	it('never exposes upload URLs with unknown/expired expiration or failed SQL protection', async () => {
		const expired = 'synthetic.' + Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url') + '.signature';
		const valid = 'synthetic.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url') + '.signature';
		for (const token of [undefined, 'malformed-private-provider-token', expired, valid]) {
			const protect = vi.fn().mockResolvedValue({ error: { message: 'protection failed' } });
			const admin = { rpc: protect, storage: { from: () => ({ createSignedUploadUrl: async () => ({
				data: { signedUrl: 'https://storage/private-url', token }, error: null
			}) }) } } as never;
			await expect(createClinicalFileUploadUrls(admin, { original: 'owned/original.pdf', thumbnail: null }))
				.rejects.toMatchObject({ status: 503 });
			if (token !== valid) expect(protect).not.toHaveBeenCalled();
		}
	});

	it('verifies stored size, MIME and magic bytes before accepting an original', async () => {
		const info = vi.fn(async () => ({
			data: { size: 6, contentType: 'image/jpeg' },
			error: null
		}));
		const createSignedUrl = vi.fn(async () => ({
			data: { signedUrl: 'https://storage.example.test/signed-original' },
			error: null
		}));
		const admin = {
			storage: { from: vi.fn(() => ({ info, createSignedUrl })) }
		} as never;
		const fetchMock = vi.fn(async () => new Response(jpeg, { status: 206 }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			verifyStoredClinicalImage({
				admin,
				bucket: CLINICAL_FILES_BUCKET,
				path: 'business/patient/file/original.jpg',
				expectedBytes: 6,
				expectedMime: 'image/jpeg'
			})
		).resolves.toEqual({ bytes: 6, mimeType: 'image/jpeg' });
		expect(fetchMock).toHaveBeenCalledWith(
			'https://storage.example.test/signed-original',
			expect.objectContaining({ headers: { Range: 'bytes=0-31' }, redirect: 'manual' })
		);

		info.mockResolvedValueOnce({ data: { size: 7, contentType: 'image/jpeg' }, error: null });
		await expect(
			verifyStoredClinicalImage({
				admin,
				bucket: CLINICAL_FILES_BUCKET,
				path: 'business/patient/file/original.jpg',
				expectedBytes: 6,
				expectedMime: 'image/jpeg'
			})
		).rejects.toMatchObject({ status: 409 });

		fetchMock.mockResolvedValueOnce(new Response(png, { status: 206 }));
		await expect(
			verifyStoredClinicalImage({
				admin,
				bucket: CLINICAL_FILES_BUCKET,
				path: 'business/patient/file/original.jpg',
				expectedBytes: 6,
				expectedMime: 'image/jpeg'
			})
		).rejects.toMatchObject({ status: 400 });

		fetchMock.mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: 'https://unexpected.example.test/image' }
			})
		);
		await expect(
			verifyStoredClinicalImage({
				admin,
				bucket: CLINICAL_FILES_BUCKET,
				path: 'business/patient/file/original.jpg',
				expectedBytes: 6,
				expectedMime: 'image/jpeg'
			})
		).rejects.toMatchObject({ status: 409, code: 'UPLOAD_CONFLICT' });

		fetchMock.mockRejectedValueOnce(
			new TypeError('GET https://storage.example.test/signed-original?token=secret failed')
		);
		await expect(
			verifyStoredClinicalImage({
				admin,
				bucket: CLINICAL_FILES_BUCKET,
				path: 'business/patient/file/original.jpg',
				expectedBytes: 6,
				expectedMime: 'image/jpeg'
			})
		).rejects.toMatchObject({
			status: 409,
			code: 'UPLOAD_CONFLICT',
			message: 'No pudimos verificar el archivo cargado. Volvé a intentarlo.'
		});
	});

	it('treats thumbnails as optional and accepts only a small valid WebP', async () => {
		const info = vi.fn(async () => ({
			data: { size: 12, contentType: 'image/webp' },
			error: null
		}));
		const createSignedUrl = vi.fn(async () => ({
			data: { signedUrl: 'https://storage.example.test/signed-thumb' },
			error: null
		}));
		const admin = { storage: { from: vi.fn(() => ({ info, createSignedUrl })) } } as never;
		const fetchMock = vi.fn(async () => new Response(webp, { status: 206 }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			verifyStoredClinicalThumbnail({
				admin,
				bucket: CLINICAL_FILES_BUCKET,
				path: 'business/patient/file/thumbnail.webp'
			})
		).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://storage.example.test/signed-thumb',
			expect.objectContaining({ headers: { Range: 'bytes=0-31' }, redirect: 'manual' })
		);

		info.mockResolvedValueOnce({
			data: { size: 12, contentType: 'image/png' },
			error: null
		});
		await expect(
			verifyStoredClinicalThumbnail({
				admin,
				bucket: CLINICAL_FILES_BUCKET,
				path: 'business/patient/file/thumbnail.webp'
			})
		).resolves.toBe(false);
	});
});

describe('bounded PDF storage verification',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 const originalSize=5000;
 const admin=()=>({storage:{from:()=>({info:async()=>({data:{size:originalSize,contentType:'application/pdf'},error:null}),createSignedUrl:async()=>({data:{signedUrl:'https://isolated.example.test/object'},error:null})})}});
 const verify=()=>verifyStoredClinicalImage({admin:admin() as never,bucket:CLINICAL_FILES_BUCKET,path:'synthetic/original.pdf',expectedBytes:originalSize,expectedMime:'application/pdf'});
 function partial(start:number,end:number,version='2.0'){
  const data=new Uint8Array(end-start+1).fill(32);if(start===0)data.set(new TextEncoder().encode('%PDF-'+version+'\n'));else data.set(new TextEncoder().encode('\n%%EOF\n'),data.length-7);
  return new Response(data,{status:206,headers:{'content-range':`bytes ${start}-${end}/${originalSize}`}});
 }
 it('reads only the prefix and tail and verifies their exact ranges',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(partial(0,1023)).mockResolvedValueOnce(partial(3976,4999));vi.stubGlobal('fetch',fetch);
  expect(await verify()).toEqual({bytes:5000,mimeType:'application/pdf'});
  expect(fetch.mock.calls.map(call=>call[1].headers.Range)).toEqual(['bytes=0-1023','bytes=3976-4999']);
 });
 it('stops a large response when Range is ignored',async()=>{
  const cancel=vi.fn();const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2048).fill(32));},cancel});const fetch=vi.fn().mockResolvedValue(new Response(stream,{status:200}));vi.stubGlobal('fetch',fetch);
  await expect(verify()).rejects.toMatchObject({status:400});expect(cancel).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
 });
 it('rejects a mismatching Content-Range before using the tail',async()=>{
  const response=partial(0,1023);response.headers.set('content-range','bytes 0-1023/9000');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));await expect(verify()).rejects.toMatchObject({status:409});
 });
 it('rejects a missing PDF closing marker',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(partial(0,1023)).mockResolvedValueOnce(new Response(new Uint8Array(1024),{status:206,headers:{'content-range':'bytes 3976-4999/5000'}})));await expect(verify()).rejects.toMatchObject({status:400});
 });
});

describe('human HTTP boundary errors',()=>{
 it('preserves an unavailable reservation link status',async()=>{
  const {error}=await import('@sveltejs/kit');let cause;try{error(404,'Este enlace no está disponible. Abrí el enlace de tu turno.');}catch(thrown){cause=thrown;}
  expect(clinicalFileError(cause)).toMatchObject({status:404,code:'FILE_UNAVAILABLE',userMessage:'Este enlace no está disponible. Abrí el enlace de tu turno.'});
 });
 it('explains an expired clinic session instead of treating a login redirect as a storage fault',async()=>{
  const {redirect}=await import('@sveltejs/kit');let cause;try{redirect(303,'/login');}catch(thrown){cause=thrown;}
  expect(clinicalFileError(cause)).toMatchObject({status:401,code:'AUTH_REQUIRED'});
 });
});

describe('limpieza de cargas abandonadas', () => {
	const storage = (failOn?: string) => {
		const removals: Array<{ bucket: string; paths: string[] }> = [];
		return {
			removals,
			admin: {
				storage: {
					from: (bucket: string) => ({
						remove: async (paths: string[]) => {
							removals.push({ bucket, paths });
							return paths.includes(failOn ?? '') ? { data: null, error: { message: 'unavailable' } } : { data: [], error: null };
						}
					})
				}
			} as any
		};
	};

	it('valida lo reclamado antes de borrar cualquier objeto', () => {
		expect(readExpiredClinicalUploads([{ id: 'f1', bucket: 'b', paths: ['a', 'b'] }])).toEqual([{ bucket: 'b', paths: ['a', 'b'] }]);
		for (const malformed of [null, [{ bucket: 'b' }], [{ bucket: 1, paths: [] }], [{ bucket: 'b', paths: [2] }]])
			expect(() => readExpiredClinicalUploads(malformed)).toThrow(InvalidDataContractError);
	});

	it('agrupa por bucket y borra en pedidos acotados', async () => {
		const { admin, removals } = storage();
		const many = Array.from({ length: 150 }, (_, index) => `business/patient/file-${index}/original.pdf`);
		const objects = await removeExpiredClinicalUploads(admin, [
			{ bucket: CLINICAL_FILES_BUCKET, paths: many.slice(0, 120) },
			{ bucket: 'other-bucket', paths: ['x/preview.webp'] },
			{ bucket: CLINICAL_FILES_BUCKET, paths: many.slice(120) }
		]);
		expect(objects).toBe(151);
		expect(removals.map(({ bucket, paths }) => [bucket, paths.length])).toEqual([
			[CLINICAL_FILES_BUCKET, 100],
			[CLINICAL_FILES_BUCKET, 50],
			['other-bucket', 1]
		]);
		expect(removals.flatMap(({ paths }) => paths)).toEqual([...many.slice(0, 100), ...many.slice(100), 'x/preview.webp']);
	});

	it('un borrado fallido se informa para que la próxima limpieza lo repita', async () => {
		const { admin } = storage('b/2');
		await expect(removeExpiredClinicalUploads(admin, [{ bucket: 'b', paths: ['b/1', 'b/2'] }])).rejects.toMatchObject({ message: 'unavailable' });
	});

	it('la tarea programada reclama para todos los consultorios y borra lo devuelto', async () => {
		const { admin, removals } = storage();
		const calls: Array<[string, unknown]> = [];
		admin.rpc = async (name: string, args: unknown) => {
			calls.push([name, args]);
			return { data: [{ id: 'f1', bucket: CLINICAL_FILES_BUCKET, paths: ['p/1', 'p/1.webp'] }, { id: 'f2', bucket: CLINICAL_FILES_BUCKET, paths: ['p/2'] }], error: null };
		};
		await expect(cleanupAbandonedClinicalUploads(admin, 200)).resolves.toEqual({ files: 2, objects: 3 });
		expect(calls).toEqual([['claim_abandoned_clinical_uploads', { p_limit: 200 }]]);
		expect(removals).toEqual([{ bucket: CLINICAL_FILES_BUCKET, paths: ['p/1', 'p/1.webp', 'p/2'] }]);
	});

	it('la reconciliación informa el sobrecompromiso tal como lo encuentra', async () => {
		const admin = {
			rpc: async () => ({ data: { unattributed_bytes: 10, unknown_size_objects: 0, over_global_limit: false, over_business_limit: 2 }, error: null })
		} as any;
		await expect(reconcileClinicalStorage(admin)).resolves.toEqual({
			unattributedBytes: 10,
			unknownSizeObjects: 0,
			overGlobalLimit: false,
			overBusinessLimit: 2
		});
		admin.rpc = async () => ({ data: { unattributed_bytes: 10 }, error: null });
		await expect(reconcileClinicalStorage(admin)).rejects.toBeInstanceOf(InvalidDataContractError);
	});
});

