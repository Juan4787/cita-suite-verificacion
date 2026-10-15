import { env } from '$env/dynamic/private';
import { readDemoDb } from '$lib/server/demo-store';
import { resolveActiveBusiness } from '$lib/server/business';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const PAGE_SIZE = 30;

export const GET: RequestHandler = async ({ params, url, locals, fetch, cookies }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	const cursorCreatedAt = url.searchParams.get('cursor_created_at')?.trim() ?? '';
	const cursorId = url.searchParams.get('cursor_id')?.trim() ?? '';

	if (env.DEMO_MODE === 'true') {
		const rows = readDemoDb()
			.clinicalEntries.filter((entry) => entry.patient_id === params.id)
			.sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));

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
			next_cursor_created_at: hasMore ? last?.created_at ?? null : null,
			next_cursor_id: hasMore ? last?.id ?? null : null
		});
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies,
		membershipCache: 'fresh'
	});
	if (!context) {
		return json({ message: 'No se pudo resolver el negocio activo.' }, { status: 500 });
	}
	let query = supabase
		.from('clinical_entries')
		.select('id, created_at, entry_type, description, teeth, internal_note, created_by_user_id, locked_after')
		.eq('patient_id', params.id)
		.eq('business_id', context.business.id)
		.is('archived_at', null)
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(PAGE_SIZE + 1);

	if (cursorCreatedAt && cursorId) {
		query = query.or(
			`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`
		);
	} else if (cursorCreatedAt) {
		query = query.lt('created_at', cursorCreatedAt);
	}

	const { data, error } = await query;
	if (error) {
		console.error('Error cargando historial paginado', error);
		return json({ message: 'No se pudo cargar el historial.' }, { status: 500 });
	}

	const rows = data ?? [];
	const hasMore = rows.length > PAGE_SIZE;
	const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
	const last = items.at(-1);
	let itemsWithCosts = items.map((item) => ({ ...item, amount: null as number | null }));

	const canViewCosts =
		(context.role === 'owner' || context.role === 'admin') &&
		context.access.allowedCapabilities.canViewExistingCosts;

	if (canViewCosts && items.length > 0) {
		const { data: costs, error: costsError } = await supabase
			.from('clinical_entry_costs')
			.select('clinical_entry_id, amount')
			.eq('business_id', context.business.id)
			.in(
				'clinical_entry_id',
				items.map((item) => item.id)
			);

		if (costsError) {
			console.error('Error cargando costos del historial', costsError);
		} else {
			const costByEntryId = new Map(
				(costs ?? []).map((item) => [String(item.clinical_entry_id), item.amount])
			);
			itemsWithCosts = items.map((item) => ({
				...item,
				amount: costByEntryId.get(String(item.id)) ?? null
			}));
		}
	}

	return json({
		items: itemsWithCosts,
		has_more: hasMore,
		next_cursor_created_at: hasMore ? last?.created_at ?? null : null,
		next_cursor_id: hasMore ? last?.id ?? null : null
	});
};
