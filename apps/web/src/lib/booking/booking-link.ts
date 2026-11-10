import { isUuid } from '@cita-suite/shared/uuid';

/**
 * The booking address a text gives: «Consultorio Ramírez» → consultorio-ramirez. The database
 * derives a practice's address from its name with the same rule (private.business_slug_from_text,
 * migration 20261110010000), so what the settings page shows while the name is typed is what the
 * practice gets. booking-link.test.ts and supabase/tests/business_booking_links.sql share vectors.
 */
export const normalizeSlug = (value: string) =>
	value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/, '');

/**
 * What names a practice in its booking link: its address. An address shaped like an id is read as
 * one, so a practice that has one (a fixture's, which is its own id) is named by its id.
 */
export const publicBookingReference = (business: { id: string; slug: string }) =>
	isUuid(business.slug) ? business.id : business.slug;

/** The path patients open: /reservar/consultorio-ramirez. */
export const publicBookingPath = (business: { id: string; slug: string }) =>
	`/reservar/${encodeURIComponent(publicBookingReference(business))}`;
