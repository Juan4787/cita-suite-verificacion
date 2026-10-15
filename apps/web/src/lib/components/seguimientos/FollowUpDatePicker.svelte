<script lang="ts">
	// Selector de fecha custom (sin input type=date). Presets + calendario de mes.
	// Trabaja con strings ISO YYYY-MM-DD en UTC para evitar drift de zona horaria.
	let {
		value = $bindable<string>(''),
		todayISO
	} = $props<{ value?: string; todayISO: string }>();

	const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

	const addDays = (iso: string, n: number) => {
		const d = new Date(`${iso}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	};
	const addMonths = (iso: string, n: number) => {
		const d = new Date(`${iso}T00:00:00Z`);
		d.setUTCMonth(d.getUTCMonth() + n);
		return d.toISOString().slice(0, 10);
	};
	const partsOf = (iso: string) => {
		const [y, m, d] = iso.split('-').map(Number);
		return { y, m: m - 1, d };
	};
	const isoOf = (y: number, m0: number, d: number) =>
		`${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

	const fullLabel = (iso: string) => {
		if (!iso) return '';
		const label = new Intl.DateTimeFormat('es-AR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(new Date(`${iso}T12:00:00`));
		return label.toUpperCase();
	};

	const presets = $derived([
		{ label: 'En 1 semana', iso: addDays(todayISO, 7) },
		{ label: 'En 2 semanas', iso: addDays(todayISO, 14) },
		{ label: 'En 1 mes', iso: addMonths(todayISO, 1) },
		{ label: 'En 3 meses', iso: addMonths(todayISO, 3) },
		{ label: 'En 6 meses', iso: addMonths(todayISO, 6) }
	]);

	let showCalendar = $state(false);
	const initialView = (initialValue: string, initialTodayISO: string) =>
		partsOf(initialValue || initialTodayISO);
	// svelte-ignore state_referenced_locally
	let view = $state(initialView(value, todayISO));

	const grid = $derived.by(() => {
		const first = new Date(Date.UTC(view.y, view.m, 1));
		// getUTCDay: 0=Dom..6=Sáb → reordenar a Lu..Do
		const lead = (first.getUTCDay() + 6) % 7;
		const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
		const cells: Array<{ iso: string; day: number } | null> = [];
		for (let i = 0; i < lead; i++) cells.push(null);
		for (let d = 1; d <= daysInMonth; d++) {
			const iso = isoOf(view.y, view.m, d);
			// No mostrar fechas anteriores a hoy: quedan en blanco (no se renderizan como botón).
			cells.push(iso < todayISO ? null : { iso, day: d });
		}
		return cells;
	});

	const MONTHS = [
		'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
		'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
	];
	// Sin Intl/tz: evitamos que la medianoche UTC se formatee como el mes anterior en zonas UTC-negativas.
	const monthTitle = $derived(`${MONTHS[view.m] ?? ''} ${view.y}`);

	const prevMonth = () => (view = partsOf(addMonths(isoOf(view.y, view.m, 1), -1)));
	const nextMonth = () => (view = partsOf(addMonths(isoOf(view.y, view.m, 1), 1)));
	const canGoPrev = $derived(isoOf(view.y, view.m, 1) > todayISO.slice(0, 7) + '-01');

	const choose = (iso: string) => {
		value = iso;
		showCalendar = false;
	};
</script>

<div class="space-y-3">
	{#if value}
		<div class="rounded-2xl border border-[#7c3aed]/40 bg-[#7c3aed]/10 px-4 py-3 text-center">
			<p class="text-[11px] font-black uppercase tracking-wide text-[#b89bff]">Fecha del recordatorio</p>
			<p class="mt-1 text-lg font-black leading-tight text-white">{fullLabel(value)}</p>
		</div>
	{:else}
		<p class="text-sm text-white/55">Elegí cuándo querés que la app te recuerde contactar al paciente.</p>
	{/if}

	<div class="flex flex-wrap gap-2">
		{#each presets as p}
			<button
				type="button"
				onclick={() => choose(p.iso)}
				class={`rounded-full px-3 py-1.5 text-sm font-bold transition ${
					value === p.iso
						? 'bg-[#7c3aed] text-white'
						: 'bg-white/5 text-white/70 hover:bg-white/10'
				}`}
			>
				{p.label}
			</button>
		{/each}
		<button
			type="button"
			onclick={() => {
				if (!showCalendar && value) view = partsOf(value);
				showCalendar = !showCalendar;
			}}
			class={`rounded-full px-3 py-1.5 text-sm font-bold transition ${
				showCalendar ? 'bg-white/15 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'
			}`}
		>
			Elegir fecha
		</button>
	</div>

	{#if showCalendar}
		<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
			<div class="flex items-center justify-between">
				<button
					type="button"
					onclick={prevMonth}
					disabled={!canGoPrev}
					class="grid h-9 w-9 place-items-center rounded-full text-white/70 transition hover:bg-white/10 disabled:opacity-30"
					aria-label="Mes anterior"
				>‹</button>
				<span class="text-sm font-bold text-white">{monthTitle}</span>
				<button
					type="button"
					onclick={nextMonth}
					class="grid h-9 w-9 place-items-center rounded-full text-white/70 transition hover:bg-white/10"
					aria-label="Mes siguiente"
				>›</button>
			</div>
			<div class="mt-2 grid grid-cols-7 gap-1 text-center">
				{#each WEEKDAYS as wd}
					<span class="py-1 text-[11px] font-bold text-white/40">{wd}</span>
				{/each}
				{#each grid as cell}
					{#if cell}
						<button
							type="button"
							onclick={() => choose(cell.iso)}
							class={`aspect-square rounded-lg text-sm font-bold transition ${
								value === cell.iso ? 'bg-[#7c3aed] text-white' : 'text-white/80 hover:bg-white/10'
							}`}
						>
							{cell.day}
						</button>
					{:else}
						<span></span>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>
