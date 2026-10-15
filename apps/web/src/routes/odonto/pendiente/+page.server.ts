import type { PageServerLoad } from './$types';

const reasons = ['manual_setup', 'rate_limited', 'temporarily_unavailable'] as const;
type PendingReason = (typeof reasons)[number];

export const load: PageServerLoad = ({ url }) => {
	const requested = url.searchParams.get('reason');
	const reason: PendingReason = reasons.includes(requested as PendingReason)
		? (requested as PendingReason)
		: 'manual_setup';
	return { reason };
};
