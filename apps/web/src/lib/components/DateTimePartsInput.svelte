<script lang="ts">
	type InvalidField = 'year' | 'month' | 'day' | 'time' | null;

	let {
		name = 'created_at',
		/**
		 * When provided, should be an ISO string or something Date can parse.
		 * When omitted, the component prefills with the current date/time.
		 */
		initialValue = null,
		minYear = 2000,
		maxYear = 2045,
		showErrors = false
	} = $props<{
		name?: string;
		initialValue?: string | null;
		minYear?: number;
		maxYear?: number;
		showErrors?: boolean;
	}>();

	const now = new Date();

	let year = $state(String(now.getFullYear()));
	let month = $state(String(now.getMonth() + 1).padStart(2, '0'));
	let day = $state(String(now.getDate()).padStart(2, '0'));
	let time = $state(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);

	let yearEl: HTMLInputElement | null = $state(null);
	let monthEl: HTMLInputElement | null = $state(null);
	let dayEl: HTMLInputElement | null = $state(null);
	let timeEl: HTMLInputElement | null = $state(null);
	let errorsVisible = $derived(showErrors);

	$effect(() => {
		if (!initialValue) return;
		const initial = new Date(initialValue);
		if (Number.isNaN(initial.valueOf())) return;
		year = String(initial.getFullYear());
		month = String(initial.getMonth() + 1).padStart(2, '0');
		day = String(initial.getDate()).padStart(2, '0');
		time = `${String(initial.getHours()).padStart(2, '0')}:${String(initial.getMinutes()).padStart(2, '0')}`;
	});

	const normalizeTime = (raw: string) => {
		const trimmed = raw.trim();
		if (!trimmed) return '';

		const parts = trimmed.split(':');
		if (parts.length >= 2) {
			const hh = parts[0]?.replace(/\D/g, '') ?? '';
			const mm = parts[1]?.replace(/\D/g, '') ?? '';
			return `${hh.padStart(2, '0').slice(0, 2)}:${mm.padStart(2, '0').slice(0, 2)}`;
		}

		const digits = trimmed.replace(/\D/g, '');
		if (!digits) return '';
		if (digits.length <= 2) {
			return `${digits.padStart(2, '0').slice(0, 2)}:00`;
		}
		return `${digits.slice(0, 2).padStart(2, '0')}:${digits.slice(2, 4).padEnd(2, '0').slice(0, 2)}`;
	};

	const toInt = (raw: string) => {
		if (!raw) return null;
		const n = Number(raw);
		return Number.isInteger(n) ? n : null;
	};

	const maxDayInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

	const validation = $derived.by((): { error: string | null; field: InvalidField } => {
		const yRaw = year.trim();
		const mRaw = month.trim();
		const dRaw = day.trim();
		const tNorm = normalizeTime(time);

		if (!yRaw || !mRaw || !dRaw) {
			return {
				error: 'Completá Año, Mes y Día.',
				field: !yRaw ? 'year' : !mRaw ? 'month' : 'day'
			};
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

		const hhRaw = tNorm.split(':')[0] ?? '';
		const mmRaw = tNorm.split(':')[1] ?? '';
		const hh = toInt(hhRaw);
		const mm = toInt(mmRaw);
		if (hh === null || mm === null || hhRaw.length !== 2 || mmRaw.length !== 2) {
			return { error: 'La hora debe estar en formato 00:00 (por ejemplo 09:30).', field: 'time' };
		}
		if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
			return { error: 'La hora debe estar entre 00:00 y 23:59.', field: 'time' };
		}

		return { error: null, field: null };
	});

	const createdAtValue = $derived.by(() => {
		if (validation.error) return '';
		const y = year.trim();
		const m = month.trim();
		const d = day.trim();
		const t = normalizeTime(time);
		const hh = t.split(':')[0] ?? '';
		const mm = t.split(':')[1] ?? '';
		return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
	});

	const normalizeMonthDay = (value: string) => value.replace(/\D/g, '').padStart(2, '0').slice(0, 2);

	$effect(() => {
		const { error, field } = validation;
		if (yearEl) yearEl.setCustomValidity(errorsVisible && field === 'year' && error ? error : '');
		if (monthEl) monthEl.setCustomValidity(errorsVisible && field === 'month' && error ? error : '');
		if (dayEl) dayEl.setCustomValidity(errorsVisible && field === 'day' && error ? error : '');
		if (timeEl) timeEl.setCustomValidity(errorsVisible && field === 'time' && error ? error : '');
	});

	const fieldClass = (invalid: boolean) =>
		`w-full rounded-xl border px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition ${
			invalid
				? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100'
				: 'border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:focus:border-primary-400 dark:focus:ring-primary-800'
		} bg-white placeholder:text-neutral-400 dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500`;
</script>

<input type="hidden" name={name} value={createdAtValue} />

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
	<div class="space-y-1">
		<label class="text-xs font-semibold text-neutral-500 dark:text-neutral-300" for={`${name}-year`}>Año</label>
		<input
			id={`${name}-year`}
			inputmode="numeric"
			autocomplete="off"
			placeholder="AAAA"
			bind:this={yearEl}
			class={fieldClass(validation.field === 'year')}
			bind:value={year}
			maxlength="4"
			oninput={() => (year = year.replace(/\D/g, '').slice(0, 4))}
		/>
	</div>

	<div class="space-y-1">
		<label class="text-xs font-semibold text-neutral-500 dark:text-neutral-300" for={`${name}-month`}>Mes</label>
		<input
			id={`${name}-month`}
			inputmode="numeric"
			autocomplete="off"
			placeholder="MM"
			bind:this={monthEl}
			class={fieldClass(validation.field === 'month')}
			bind:value={month}
			maxlength="2"
			oninput={() => (month = month.replace(/\D/g, '').slice(0, 2))}
			onblur={() => (month = normalizeMonthDay(month))}
		/>
	</div>

	<div class="space-y-1">
		<label class="text-xs font-semibold text-neutral-500 dark:text-neutral-300" for={`${name}-day`}>Día</label>
		<input
			id={`${name}-day`}
			inputmode="numeric"
			autocomplete="off"
			placeholder="DD"
			bind:this={dayEl}
			class={fieldClass(validation.field === 'day')}
			bind:value={day}
			maxlength="2"
			oninput={() => (day = day.replace(/\D/g, '').slice(0, 2))}
			onblur={() => (day = normalizeMonthDay(day))}
		/>
	</div>

	<div class="space-y-1">
		<label class="text-xs font-semibold text-neutral-500 dark:text-neutral-300" for={`${name}-time`}>Hora</label>
		<input
			id={`${name}-time`}
			inputmode="numeric"
			autocomplete="off"
			placeholder="HH:MM"
			bind:this={timeEl}
			class={fieldClass(validation.field === 'time')}
			bind:value={time}
			maxlength="5"
			onblur={() => (time = normalizeTime(time))}
		/>
	</div>
</div>

{#if errorsVisible && validation.error}
	<p class="mt-2 text-sm font-semibold text-red-600" aria-live="polite">{validation.error}</p>
{/if}
