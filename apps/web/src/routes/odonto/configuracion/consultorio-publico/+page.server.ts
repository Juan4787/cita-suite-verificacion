import {redirect} from '@sveltejs/kit';
import {legacyPublicPracticeActions} from '$lib/server/sites/public/public-practice-settings';
import type {PageServerLoad,Actions} from './$types';
export const load:PageServerLoad=()=>redirect(303,'/odonto/configuracion/documentos');
export const actions:Actions=legacyPublicPracticeActions;
