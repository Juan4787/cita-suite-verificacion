// Which assistance notice the shell shows, if any (plan 12.17, point 6): the master inside the
// account it helps, the active assistance, for 24 hours how it ended, or the offer, which, as in
// V10b, also returns once an assistance ended.

export type AssistanceNoticeMode = 'assisting' | 'active' | 'ended' | 'offer';

export const assistanceNoticeMode = ({
	pathname,
	isMaster,
	isAssisting,
	hidden,
	assistance
}: {
	pathname: string;
	isMaster: boolean;
	isAssisting: boolean;
	/** Restricted commercial access or a practice pending manual setup. */
	hidden: boolean;
	assistance: { status: string; showBanner: boolean; canActivate: boolean } | null | undefined;
}): AssistanceNoticeMode | null => {
	if (pathname.startsWith('/odonto/maestro') || (isMaster && !isAssisting) || hidden || !assistance) return null;
	// The Ayuda page shows the same state, with every action.
	if (pathname.startsWith('/odonto/configuracion/ayuda')) return null;
	if (isAssisting) return assistance.status === 'active' ? 'assisting' : null;
	if (assistance.status === 'active') return assistance.showBanner ? 'active' : null;
	if (assistance.status !== 'available' && assistance.showBanner) return 'ended';
	const configuring = ['/odonto/configuracion', '/odonto/profesionales', '/odonto/mis-preguntas'].some((path) => pathname.startsWith(path));
	return !configuring && assistance.canActivate ? 'offer' : null;
};
