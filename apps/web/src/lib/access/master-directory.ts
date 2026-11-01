/**
 * The master panel's practice directory: which practices each view lists and how their access reads.
 * An archived practice has its own view (plan de señas y avisos, 12.16). Archiving from the panel also
 * switches the access off, so «archived» is checked before «paused»: otherwise it read as paused.
 */
export type DirectoryAccess = {
	commercialStatus: 'active' | 'grace' | 'restricted' | 'archived';
	visualStatus: 'permanent' | 'active' | 'expiring' | 'grace' | 'restricted' | 'archived';
	isPermanent: boolean;
	commercialAccessEnabled: boolean;
	paidUntil: string | null;
	graceUntil: string | null;
	restrictedUntil: string | null;
	archivedAt: string | null;
};

export type DirectoryBusiness = {
	name: string;
	slug: string;
	primaryOwnerEmail: string | null;
	members: { email: string | null }[];
	access: DirectoryAccess;
	mpSubscription: { status: string } | null;
};

export type DirectoryView = 'all' | 'active' | 'attention' | 'archived';
export type DirectoryTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Archived by the master or by time: nothing is operated there until it is reactivated. */
export const isArchived = (business: DirectoryBusiness) => business.access.commercialStatus === 'archived';

/** Applies to practices outside the archived view; archived ones are left out before asking. */
export const needsAttention = (business: DirectoryBusiness) =>
	!business.access.commercialAccessEnabled ||
	business.access.visualStatus === 'expiring' ||
	business.access.commercialStatus !== 'active' ||
	business.mpSubscription?.status === 'paused' ||
	business.mpSubscription?.status === 'pending';

export const directoryCounts = (businesses: DirectoryBusiness[]) => {
	const current = businesses.filter((business) => !isArchived(business));
	return {
		all: current.length,
		active: current.filter((business) => !needsAttention(business)).length,
		attention: current.filter(needsAttention).length,
		archived: businesses.length - current.length
	};
};

export function filterDirectory<T extends DirectoryBusiness>(businesses: T[], view: DirectoryView, search: string): T[] {
	const normalized = search.trim().toLowerCase();
	return businesses.filter((business) => {
		if (isArchived(business) !== (view === 'archived')) return false;
		if (view === 'active' && needsAttention(business)) return false;
		if (view === 'attention' && !needsAttention(business)) return false;
		if (!normalized) return true;
		return [business.name, business.slug, business.primaryOwnerEmail ?? '', ...business.members.map((member) => member.email ?? '')]
			.join(' ')
			.toLowerCase()
			.includes(normalized);
	});
}

export const statusLabel = (business: DirectoryBusiness) => {
	if (isArchived(business)) return 'Archivado';
	if (!business.access.commercialAccessEnabled) return 'Pausado';
	if (business.access.visualStatus === 'permanent') return 'Permanente';
	if (business.access.visualStatus === 'expiring') return 'Por vencer';
	if (business.access.commercialStatus === 'active') return 'Activo';
	if (business.access.commercialStatus === 'grace') return 'Vencido';
	return 'Restringido';
};

export const statusTone = (business: DirectoryBusiness): DirectoryTone => {
	if (isArchived(business)) return 'neutral';
	if (!business.access.commercialAccessEnabled) return 'danger';
	if (business.access.visualStatus === 'permanent') return 'success';
	if (business.access.visualStatus === 'expiring') return 'warning';
	if (business.access.commercialStatus === 'active') return 'success';
	if (business.access.commercialStatus === 'grace') return 'warning';
	return 'danger';
};

/** `remaining` is the formatted time left of active access, if any. */
export const accessSummary = (business: DirectoryBusiness, remaining: string | null) => {
	if (isArchived(business)) return 'Cuenta archivada';
	if (!business.access.commercialAccessEnabled) return 'Acceso pausado manualmente';
	if (business.access.isPermanent) return 'Sin vencimiento';
	if (business.access.commercialStatus === 'restricted') return 'Sin acceso operativo';
	if (business.access.commercialStatus === 'grace') return 'En período de gracia';
	return remaining ?? 'Activo';
};

/** `dateTime` formats an instant in the practice's time zone. */
export const accessDetail = (business: DirectoryBusiness, dateTime: (value: string) => string) => {
	const access = business.access;
	if (isArchived(business)) return access.archivedAt ? `Archivado el ${dateTime(access.archivedAt)}` : 'Requiere reactivación.';
	if (!access.commercialAccessEnabled) return 'Reanudalo desde las opciones avanzadas.';
	if (access.isPermanent) return 'No requiere renovaciones.';
	if (access.commercialStatus === 'restricted')
		return access.restrictedUntil ? `Se archiva el ${dateTime(access.restrictedUntil)}` : 'Requiere un nuevo período de acceso.';
	if (access.commercialStatus === 'grace')
		return access.graceUntil ? `Gracia hasta el ${dateTime(access.graceUntil)}` : 'Requiere regularización.';
	return access.paidUntil ? `Vence el ${dateTime(access.paidUntil)}` : 'Sin vencimiento registrado.';
};
