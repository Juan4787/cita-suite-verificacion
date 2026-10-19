import type { BusinessRole } from '$lib/access/contracts';
export const roleLabels: Record<BusinessRole, string> = {
	owner: 'Dueño',
	admin: 'Administrador',
	reception: 'Recepción',
	professional: 'Profesional',
	readonly: 'Solo lectura'
};
export type TeamServiceOption = {
	id: string;
	name: string;
	duration_minutes: number;
	price_label: string | null;
	is_default: boolean;
};
export type TeamActionFeedback = {
	success?: boolean;
	message?: string;
	openRole?: BusinessRole;
	values?: Record<string, FormDataEntryValue>;
};
