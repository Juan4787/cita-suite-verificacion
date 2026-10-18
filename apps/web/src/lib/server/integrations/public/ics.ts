// Generador de archivos iCalendar (RFC 5545) para eventos de turno.
// Decisiones de compatibilidad:
// - Fechas en UTC (sufijo Z), sin bloque VTIMEZONE: todos los clientes convierten
//   a hora local y se evita la parte más frágil del formato.
// - Folding a 75 octetos medidos en bytes UTF-8 (las tildes ocupan 2 bytes; cortar
//   mal parte el carácter y rompe el archivo en algunos parsers).
// - CRLF obligatorio entre líneas.
// - VALARM es una sugerencia: Apple Calendar lo respeta, Google Calendar lo ignora
//   al importar (usa los defaults del usuario).

export type IcsAlarm = {
	trigger: string; // ej. '-PT24H'
	description: string;
};

export type IcsEventInput = {
	uid: string;
	startsAt: Date;
	endsAt: Date;
	summary: string;
	description: string; // texto plano con \n reales; se escapa acá
	location: string | null;
	url: string;
	sequence: number;
	status: 'CONFIRMED' | 'CANCELLED';
	method: 'PUBLISH' | 'CANCEL';
	alarms: IcsAlarm[];
	now?: Date;
};

export const escapeIcsText = (value: string): string =>
	value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');

const encoder = new TextEncoder();

export const foldIcsLine = (line: string): string[] => {
	const folded: string[] = [];
	let current = '';
	let currentBytes = 0;
	for (const char of line) {
		const charBytes = encoder.encode(char).length;
		if (currentBytes + charBytes > 75) {
			folded.push(current);
			current = ' ';
			currentBytes = 1;
		}
		current += char;
		currentBytes += charBytes;
	}
	folded.push(current);
	return folded;
};

const pad = (value: number) => String(value).padStart(2, '0');

export const formatIcsDateUtc = (date: Date): string =>
	`${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T` +
	`${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Alarmas según cuánto falta para el turno: si la de 24h ya no sirve no se emite,
// y para turnos muy próximos el recordatorio útil es la pantalla, no el calendario.
export const alarmsForProximity = (startsAt: Date, now: Date): IcsAlarm[] => {
	const description = 'Recordatorio de turno';
	const remaining = startsAt.getTime() - now.getTime();
	if (remaining > 24 * HOUR_MS) {
		return [
			{ trigger: '-PT24H', description },
			{ trigger: '-PT2H', description }
		];
	}
	if (remaining > 2 * HOUR_MS) return [{ trigger: '-PT2H', description }];
	if (remaining > 30 * MINUTE_MS) return [{ trigger: '-PT30M', description }];
	return [];
};

export const buildIcs = (input: IcsEventInput): string => {
	const now = input.now ?? new Date();
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Turnos//Agenda//ES',
		'CALSCALE:GREGORIAN',
		`METHOD:${input.method}`,
		'BEGIN:VEVENT',
		`UID:${input.uid}`,
		`DTSTAMP:${formatIcsDateUtc(now)}`,
		`DTSTART:${formatIcsDateUtc(input.startsAt)}`,
		`DTEND:${formatIcsDateUtc(input.endsAt)}`,
		`SUMMARY:${escapeIcsText(input.summary)}`
	];
	if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
	lines.push(
		`DESCRIPTION:${escapeIcsText(input.description)}`,
		`URL:${input.url}`,
		`STATUS:${input.status}`,
		`SEQUENCE:${input.sequence}`,
		'TRANSP:OPAQUE'
	);
	for (const alarm of input.alarms) {
		lines.push(
			'BEGIN:VALARM',
			`TRIGGER:${alarm.trigger}`,
			'ACTION:DISPLAY',
			`DESCRIPTION:${escapeIcsText(alarm.description)}`,
			'END:VALARM'
		);
	}
	lines.push('END:VEVENT', 'END:VCALENDAR');

	return lines.flatMap(foldIcsLine).join('\r\n') + '\r\n';
};
