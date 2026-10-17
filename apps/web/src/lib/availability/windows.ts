import { InvalidDataContractError } from '$lib/contracts/json';

export const AVAILABILITY_WINDOW_DAYS = 15;
export const AVAILABILITY_GROUP_SIZE = 16;

export function isAvailabilityDate(value: string): boolean {
	if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function shiftAvailabilityDate(value: string, days: number): string {
	if (!isAvailabilityDate(value) || !Number.isSafeInteger(days)) throw new InvalidDataContractError('availability.date');
	const parsed = new Date(`${value}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	if (!Number.isFinite(parsed.getTime())) throw new InvalidDataContractError('availability.date');
	const shifted = parsed.toISOString().slice(0, 10);
	if (!isAvailabilityDate(shifted)) throw new InvalidDataContractError('availability.date');
	return shifted;
}

// Fixed natural-date windows. The iterator itself never initiates another
// request or eagerly scans the booking horizon, and never splits by JSON size.
export function* availabilityDateWindows(fromDate: string, toDate: string) {
	if (!isAvailabilityDate(fromDate) || !isAvailabilityDate(toDate) || fromDate > toDate)
		throw new InvalidDataContractError('availability.range');
	let start = fromDate;
	while (start <= toDate) {
		const remaining = (Date.parse(toDate) - Date.parse(start)) / 86_400_000;
		const end = remaining < AVAILABILITY_WINDOW_DAYS ? toDate : shiftAvailabilityDate(start, AVAILABILITY_WINDOW_DAYS - 1);
		yield { fromDate: start, toDate: end };
		if (end === toDate) return;
		start = shiftAvailabilityDate(end, 1);
	}
}

export function* availabilityProfessionalGroups(professionalIds: readonly string[]) {
	const unique = [...new Set(professionalIds.map(id => id.toLowerCase()))];
	if (unique.some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)))
		throw new InvalidDataContractError('availability.professionalIds');
	for (let start = 0; start < unique.length; start += AVAILABILITY_GROUP_SIZE)
		yield unique.slice(start, start + AVAILABILITY_GROUP_SIZE);
}
