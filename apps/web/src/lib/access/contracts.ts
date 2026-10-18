import type { BusinessAccessState } from './commercial-access';

export const BUSINESS_ROLES = ['owner', 'admin', 'reception', 'professional', 'readonly'] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const BUSINESS_INDUSTRIES = [
	'odontology',
	'aesthetics',
	'kinesiology',
	'nutrition',
	'therapy',
	'other'
] as const;
export type BusinessIndustry = (typeof BUSINESS_INDUSTRIES)[number];

export type Business = {
	id: string;
	name: string;
	slug: string;
	industry: BusinessIndustry;
	phone: string | null;
	email: string | null;
	address: string | null;
	address_instructions: string | null;
	maps_url: string | null;
	logo_url: string | null;
	timezone: string;
	public_booking_enabled: boolean;
	whatsapp_enabled: boolean;
	allow_same_day_booking: boolean;
	min_booking_notice_minutes: number;
	max_booking_days_ahead: number;
	cancellation_policy: string | null;
	is_active: boolean;
	created_at?: string | null;
	updated_at?: string | null;
};

export type BusinessContext = {
	business: Business;
	role: BusinessRole;
	canManage: boolean;
	canOperate: boolean;
	access: BusinessAccessState;
	assistance?: BusinessAssistanceContext | null;
};

export type BusinessAssistanceContext = {
	grantId: string;
	requestedByUserId: string;
	supportUserId: string;
	startsAt: string;
	expiresAt: string;
};

