import { env } from '$env/dynamic/private';
import crypto from 'node:crypto';

const VERSION = 1;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export type PatientListCursor = {
	v: typeof VERSION;
	snapshotAt: string;
	rank: number;
	activityAt: string;
	id: string;
};

type PatientListCursorScope = {
	businessId: string;
	showArchived: boolean;
	query: string;
};

const cursorSecret = () => {
	const secret =
		env.PATIENT_CURSOR_SECRET?.trim() ||
		env.RATE_LIMIT_SALT?.trim() ||
		env.ODONTO_SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!secret) throw new Error('PATIENT_CURSOR_SECRET_MISSING');
	return secret;
};

const sign = (encoded: string, scope: PatientListCursorScope) =>
	crypto
		.createHmac('sha256', cursorSecret())
		.update(encoded)
		.update('\n')
		.update(scope.businessId)
		.update('\n')
		.update(scope.showArchived ? 'archived' : 'active')
		.update('\n')
		.update(scope.query)
		.digest('base64url');

const safeEqual = (left: string, right: string) => {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const encodePatientListCursor = (
	value: Omit<PatientListCursor, 'v'> & PatientListCursorScope
) => {
	const { businessId, showArchived, query, ...cursor } = value;
	const scope = { businessId, showArchived, query };
	const encoded = Buffer.from(JSON.stringify({ v: VERSION, ...cursor })).toString('base64url');
	return `${encoded}.${sign(encoded, scope)}`;
};

export const decodePatientListCursor = (
	value: string,
	expected: { businessId: string; showArchived: boolean; query: string }
): PatientListCursor | null => {
	try {
		if (value.length > 1024) return null;
		const [encoded, signature, extra] = value.split('.');
		if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, expected))) return null;
		const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PatientListCursor;
		if (
			parsed.v !== VERSION ||
			!Number.isInteger(parsed.rank) ||
			parsed.rank < 0 ||
			!timestampPattern.test(parsed.snapshotAt) ||
			!timestampPattern.test(parsed.activityAt) ||
			Number.isNaN(Date.parse(parsed.snapshotAt)) ||
			Number.isNaN(Date.parse(parsed.activityAt)) ||
			!uuidPattern.test(parsed.id)
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
};
