import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import { readRecord } from '$lib/contracts/json';
import { env } from '$env/dynamic/private';
import {
	CLINICAL_FILES_BUCKET,
	CLINICAL_FILE_THUMBNAIL_URL_TTL_SECONDS,
	clinicalFileCacheHeaders,
	clinicalFileErrorBody,
	clinicalFileError,
	getClinicalFileRequestContext,
	requireClinicalFileView
} from '$lib/server/patients/public/clinical-files';
import { readDemoDb } from '$lib/server/platform/demo-store';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const PAGE_SIZE = 30;

type Cursor = { createdAt: string; id: string };
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const decodeCursor = (value: string | null): Cursor | null => {
	if (!value) return null;
	if (value.length > 512) return null;
	try {
		const parsed = readRecord(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')), 'patientFiles.cursor');
		if (
			typeof parsed.createdAt !== 'string' ||
			!timestampPattern.test(parsed.createdAt) ||
			Number.isNaN(Date.parse(parsed.createdAt)) ||
			typeof parsed.id !== 'string' ||
			!isUuid(parsed.id)
		) {
			return null;
		}
		return { createdAt: parsed.createdAt, id: parsed.id };
	} catch {
		return null;
	}
};

const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export const GET: RequestHandler = async (event) => {
	event.setHeaders(clinicalFileCacheHeaders);

	if (env.DEMO_MODE === 'true') {
		const rows = readDemoDb().radiographs.filter((row) => row.patient_id === event.params.id);
		return json({ items: rows, has_more: false, next_cursor: null });
	}

	try {
		const context = await getClinicalFileRequestContext(event);
		requireClinicalFileView(context);
		const rawCursor = event.url.searchParams.get('cursor');
		const cursor = decodeCursor(rawCursor);
		if (rawCursor && !cursor) {
			return json(
				{
					code: 'INVALID_REQUEST',
					message: 'La página solicitada ya no es válida. Actualizá la ficha.'
				},
				{ status: 400 }
			);
		}

		let query = context.supabase
			.from('patient_radiographs')
			.select(
				'id, patient_id, status, original_filename, mime_type, bytes, taken_at, note, created_at, ready_at, integrity_status, storage_bucket, thumbnail_path, uploaded_by, source, appointment_id'
			)
			.eq('business_id', context.businessId)
			.eq('patient_id', event.params.id)
			.eq('storage_provider', 'supabase_storage')
			.in('status', ['ready', 'uploading', 'failed'])
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(PAGE_SIZE + 1);

		if (cursor) {
			query = query.or(
				`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
			);
		}

		const { data, error } = await query;
		if (error) throw error;

		const rows = data ?? [];
		const hasMore = rows.length > PAGE_SIZE;
		const visibleRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
		const thumbnailPaths = visibleRows
			.filter(
				(row) =>
					row.status === 'ready' &&
					row.integrity_status === 'ok' &&
					row.thumbnail_path
			)
			.map((row) => String(row.thumbnail_path));
		const thumbnailUrls = new Map<string, string>();

		if (thumbnailPaths.length > 0) {
			const signed = await context.admin.storage
				.from(CLINICAL_FILES_BUCKET)
				.createSignedUrls(thumbnailPaths, CLINICAL_FILE_THUMBNAIL_URL_TTL_SECONDS);
			if (!signed.error && signed.data) {
				for (const item of signed.data) {
					if (item.path && item.signedUrl) thumbnailUrls.set(item.path, item.signedUrl);
				}
			}
		}

		const items = visibleRows.map((row) => ({
			id: row.id,
			patient_id: row.patient_id,
			status: row.status,
			original_filename: row.original_filename,
			mime_type: row.mime_type,
			bytes: row.bytes,
			taken_at: row.taken_at,
			note: row.note,
			created_at: row.created_at,
			ready_at: row.ready_at,
			integrity_status: row.integrity_status,
			thumbnail_url: row.thumbnail_path ? (thumbnailUrls.get(row.thumbnail_path) ?? null) : null,
			source: row.source, appointment_id: row.appointment_id, is_mine: row.uploaded_by === context.userId
		}));
		const last = visibleRows.at(-1);

		return json({
			items,
			has_more: hasMore,
			next_cursor:
				hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null
		});
	} catch (error) {
		logServerFailure('Error cargando imágenes clínicas', error);
		const safe = clinicalFileError(error, 'No pudimos cargar las imágenes. Probá de nuevo.');
		return json(clinicalFileErrorBody(safe), { status: safe.status });
	}
};
