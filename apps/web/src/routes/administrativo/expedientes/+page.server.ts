import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// The inactive module retains the existing Auth/layout redirects and cannot
// construct a data client for a schema absent from the active migrations.
const inactive = () => { throw redirect(303, '/odonto/agenda'); };
export const load: PageServerLoad = inactive;
export const actions: Actions = { default: inactive };
