import { env } from '$env/dynamic/private';
import { readDemoDb } from '$lib/server/platform/demo-store';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import {
	parsePatientHistoryCursor,
	readPatientHistory,
	PATIENT_HISTORY_PAGE_SIZE as PAGE_SIZE
} from '$lib/server/patients/public/patient-history';
import { PatientOperationError } from '$lib/server/patients/public/patient-operation-error';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals, fetch, cookies }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	const cursorCreatedAt = url.searchParams.get('cursor_created_at')?.trim() ?? '';
	const cursorId = url.searchParams.get('cursor_id')?.trim() ?? '';
	try {
		parsePatientHistoryCursor(cursorCreatedAt, cursorId, env.DEMO_MODE === 'true');
	} catch (cause) {
		if (cause instanceof PatientOperationError)
			return json({ message: cause.message }, { status: 400 });
		throw cause;
	}

	if (env.DEMO_MODE === 'true') {
		const rows = readDemoDb()
			.clinicalEntries.filter((entry) => entry.patient_id === params.id)
			.sort((a, b) =>
				a.created_at === b.created_at
					? a.id < b.id
						? 1
						: -1
					: a.created_at < b.created_at
						? 1
						: -1
			);

		const filtered = cursorCreatedAt
			? rows.filter((entry) => {
					if (entry.created_at < cursorCreatedAt) return true;
					if (entry.created_at > cursorCreatedAt) return false;
					return cursorId ? entry.id < cursorId : false;
				})
			: rows;
		const slice = filtered.slice(0, PAGE_SIZE + 1);
		const hasMore = slice.length > PAGE_SIZE;
		const items = hasMore ? slice.slice(0, PAGE_SIZE) : slice;
		const last = items.at(-1);
		return json({
			items,
			has_more: hasMore,
			next_cursor_created_at: hasMore ? (last?.created_at ?? null) : null,
			next_cursor_id: hasMore ? (last?.id ?? null) : null
		});
	}

	const { supabase, business: context } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	try {
		return json(
			await readPatientHistory({
				supabase,
				context,
				patientId: params.id,
				cursor: parsePatientHistoryCursor(cursorCreatedAt, cursorId)
			})
		);
	} catch (cause) {
		if (cause instanceof PatientOperationError)
			return json(
				{ message: cause.message },
				{
					status: cause.kind === 'forbidden' ? 403 : cause.kind === 'invalid' ? 400 : 500
				}
			);
		throw cause;
	}
};
