// The deposit policy form as people fill it (Configuración, Señas): every field is read
// explicitly, so an unchecked box is «no» and never a missing key the database would refuse.
// The database validates everything again; these checks only say which field is wrong.
import { isUuid } from '@cita-suite/shared/uuid';
import type { DepositPolicy } from '$lib/server/scheduling/public/deposits';

// Field-level reasons before asking the database, which validates everything again anyway.
type FieldErrors = Partial<Record<'fixed_amount' | 'percentage' | 'request_days' | 'deadline_hours' | 'min_payment_hours' | 'transfer_details', string>>;

// Pesos as people write them: «40000» or «40.000». Never a decimal: the database refuses rounding.
const parseAmount = (raw: string) => {
	const value = raw.trim();
	if (!value) return null;
	if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(value)) return Number.NaN;
	return Number(value.replaceAll('.', ''));
};
// «35», «35,5» or «35.5»: at most two decimals.
const parsePercentage = (raw: string) => {
	const value = raw.trim();
	if (!value) return null;
	if (!/^\d{1,3}([.,]\d{1,2})?$/.test(value)) return Number.NaN;
	return Number(value.replace(',', '.'));
};
const parseWhole = (raw: string) => (/^\d{1,4}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN);

export const parsePolicyForm = (form: FormData, serviceIds: Set<string>) => {
	const errors: FieldErrors = {};
	const amountMode = form.get('amount_mode') === 'percentage' ? 'percentage' : 'fixed';
	const fixedAmount = parseAmount(String(form.get('fixed_amount') ?? ''));
	const percentage = parsePercentage(String(form.get('percentage') ?? ''));
	const requestDays = parseWhole(String(form.get('request_days') ?? ''));
	const deadlineHours = parseWhole(String(form.get('deadline_hours') ?? ''));
	const minPaymentHours = parseWhole(String(form.get('min_payment_hours') ?? ''));
	const transferDetails = String(form.get('transfer_details') ?? '').trim();
	// Checkboxes carry value="true", as the other settings pages: an unchecked one is absent, so «no».
	const enabled = form.get('enabled') === 'true';

	if (fixedAmount !== null && !(Number.isSafeInteger(fixedAmount) && fixedAmount >= 1 && fixedAmount <= 1_000_000_000_000)) {
		errors.fixed_amount = 'Escribí el monto en pesos, sin centavos. Por ejemplo, 40.000.';
	}
	if (percentage !== null && !(percentage > 0 && percentage <= 100)) {
		errors.percentage = 'Escribí un porcentaje mayor que 0 y hasta 100, con hasta dos decimales.';
	}
	if (enabled && amountMode === 'fixed' && fixedAmount === null) errors.fixed_amount = 'Con la seña activa, falta el monto.';
	if (enabled && amountMode === 'percentage' && percentage === null) errors.percentage = 'Con la seña activa, falta el porcentaje.';
	if (!(requestDays >= 1 && requestDays <= 60)) errors.request_days = 'Entre 1 y 60 días.';
	if (!(deadlineHours >= 1 && deadlineHours <= 720)) errors.deadline_hours = 'Entre 1 y 720 horas.';
	if (!(minPaymentHours >= 0 && minPaymentHours <= 168)) errors.min_payment_hours = 'Entre 0 y 168 horas.';
	if (transferDetails.length > 500) errors.transfer_details = 'Hasta 500 caracteres.';

	// Only services of this practice; an unknown identifier is dropped, never sent.
	const excludedServiceIds = [...new Set(form.getAll('excluded_service_ids').map(String))].filter(
		(id) => isUuid(id) && serviceIds.has(id)
	);
	const policy: Omit<DepositPolicy, 'revision'> = {
		enabled,
		autoCancelEnabled: form.get('auto_cancel_enabled') === 'true',
		amountMode,
		fixedAmount: Number.isNaN(fixedAmount) ? null : fixedAmount,
		percentage: Number.isNaN(percentage) ? null : percentage,
		requestDays,
		deadlineHours,
		minPaymentHours,
		transferDetails: transferDetails || null,
		appliesToManual: form.get('applies_to_manual') === 'true',
		excludedServiceIds
	};
	// What the person wrote, to show it again when the save is refused instead of losing it.
	const values = {
		enabled: policy.enabled,
		autoCancelEnabled: policy.autoCancelEnabled,
		amountMode,
		fixedAmount: String(form.get('fixed_amount') ?? ''),
		percentage: String(form.get('percentage') ?? ''),
		requestDays: String(form.get('request_days') ?? ''),
		deadlineHours: String(form.get('deadline_hours') ?? ''),
		minPaymentHours: String(form.get('min_payment_hours') ?? ''),
		transferDetails,
		appliesToManual: policy.appliesToManual,
		excludedServiceIds
	};
	return { policy, errors, values };
};

