import { InvalidDataContractError, readNullableText, readRecord, readText } from '$lib/contracts/json';

export function parsePatientBookingProfile(value: unknown): {
	fields: { label: string; value: string | boolean }[];
	reportedAtMs: number | null;
} {
	// Older custom_fields can contain unrelated JSON. Preserve it in the patient
	// record; only the explicit booking metadata namespace belongs to this parser.
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return { fields: [], reportedAtMs: null };
	const metadata = readRecord(value, 'patientBookingMetadata');
	const fields = metadata.booking_fields == null ? [] : Object.values(readRecord(metadata.booking_fields, 'patientBookingMetadata.fields')).map(value => {
		const row = readRecord(value, 'patientBookingMetadata.field');
		const label = readText(row.label, 'patientBookingMetadata.label');
		if (typeof row.value !== 'string' && typeof row.value !== 'boolean') throw new InvalidDataContractError('patientBookingMetadata.value');
		return { label, value: row.value };
	});
	const reportedAt = readNullableText(metadata.booking_last_reported_at, 'patientBookingMetadata.reportedAt');
	const reportedAtMs = reportedAt === null ? null : Date.parse(reportedAt);
	if (reportedAtMs !== null && !Number.isFinite(reportedAtMs)) throw new InvalidDataContractError('patientBookingMetadata.reportedAt');
	return { fields, reportedAtMs };
}
