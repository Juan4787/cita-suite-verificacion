import { resolve, sep } from 'node:path';

/** The browser profile's evidence stays under its owned verification directory. */
export function nativeBookingEvidencePath(root, { staging = false, directory } = {}) {
	const base = resolve(root, '.verification');
	const output = directory ? resolve(root, directory) : resolve(base, staging ? 'native-booking-staging' : 'native-booking');
	if (!output.startsWith(base + sep)) throw new Error('Native booking evidence requires an owned verification directory.');
	return output;
}
