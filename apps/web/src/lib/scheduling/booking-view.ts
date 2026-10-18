import type {
	BookingIntakeField,
	BookingModality,
	BookingPresentation
} from '@cita-suite/shared/booking-integration';
import type { AvailabilitySlot } from '$lib/availability/calculate';
import type { PriceQuote } from '$lib/booking/pricing';

export type BookingService = {
	id: string;
	name: string;
	description: string | null;
	duration_minutes: number;
	price_label: string | null;
};
export type BookingProfessional = {
	id: string;
	name: string;
	specialty: string | null;
	avatar_url?: string | null;
	next_available_at?: string | null;
};
export type BookingSlot = AvailabilitySlot;
export type BookingDay = { date: string; label: string; count: number };
export type BookingDateWindow = {
	fromDate: string;
	toDate: string;
	previousFromDate: string | null;
	nextFromDate: string | null;
	horizonEnd: string;
};
export type BookingSelection = {
	serviceId: string;
	bookingMode: 'individual' | 'joint';
	professionalId: string;
	professionalIds: string[];
	date: string;
	datesFrom?: string;
	slot: string;
};
export type BookingQuery = Partial<
	Record<
		| 'service_id'
		| 'booking_mode'
		| 'professional_id'
		| 'professional_ids'
		| 'date'
		| 'slot'
		| 'dates_from',
		string
	>
>;
export type BookingFormState = {
	message?: string;
	values?: Record<string, unknown>;
	uncertain?: boolean;
};

/** Presentation projection, shared without importing a server implementation. */
export type BookingViewData = {
	priceQuote?: PriceQuote | null;
	state: {
		business: {
			name: string;
			timezone?: string;
			logo_url?: string | null;
			address?: string | null;
			phone?: string | null;
			cancellation_policy?: string | null;
		} | null;
		services: BookingService[];
		professionals: BookingProfessional[];
		slots: BookingSlot[];
		days: BookingDay[];
		dateWindow?: BookingDateWindow;
		issue: string | null;
	};
	selected: Omit<BookingSelection, 'slot'>;
	mapsLink: string | null;
	turnstileSiteKey: string | null;
	bookingRequestId: string;
	recoveryCheckId?: string;
	patientFields?: { fields: BookingIntakeField[]; hash: string } | null;
	integration?: { publicKey: string; revision: number } | null;
	presentation?: (BookingPresentation & { compact?: boolean }) | null;
	embed?: { parentOrigin: string; instanceId: string } | null;
	demo: boolean;
};
export type BookingConfirmation = {
	service: BookingService;
	slot: BookingSlot;
	selection: BookingSelection;
	professionalLabel: string;
	professionalId: string;
	priceQuote: PriceQuote | null;
	timezone: string;
	modality: BookingModality;
	action: string;
};
