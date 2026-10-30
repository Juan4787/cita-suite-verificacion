// Lista de señas (campaña de señas y avisos, plan 4.8): qué pedir hoy, qué vence, qué decidir a
// mano y qué turnos se cancelaron por falta de seña. La base decide estados y permisos; esta
// página sólo agrupa y prepara los mensajes, que una persona envía con un toque.
import { env } from '$env/dynamic/private';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import { isUuid } from '@cita-suite/shared/uuid';
import { createSupabaseServerClient } from '$lib/server/platform/supabase';
import { resolveActiveBusiness } from '$lib/server/access/public/business';
import { logServerFailure } from '$lib/server/platform/logging';
import { getPublicSiteUrl } from '$lib/server/integrations/public/messaging';
import { loadRebookUrl } from '$lib/server/scheduling/public/public-appointments';
import {
	DEPOSIT_ACTIONS,
	DepositError,
	getDepositErrorMessage,
	getDepositErrorStatus,
	loadDepositAutomationStatus,
	loadDepositList,
	loadDepositPolicy,
	setAppointmentDeposit,
	type DepositAction,
	type DepositListItem
} from '$lib/server/scheduling/public/deposits';
import {
	DEPOSIT_SECTIONS,
	buildDepositCancellationMessage,
	describeDepositAutomation,
	formatDepositAmount,
	type DepositAutomationNotice,
	type DepositListSection
} from '$lib/scheduling/deposits';
import { zonedDate } from '$lib/availability/calculate';
import { formatInTimeZone } from '$lib/utils/format';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import { buildWaMeUrl, buildWhatsAppWebUrl } from '$lib/utils/whatsapp';
import type { Actions, PageServerLoad } from './$types';

type DepositRow = {
	appointmentId: string;
	patientId: string;
	patientName: string;
	turnLabel: string;
	amountLabel: string;
	dueLabel: string;
	section: DepositListSection;
	revision: number;
	appointmentStatus: string;
	hasPhone: boolean;
	reminder: { openedAt: string; openedBy: string } | null;
	// Only for turns cancelled by the deposit: the agenda to give the slot again and, with a valid
	// phone, the notice to the person.
	cancellation: { rebookHref: string; notice: { whatsappUrl: string; whatsappWebUrl: string } | null } | null;
};

type SectionView = { id: DepositListSection; title: string; folded: boolean; rows: DepositRow[] };

const emptySections = (): SectionView[] => DEPOSIT_SECTIONS.map((section) => ({ ...section, rows: [] }));

const groupRows = (rows: DepositRow[]): SectionView[] =>
	DEPOSIT_SECTIONS.map((section) => ({ ...section, rows: rows.filter((row) => row.section === section.id) }));

const demoRows = (now: Date, timezone: string): DepositRow[] => {
	const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
	const turn = (hours: number) => formatInTimeZone(at(hours), timezone).full;
	const row = (overrides: Partial<DepositRow> & Pick<DepositRow, 'appointmentId' | 'patientName' | 'section'>): DepositRow => ({
		patientId: `${overrides.appointmentId}-paciente`,
		turnLabel: turn(120),
		amountLabel: formatDepositAmount(40000),
		dueLabel: turn(72),
		revision: 1,
		appointmentStatus: 'reserved',
		hasPhone: true,
		reminder: null,
		cancellation: null,
		...overrides
	});
	return [
		row({ appointmentId: 'demo-sena-1', patientName: 'Juan Pérez', section: 'to_request' }),
		row({
			appointmentId: 'demo-sena-2',
			patientName: 'María Gómez',
			section: 'due_soon',
			turnLabel: turn(60),
			dueLabel: turn(12),
			reminder: { openedAt: at(-3), openedBy: 'recepcion@consultorio-demo.test' }
		}),
		row({ appointmentId: 'demo-sena-3', patientName: 'Laura Díaz', section: 'manual', hasPhone: false }),
		row({
			appointmentId: 'demo-sena-4',
			patientName: 'Pedro Ruiz',
			section: 'cancelled',
			appointmentStatus: 'cancelled',
			turnLabel: turn(40),
			dueLabel: turn(-8),
			cancellation: {
				rebookHref: '/odonto/agenda',
				notice: {
					whatsappUrl: 'https://wa.me/5493510000004?text=Demo',
					whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5493510000004&text=Demo'
				}
			}
		})
	];
};

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const now = new Date();
	const rawPage = url.searchParams.get('pagina') ?? '1';
	const requestedPage = /^\d{1,7}$/.test(rawPage) ? Number(rawPage) : 1;
	const page = requestedPage >= 1 && requestedPage <= 1_000_000 ? requestedPage : 1;

	if (env.DEMO_MODE === 'true') {
		const timezone = 'America/Argentina/Cordoba';
		return {
			demo: true,
			restricted: false,
			canConfigure: true,
			policyEnabled: true,
			sections: groupRows(demoRows(now, timezone)),
			truncated: false,
			page: 1,
			automation: { tone: 'ok', text: 'Última revisión automática: hace 3 min.' } as DepositAutomationNotice
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies,
		membershipCache: locals.membershipCache ?? 'fresh'
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role === 'readonly') throw redirect(303, '/odonto/agenda');

	// A practice that cannot operate records nothing; the page says so instead of listing.
	if (!context.access.canUseBusiness) {
		return {
			demo: false,
			restricted: true,
			canConfigure: false,
			policyEnabled: false,
			sections: emptySections(),
			truncated: false,
			page: 1,
			automation: null
		};
	}

	const business = context.business;
	let policy;
	let list;
	try {
		[policy, list] = await Promise.all([
			loadDepositPolicy(supabase, business.id),
			loadDepositList(supabase, business.id, now, page)
		]);
	} catch (loadError) {
		// Never an empty list in place of one that could not be read.
		logServerFailure('Error cargando la lista de señas', loadError);
		throw kitError(503, 'No pudimos cargar las señas. Volvé a intentar en unos segundos.');
	}

	const loadTeam = async () => {
		try {
			const { data, error } = await supabase.rpc('list_business_users', { target_business_id: business.id });
			if (error) throw error;
			return data ?? [];
		} catch (usersError) {
			// Without the team the row says «alguien del equipo»: the opening itself is still shown.
			logServerFailure('Error cargando el equipo para las señas', usersError);
			return [];
		}
	};
	const [automationStatus, users] = await Promise.all([
		loadDepositAutomationStatus(supabase).catch((statusError) => {
			logServerFailure('Error cargando la revisión automática de señas', statusError);
			return null;
		}),
		loadTeam()
	]);
	const userLabels = new Map(users.map((user) => [String(user.user_id), String(user.email ?? '')]));
	const siteUrl = getPublicSiteUrl();

	const toRow = async (item: DepositListItem): Promise<DepositRow> => {
		const phone = normalizeArgentineWhatsAppPhone(item.patient.phoneE164);
		let cancellation: DepositRow['cancellation'] = null;
		if (item.section === 'cancelled') {
			let bookingPath: string | null = null;
			try {
				bookingPath = await loadRebookUrl(supabase, {
					id: item.appointment.id,
					business: { id: business.id, slug: business.slug }
				});
			} catch (rebookError) {
				// The notice still goes out, without the link to book again.
				logServerFailure('Error resolviendo dónde volver a reservar', rebookError);
			}
			const message = buildDepositCancellationMessage({
				patientName: item.patient.name,
				businessName: business.name,
				startsAt: item.appointment.startsAt,
				dueAt: item.deposit.due_at,
				timezone: business.timezone,
				bookingUrl: bookingPath ? `${siteUrl}${bookingPath}` : null
			});
			const query = new URLSearchParams({
				date: zonedDate(new Date(item.appointment.startsAt), business.timezone),
				professional_id: item.appointment.professionalId,
				service_id: item.appointment.serviceId,
				patient_id: item.patient.id,
				hora: formatInTimeZone(item.appointment.startsAt, business.timezone).timeLabel
			});
			cancellation = {
				rebookHref: `/odonto/agenda?${query}`,
				notice: phone ? { whatsappUrl: buildWaMeUrl(phone, message), whatsappWebUrl: buildWhatsAppWebUrl(phone, message) } : null
			};
		}
		const openedAt = item.deposit.reminder_opened_at;
		return {
			appointmentId: item.appointment.id,
			patientId: item.patient.id,
			patientName: item.patient.name,
			turnLabel: formatInTimeZone(item.appointment.startsAt, business.timezone).full,
			amountLabel: formatDepositAmount(item.deposit.amount),
			dueLabel: formatInTimeZone(item.deposit.due_at, business.timezone).full,
			section: item.section,
			revision: item.deposit.revision,
			appointmentStatus: item.appointment.status,
			hasPhone: Boolean(phone),
			reminder: openedAt
				? { openedAt, openedBy: (item.reminderOpenedBy && userLabels.get(item.reminderOpenedBy)) || 'alguien del equipo' }
				: null,
			cancellation
		};
	};

	const rows = await Promise.all(list.items.map(toRow));
	return {
		demo: false,
		restricted: false,
		canConfigure: context.canManage,
		policyEnabled: policy.enabled,
		sections: groupRows(rows),
		truncated: list.truncated,
		page,
		automation: describeDepositAutomation({ practiceAutoCancel: policy.autoCancelEnabled, status: automationStatus, now })
	};
};

const SUCCESS_MESSAGES: Record<DepositAction, (appointmentStatus: string) => string> = {
	paid: () => 'Seña confirmada. El turno quedó Confirmado.',
	waived: () => 'Seña exceptuada. El turno quedó Confirmado.',
	pending: (appointmentStatus) =>
		appointmentStatus === 'reserved'
			? 'Se deshizo el registro de la seña. El turno volvió a Reservado.'
			: 'Se deshizo el registro de la seña. La seña volvió a pendiente.'
};

export const actions: Actions = {
	deposit: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });

		const form = await request.formData();
		const appointmentId = String(form.get('appointment_id') ?? '').trim();
		const action = String(form.get('deposit_action') ?? '').trim();
		// Digits only: Number('') is 0, and a missing revision must never pass as a stale one.
		const rawRevision = String(form.get('expected_revision') ?? '').trim();
		const expectedRevision = /^\d{1,15}$/.test(rawRevision) ? Number(rawRevision) : Number.NaN;
		// A malformed identifier never reaches PostgreSQL (it would answer 22P02).
		if (!isUuid(appointmentId)) return fail(404, { message: 'No encontramos ese turno.' });
		if (!(DEPOSIT_ACTIONS as readonly string[]).includes(action)) {
			return fail(400, { message: getDepositErrorMessage('DEPOSIT_ACTION_INVALID') });
		}
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
			return fail(400, { appointmentId, message: 'No pudimos leer la versión de la seña. Recargá la página antes de seguir.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');

		try {
			const change = await setAppointmentDeposit(supabase, {
				businessId: context.business.id,
				appointmentId,
				action: action as DepositAction,
				expectedRevision
			});
			return { success: true, appointmentId, message: SUCCESS_MESSAGES[action as DepositAction](change.appointmentStatus) };
		} catch (actionError) {
			// Only a deposit rule has its own message: any other failure is unexpected, never guessed.
			const code = actionError instanceof DepositError ? actionError.code : 'DEPOSIT_UNEXPECTED';
			if (code === 'DEPOSIT_UNEXPECTED') logServerFailure('Error registrando una seña', actionError);
			return fail(getDepositErrorStatus(code), { appointmentId, message: getDepositErrorMessage(code) });
		}
	}
};
