import {
	CLINICAL_FILES_BUCKET,
	CLINICAL_FILE_THUMBNAIL_URL_TTL_SECONDS,
	clinicalFileCacheHeaders,
	clinicalFileErrorBody,
	clinicalFileError,
	getClinicalFileRequestContext,
	requireClinicalFileTrashView
} from '$lib/server/clinical-files';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const PAGE_SIZE = 30;
type Cursor = { deletedAt: string; id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const decodeCursor = (value: string | null): Cursor | null => {
	if (!value) return null;
	if (value.length > 512) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
		if (
			typeof parsed.deletedAt !== 'string' ||
			!timestampPattern.test(parsed.deletedAt) ||
			Number.isNaN(Date.parse(parsed.deletedAt)) ||
			typeof parsed.id !== 'string' ||
			!uuidPattern.test(parsed.id)
		) return null;
		return { deletedAt: parsed.deletedAt, id: parsed.id };
	} catch {
		return null;
	}
};

const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export const GET: RequestHandler = async (event) => {
	event.setHeaders(clinicalFileCacheHeaders);
	try {
		const context = await getClinicalFileRequestContext(event);
		requireClinicalFileTrashView(context);
		const query = event.url.searchParams.get('q')?.trim().slice(0, 80) ?? '';
		const rawCursor = event.url.searchParams.get('cursor');
		const cursor = decodeCursor(rawCursor);
		if (rawCursor && !cursor) {
			return json(
				{
					code: 'INVALID_REQUEST',
					message: 'La página solicitada ya no es válida. Actualizá la papelera.'
				},
				{ status: 400 }
			);
		}

		const { data, error } = await context.supabase.rpc(
			'list_trashed_patient_radiographs_page' as never,
			{
				p_business_id: context.businessId,
				p_query: query,
				p_limit: PAGE_SIZE,
				p_cursor_deleted_at: cursor?.deletedAt ?? null,
				p_cursor_id: cursor?.id ?? null
			} as never
		);
		if (error) throw error;
		const rows = (Array.isArray(data) ? data : []) as Array<Record<string, any>>;
		const hasMore = rows.length > PAGE_SIZE;
		const visible = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
		const paths = visible
			.filter((row) => row.thumbnail_path && row.integrity_status === 'ok')
			.map((row) => String(row.thumbnail_path));
		const urls = new Map<string, string>();
		if (paths.length > 0) {
			const signed = await context.admin.storage
				.from(CLINICAL_FILES_BUCKET)
				.createSignedUrls(paths, CLINICAL_FILE_THUMBNAIL_URL_TTL_SECONDS);
			if (!signed.error && signed.data) {
				for (const item of signed.data) {
					if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
				}
			}
		}
		const items = visible.map((row) => ({
			id: row.id,
			patient_id: row.patient_id,
			patient_name: row.patient_name,
			original_filename: row.original_filename,
			mime_type: row.mime_type,
			bytes: row.bytes,
			taken_at: row.taken_at,
			created_at: row.created_at,
			deleted_at: row.deleted_at,
			deleted_by_label: row.deleted_by_label,
			integrity_status: row.integrity_status,
			thumbnail_url: row.thumbnail_path ? (urls.get(row.thumbnail_path) ?? null) : null
		}));
		const last = visible.at(-1);

		return json({
			items,
			has_more: hasMore,
			next_cursor:
				hasMore && last
					? encodeCursor({ deletedAt: String(last.deleted_at), id: String(last.id) })
					: null
		});
	} catch (cause) {
		console.error('Error cargando papelera de imágenes clínicas', cause);
		const safe = clinicalFileError(cause, 'No pudimos cargar la papelera. Probá de nuevo.');
		return json(clinicalFileErrorBody(safe), { status: safe.status });
	}
};
