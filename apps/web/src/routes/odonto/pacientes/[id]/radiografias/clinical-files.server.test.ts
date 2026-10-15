import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getClinicalFileRequestContext: vi.fn(),
	createClinicalFileUploadUrls: vi.fn(),
	createSignedClinicalFileUrl: vi.fn(),
	verifyStoredClinicalImage: vi.fn(),
	verifyStoredClinicalThumbnail: vi.fn(),
	enforceRateLimits: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: { DEMO_MODE: 'false', RATE_LIMIT_SALT: 'clinical-route-test-salt' }
}));

vi.mock('$lib/server/clinical-files', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/clinical-files')>()),
	getClinicalFileRequestContext: mocks.getClinicalFileRequestContext,
	createClinicalFileUploadUrls: mocks.createClinicalFileUploadUrls,
	createSignedClinicalFileUrl: mocks.createSignedClinicalFileUrl,
	verifyStoredClinicalImage: mocks.verifyStoredClinicalImage,
	verifyStoredClinicalThumbnail: mocks.verifyStoredClinicalThumbnail
}));

vi.mock('$lib/server/rate-limits', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/rate-limits')>()),
	enforceRateLimits: mocks.enforceRateLimits
}));

const [
	{ GET: listActive },
	{ POST: beginUpload },
	{ POST: completeUpload },
	{ POST: grantAccess },
	{ POST: markFailed },
	{ POST: trash },
	{ POST: restore },
	{ GET: listTrash }
] =
	await Promise.all([
		import('./+server'),
		import('./uploads/+server'),
		import('./[radiographId]/complete/+server'),
		import('./[radiographId]/access-grants/+server'),
		import('./[radiographId]/failed/+server'),
		import('./[radiographId]/trash/+server'),
		import('../../papelera/[radiographId]/restore/+server'),
		import('../../papelera/lista/+server')
	]);

const { ClinicalFileHttpError } = await import('$lib/server/clinical-files');

const businessId = '10000000-0000-4000-8000-000000000001';
const patientId = '20000000-0000-4000-8000-000000000001';
const radiographId = '30000000-0000-4000-8000-000000000001';
const userId = '40000000-0000-4000-8000-000000000001';
const clientRequestId = '50000000-0000-4000-8000-000000000001';

const eventFor = (path: string, body?: unknown) => {
	const request = new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return {
		request,
		params: { id: patientId, radiographId },
		setHeaders: vi.fn(),
		fetch: vi.fn(),
		locals: {},
		cookies: {}
	} as any;
};

const getEventFor = (path: string) => ({
	request: new Request(`http://localhost${path}`),
	url: new URL(`http://localhost${path}`),
	params: { id: patientId, radiographId },
	setHeaders: vi.fn(),
	fetch: vi.fn(),
	locals: {},
	cookies: {}
}) as any;

const makeContext = ({
	rpc = vi.fn(),
	from = vi.fn(),
	admin,
	canView = true,
	canUpload = true,
	canViewTrash = true,
	canTrash = true
}: {
	rpc?: ReturnType<typeof vi.fn>;
	from?: ReturnType<typeof vi.fn>;
	admin?: any;
	canView?: boolean;
	canUpload?: boolean;
	canViewTrash?: boolean;
	canTrash?: boolean;
} = {}) => ({
	supabase: { rpc, from },
	admin: admin ?? { storage: {}, rpc },
	businessId,
	userId,
	role: 'owner' as const,
	canView,
	canUpload,
	canViewTrash,
	canTrash
});

const validUploadBody = {
	clientRequestId,
	originalFilename: 'panoramica.jpg',
	mimeType: 'image/jpeg',
	bytes: 1024,
	sha256: 'a'.repeat(64),
	takenAt: '2026-08-20',
	note: 'Panorámica inicial'
};

describe('clinical file HTTP contracts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.enforceRateLimits.mockResolvedValue(undefined);
		mocks.verifyStoredClinicalImage.mockResolvedValue({ bytes: 1024, mimeType: 'image/jpeg' });
		mocks.verifyStoredClinicalThumbnail.mockResolvedValue(true);
		mocks.createClinicalFileUploadUrls.mockResolvedValue({
			originalUrl: 'https://storage.example.test/upload-original',
			thumbnailUrl: 'https://storage.example.test/upload-thumbnail'
		});
		mocks.createSignedClinicalFileUrl.mockResolvedValue(
			'https://storage.example.test/view-original'
		);
	});

	it('lists only a bounded active page and signs thumbnails only for integrity-ok rows', async () => {
		const rows = Array.from({ length: 31 }, (_, index) => ({
			id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
			patient_id: patientId,
			status: 'ready',
			original_filename: `imagen-${index + 1}.jpg`,
			mime_type: 'image/jpeg',
			bytes: 1024,
			taken_at: null,
			note: null,
			created_at: new Date(Date.UTC(2026, 7, 20, 12, 0, 0) - index * 60_000).toISOString(),
			ready_at: '2026-08-20T12:00:00.000Z',
			integrity_status: index === 1 ? 'missing' : 'ok',
			storage_bucket: 'patient-clinical-files',
			thumbnail_path:
				index < 2 ? `${businessId}/${patientId}/file-${index}/thumbnail.webp` : null,
			uploaded_by: index === 0 ? userId : 'another-user'
		}));
		const builder: any = {
			select: vi.fn(() => builder),
			eq: vi.fn(() => builder),
			in: vi.fn(() => builder),
			order: vi.fn(() => builder),
			limit: vi.fn(() => builder),
			or: vi.fn(() => builder),
			then: (resolve: (value: unknown) => unknown) =>
				Promise.resolve({ data: rows, error: null }).then(resolve)
		};
		const createSignedUrls = vi.fn(async (paths: string[]) => ({
			data: paths.map((path) => ({ path, signedUrl: `https://storage.example.test/${path}` })),
			error: null
		}));
		mocks.getClinicalFileRequestContext.mockResolvedValue(
			makeContext({
				from: vi.fn(() => builder),
				admin: { storage: { from: vi.fn(() => ({ createSignedUrls })) } }
			})
		);

		const response = await listActive(
			getEventFor(`/odonto/pacientes/${patientId}/radiografias`)
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.items).toHaveLength(30);
		expect(payload.has_more).toBe(true);
		expect(payload.next_cursor).toEqual(expect.any(String));
		expect(builder.eq).toHaveBeenCalledWith('storage_provider', 'supabase_storage');
		expect(builder.in).toHaveBeenCalledWith('status', ['ready', 'uploading', 'failed']);
		expect(builder.limit).toHaveBeenCalledWith(31);
		expect(createSignedUrls).toHaveBeenCalledWith(
			[`${businessId}/${patientId}/file-0/thumbnail.webp`],
			300
		);
		expect(payload.items[0].thumbnail_url).toContain('file-0/thumbnail.webp');
		expect(payload.items[1].thumbnail_url).toBeNull();
		expect(payload.items[0]).not.toHaveProperty('storage_path');
	});

	it('rejects a malformed active-list cursor before building a database filter', async () => {
		const from = vi.fn();
		mocks.getClinicalFileRequestContext.mockResolvedValue(makeContext({ from }));
		const unsafeCursor = Buffer.from(
			JSON.stringify({
				createdAt: 'August 20, 2026),or(true)',
				id: '------------------------------------'
			})
		).toString('base64url');
		const response = await listActive(
			getEventFor(`/odonto/pacientes/${patientId}/radiografias?cursor=${unsafeCursor}`)
		);

		expect(response.status).toBe(400);
		expect(from).not.toHaveBeenCalled();
	});

	it('begins an authorized upload, rate-limits it and returns only exact signed destinations', async () => {
		const rpc = vi.fn(async () => ({
			data: [
				{
					radiograph_id: radiographId,
					storage_bucket: 'patient-clinical-files',
					storage_path: `${businessId}/${patientId}/${radiographId}/original.jpg`,
					thumbnail_path: `${businessId}/${patientId}/${radiographId}/thumbnail.webp`,
					status: 'uploading'
				}
			],
			error: null
		}));
		mocks.getClinicalFileRequestContext.mockResolvedValue(makeContext({ rpc }));
		const event = eventFor(`/odonto/pacientes/${patientId}/radiografias/uploads`, validUploadBody);

		const response = await beginUpload(event);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload).toEqual({
			id: radiographId,
			upload_url: 'https://storage.example.test/upload-original',
			thumbnail_upload_url: 'https://storage.example.test/upload-thumbnail'
		});
		expect(mocks.enforceRateLimits).toHaveBeenCalledTimes(1);
		expect(rpc).toHaveBeenCalledWith('begin_patient_radiograph_upload', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_client_request_id: clientRequestId,
			p_original_filename: 'panoramica.jpg',
			p_mime_type: 'image/jpeg',
			p_bytes: 1024,
			p_sha256: 'a'.repeat(64),
			p_taken_at: '2026-08-20',
			p_note: 'Panorámica inicial'
		});
		expect(mocks.createClinicalFileUploadUrls).toHaveBeenCalledWith(
			expect.anything(),
			{
				original: `${businessId}/${patientId}/${radiographId}/original.jpg`,
				thumbnail: `${businessId}/${patientId}/${radiographId}/thumbnail.webp`
			}
		);
		expect(event.setHeaders).toHaveBeenCalledWith(
			expect.objectContaining({ 'cache-control': 'private, no-store' })
		);
	});

	it('rejects invalid client metadata before consuming a rate limit or touching the database', async () => {
		const rpc = vi.fn();
		mocks.getClinicalFileRequestContext.mockResolvedValue(makeContext({ rpc }));
		const response = await beginUpload(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/uploads`, {
				...validUploadBody,
				mimeType: 'image/gif'
			})
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			code: 'INVALID_FILE_TYPE',
			message: 'Elegí un archivo JPG, PNG o PDF.'
		});
		expect(mocks.enforceRateLimits).not.toHaveBeenCalled();
		expect(rpc).not.toHaveBeenCalled();
	});

	it('returns an idempotent completed result without issuing new upload grants', async () => {
		const rpc = vi.fn(async () => ({
			data: [{ radiograph_id: radiographId, status: 'ready' }],
			error: null
		}));
		mocks.getClinicalFileRequestContext.mockResolvedValue(makeContext({ rpc }));
		const response = await beginUpload(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/uploads`, validUploadBody)
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: radiographId, already_complete: true });
		expect(mocks.createClinicalFileUploadUrls).not.toHaveBeenCalled();
	});

	it('marks the pending row failed when signed upload preparation cannot be completed', async () => {
		const row = {
			radiograph_id: radiographId,
			storage_path: `${businessId}/${patientId}/${radiographId}/original.jpg`,
			thumbnail_path: `${businessId}/${patientId}/${radiographId}/thumbnail.webp`,
			status: 'uploading'
		};
		const rpc = vi
			.fn()
			.mockResolvedValueOnce({ data: [row], error: null })
			.mockResolvedValueOnce({ data: radiographId, error: null });
		mocks.getClinicalFileRequestContext.mockResolvedValue(makeContext({ rpc }));
		mocks.createClinicalFileUploadUrls.mockRejectedValue(
			new ClinicalFileHttpError(503, 'No pudimos preparar la carga. Esperá un momento e intentá de nuevo.')
		);

		const response = await beginUpload(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/uploads`, validUploadBody)
		);
		expect(response.status).toBe(503);
		expect(rpc).toHaveBeenNthCalledWith(2, 'fail_patient_radiograph_upload', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_radiograph_id: radiographId,
			p_failure_code: 'signed_url_failed'
		});
	});

	it('completes only after server-side object and optional thumbnail verification', async () => {
		const row = {
			id: radiographId,
			status: 'uploading',
			storage_bucket: 'patient-clinical-files',
			storage_path: `${businessId}/${patientId}/${radiographId}/original.jpg`,
			thumbnail_path: `${businessId}/${patientId}/${radiographId}/thumbnail.webp`,
			bytes: 1024,
			mime_type: 'image/jpeg',
			uploaded_by: userId
		};
		const builder: any = {
			select: vi.fn(() => builder),
			eq: vi.fn(() => builder),
			maybeSingle: vi.fn(async () => ({ data: row, error: null }))
		};
		const rpc = vi.fn(async () => ({ data: radiographId, error: null }));
		mocks.getClinicalFileRequestContext.mockResolvedValue(
			makeContext({ rpc, from: vi.fn(() => builder) })
		);

		const response = await completeUpload(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/${radiographId}/complete`, {
				thumbnailUploaded: true
			})
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: radiographId,
			ready: true,
			thumbnail_ready: true
		});
		expect(mocks.verifyStoredClinicalImage).toHaveBeenCalledWith(
			expect.objectContaining({
				bucket: 'patient-clinical-files',
				path: row.storage_path,
				expectedBytes: 1024,
				expectedMime: 'image/jpeg'
			})
		);
		expect(mocks.verifyStoredClinicalThumbnail).toHaveBeenCalledWith(
			expect.objectContaining({ path: row.thumbnail_path })
		);
		expect(rpc).toHaveBeenCalledWith('complete_patient_radiograph_upload', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_radiograph_id: radiographId,
			p_actual_bytes: 1024,
			p_actual_mime_type: 'image/jpeg',
			p_thumbnail_uploaded: true
		});
	});

	it('fails the pending state when server object validation rejects the uploaded bytes', async () => {
		const row = {
			id: radiographId,
			status: 'uploading',
			storage_bucket: 'patient-clinical-files',
			storage_path: `${businessId}/${patientId}/${radiographId}/original.jpg`,
			thumbnail_path: null,
			bytes: 1024,
			mime_type: 'image/jpeg',
			uploaded_by: userId
		};
		const builder: any = {
			select: vi.fn(() => builder),
			eq: vi.fn(() => builder),
			maybeSingle: vi.fn(async () => ({ data: row, error: null }))
		};
		const rpc = vi.fn(async () => ({ data: radiographId, error: null }));
		mocks.getClinicalFileRequestContext.mockResolvedValue(
			makeContext({ rpc, from: vi.fn(() => builder) })
		);
		mocks.verifyStoredClinicalImage.mockRejectedValue(
			new ClinicalFileHttpError(409, 'La imagen recibida no coincide con la que elegiste.')
		);

		const response = await completeUpload(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/${radiographId}/complete`, {})
		);
		expect(response.status).toBe(409);
		expect(rpc).toHaveBeenCalledWith('fail_patient_radiograph_upload', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_radiograph_id: radiographId,
			p_failure_code: 'object_validation_failed'
		});
	});

	it('audits through the access RPC before returning a 60-second original URL', async () => {
		const rpc = vi.fn(async () => ({
			data: [
				{
					storage_bucket: 'patient-clinical-files',
					storage_path: `${businessId}/${patientId}/${radiographId}/original.jpg`,
					original_filename: 'panoramica.jpg',
					mime_type: 'image/jpeg',
					bytes: 1024
				}
			],
			error: null
		}));
		const patientQuery:any={select:()=>patientQuery,eq:()=>patientQuery,single:async()=>({data:{full_name:'Ana Pérez Sintética'},error:null})};
		mocks.getClinicalFileRequestContext.mockResolvedValue(makeContext({ rpc,from:vi.fn(()=>patientQuery) }));
		const response = await grantAccess(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/${radiographId}/access-grants`)
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.url).toBe('https://storage.example.test/view-original');
		expect(Date.parse(payload.expires_at)).toBeGreaterThan(Date.now() + 55_000);
		expect(rpc).toHaveBeenCalledWith('grant_patient_radiograph_original_access', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_radiograph_id: radiographId
		});
		expect(mocks.createSignedClinicalFileUrl).toHaveBeenCalledWith(
			expect.objectContaining({ expiresIn: 60 })
		);
	});

	it('routes failed, trash and restore transitions only through their dedicated RPCs', async () => {
		const rpc = vi.fn(async () => ({ data: radiographId, error: null }));
		mocks.getClinicalFileRequestContext.mockResolvedValue(makeContext({ rpc }));

		const failedResponse = await markFailed(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/${radiographId}/failed`, {
				reason: 'client_upload_failed'
			})
		);
		const trashResponse = await trash(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/${radiographId}/trash`)
		);
		const restoreResponse = await restore(
			eventFor(`/odonto/pacientes/papelera/${radiographId}/restore`)
		);

		expect(failedResponse.status).toBe(200);
		expect(trashResponse.status).toBe(200);
		expect(restoreResponse.status).toBe(200);
		expect(rpc).toHaveBeenCalledWith('fail_patient_radiograph_upload', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_radiograph_id: radiographId,
			p_failure_code: 'client_upload_failed'
		});
		expect(rpc).toHaveBeenCalledWith('trash_patient_radiograph', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_radiograph_id: radiographId
		});
		expect(rpc).toHaveBeenCalledWith('restore_patient_radiograph', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_radiograph_id: radiographId
		});
	});

	it('does not persist arbitrary client text as an upload failure code', async () => {
		const rpc = vi.fn(async () => ({ data: radiographId, error: null }));
		mocks.getClinicalFileRequestContext.mockResolvedValue(makeContext({ rpc }));

		const response = await markFailed(
			eventFor(`/odonto/pacientes/${patientId}/radiografias/${radiographId}/failed`, {
				reason: 'DNI 30111222: error interno con datos del paciente'
			})
		);

		expect(response.status).toBe(200);
		expect(rpc).toHaveBeenCalledWith('fail_patient_radiograph_upload', {
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_radiograph_id: radiographId,
			p_failure_code: 'client_upload_failed'
		});
	});

	it('lists a bounded owner/admin trash page and never exposes storage paths', async () => {
		const rows = Array.from({ length: 31 }, (_, index) => ({
			id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
			patient_id: patientId,
			patient_name: `Paciente ${index + 1}`,
			original_filename: `papelera-${index + 1}.jpg`,
			mime_type: 'image/jpeg',
			bytes: 2048,
			taken_at: null,
			created_at: '2026-08-01T12:00:00.000Z',
			deleted_at: new Date(Date.UTC(2026, 7, 20, 12, 0, 0) - index * 60_000).toISOString(),
			deleted_by_label: 'Administrador',
			integrity_status: index === 0 ? 'ok' : 'missing',
			storage_bucket: 'patient-clinical-files',
			storage_path: `${businessId}/${patientId}/file-${index}/original.jpg`,
			thumbnail_path:
				index === 0 ? `${businessId}/${patientId}/file-${index}/thumbnail.webp` : null
		}));
		const rpc = vi.fn(async () => ({ data: rows, error: null }));
		const createSignedUrls = vi.fn(async (paths: string[]) => ({
			data: paths.map((path) => ({ path, signedUrl: `https://storage.example.test/${path}` })),
			error: null
		}));
		mocks.getClinicalFileRequestContext.mockResolvedValue(
			makeContext({
				rpc,
				canTrash: false,
				admin: { storage: { from: vi.fn(() => ({ createSignedUrls })) } }
			})
		);

		const response = await listTrash(
			getEventFor('/odonto/pacientes/papelera/lista?q=Paciente')
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.items).toHaveLength(30);
		expect(payload.has_more).toBe(true);
		expect(rpc).toHaveBeenCalledWith('list_trashed_patient_radiographs_page', {
			p_business_id: businessId,
			p_query: 'Paciente',
			p_limit: 30,
			p_cursor_deleted_at: null,
			p_cursor_id: null
		});
		expect(createSignedUrls).toHaveBeenCalledTimes(1);
		expect(payload.items[0].thumbnail_url).toContain('thumbnail.webp');
		expect(payload.items[0]).not.toHaveProperty('storage_path');
		expect(payload.items[0]).not.toHaveProperty('storage_bucket');
	});
});
