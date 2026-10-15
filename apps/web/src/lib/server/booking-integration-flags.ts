import { env } from '$env/dynamic/private';

// Keep historical context readable after stopping new integration bookings.
// Set the schema flag only after applying the additive migrations, and retain
// it during operational rollback; it does not enable any public write route.
export const bookingContextsAvailable = () => env.BOOKING_CONTEXTS_AVAILABLE === 'true' || env.BOOKING_INTEGRATIONS_ENABLED === 'true';
