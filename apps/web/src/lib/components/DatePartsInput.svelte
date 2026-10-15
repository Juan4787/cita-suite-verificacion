<script lang="ts">
	type InvalidField = 'year' | 'month' | 'day' | null;

	let {
		name = 'birth_date',
		/**
		 * When provided, should be a YYYY-MM-DD string or something Date can parse.
		 * When omitted, the component starts empty (optional field).
		 */
		initialValue = null,
		minYear = 1900,
		maxYear = 2045,
		showErrors = false
	} = $props<{
		name?: string;
		initialValue?: string | null;
		minYear?: number;
		maxYear?: number;
		showErrors?: boolean;
	}>();

	let year = $state('');
	let month = $state('');
	let day = $state('');

	let yearEl: HTMLInputElement | null = $state(null);
	let monthEl: HTMLInputElement | null = $state(null);
	let dayEl: HTMLInputElement | null = $state(null);
	let errorsVisible = $derived(showErrors);

	$effect(() => {
		if (!initialValue) return;
		// Prefer parsing YYYY-MM-DD without timezone shifting.
		if (/^\d{4}-\d{2}-\d{2}$/.test(initialValue)) {
			const [y, m, d] = initialValue.split('-');
			year = y ?? '';
			month = m ?? '';
			day = d ?? '';
			return;
		}

		const parsed = new Date(initialValue);
		if (Number.isNaN(parsed.valueOf())) return;
		year = String(parsed.getFullYear());
		month = String(parsed.getMonth() + 1).padStart(2, '0');
		day = String(parsed.getDate()).padStart(2, '0');
	});

	const digitsOnly = (value: string) => value.replace(/\D/g, '');
	const normalizeYear = (value: string) => digitsOnly(value).slice(0, 4);
	const normalizeMonthDay = (value: string) => digitsOnly(value).padStart(2, '0').slice(0, 2);

	const toInt = (raw: string) => {
		const n = Number(raw);
		return Number.isInteger(n) ? n : null;
	};

	const maxDayInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

	const validation = $derived.by((): { error: string | null; field: InvalidField } => {
		const yRaw = year.trim();
		const mRaw = month.trim();
		const dRaw = day.trim();

		const allBlank = !yRaw && !mRaw && !dRaw;
		if (allBlank) return { error: null, field: null };

		// If user started typing, require all 3 parts.
		if (!yRaw || !mRaw || !dRaw) {
			return { error: 'Completá Año, Mes y Día (o dejalo vacío).', field: !yRaw ? 'year' : !mRaw ? 'month' : 'day' };
		}

		const y = toInt(yRaw);
		if (y === null || yRaw.length !== 4) {
			return { error: 'El año debe tener 4 números (por ejemplo 2025).', field: 'year' };
		}
		if (y < minYear || y > maxYear) {
			return { error: `El año debe estar entre ${minYear} y ${maxYear}.`, field: 'year' };
		}

		const m = toInt(mRaw);
		if (m === null || m < 1 || m > 12) {
			return { error: 'El mes debe ir del 1 al 12.', field: 'month' };
		}

		const d = toInt(dRaw);
		if (d === null || d < 1) {
			return { error: 'El día debe ser mayor o igual a 1.', field: 'day' };
		}

		const maxDay = maxDayInMonth(y, m);
		if (d > maxDay) {
			return { error: `Ese mes tiene hasta ${maxDay} días.`, field: 'day' };
		}

		return { error: null, field: null };
	});

	const value = $derived.by(() => {
		const y = year.trim();
		const m = month.trim();
		const d = day.trim();
		if (!y && !m && !d) return '';
		if (validation.error) return '__invalid__';
		return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
	});

	$effect(() => {
		const { error, field } = validation;
		if (yearEl) yearEl.setCustomValidity(errorsVisible && field === 'year' && error ? error : '');
		if (monthEl) monthEl.setCustomValidity(errorsVisible && field === 'month' && error ? error : '');
		if (dayEl) dayEl.setCustomValidity(errorsVisible && field === 'day' && error ? error : '');
	});

	const fieldClass = (invalid: boolean) =>
		`w-full rounded-xl border px-3 py-2 text-sm shadow-sm outline-none transition ${
			invalid
				? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100'
				: 'border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:focus:border-primary-400 dark:focus:ring-primary-800'
		} bg-white text-neutral-900 placeholder:text-neutral-400 dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500`;
</script>

<input type="hidden" name={name} value={value} />

<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
	<div class="space-y-1">
		<label class="text-xs font-semibold text-neutral-500 dark:text-neutral-300" for={`${name}-year`}>Año</label>
		<input
			bind:this={yearEl}
			id={`${name}-year`}
			inputmode="numeric"
			autocomplete="off"
			placeholder="AAAA"
			class={fieldClass(validation.field === 'year')}
			bind:value={year}
			oninput={() => (year = normalizeYear(year))}
			maxlength="4"
		/>
	</div>

	<div class="space-y-1">
		<label class="text-xs font-semibold text-neutral-500 dark:text-neutral-300" for={`${name}-month`}>Mes</label>
		<input
			bind:this={monthEl}
			id={`${name}-month`}
			inputmode="numeric"
			autocomplete="off"
			placeholder="MM"
			class={fieldClass(validation.field === 'month')}
			bind:value={month}
			onblur={() => (month = normalizeMonthDay(month))}
			oninput={() => (month = digitsOnly(month).slice(0, 2))}
			maxlength="2"
		/>
	</div>

	<div class="space-y-1">
		<label class="text-xs font-semibold text-neutral-500 dark:text-neutral-300" for={`${name}-day`}>Día</label>
		<input
			bind:this={dayEl}
			id={`${name}-day`}
			inputmode="numeric"
			autocomplete="off"
			placeholder="DD"
			class={fieldClass(validation.field === 'day')}
			bind:value={day}
			onblur={() => (day = normalizeMonthDay(day))}
			oninput={() => (day = digitsOnly(day).slice(0, 2))}
			maxlength="2"
		/>
	</div>
</div>

{#if errorsVisible && validation.error}
	<p class="mt-2 text-sm font-semibold text-red-600" aria-live="polite">{validation.error}</p>
{/if}
