import {loadPricePolicyEditor,savePricePolicy} from '$lib/server/scheduling/public/price-policy-editor';
import type {PageServerLoad,Actions} from './$types';
export const load:PageServerLoad=loadPricePolicyEditor;
export const actions:Actions={save_price_policy:savePricePolicy};
