<script lang="ts">
	// Selector de día para los filtros de agenda. Emite por un input hidden
	// "YYYY-MM-DD" o "any" (cualquier día) dentro del form GET que lo contiene.
	let { value, name = 'date' } = $props<{ value: string; name?: string }>();

	const pad = (n: number) => String(n).padStart(2, '0');
	const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const parseKey = (key: string) => new Date(`${key}T12:00:00`);
	const isDateKey = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
	const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

	const todayKey = dateKey(new Date());
	const tomorrowKey = (() => {
		const d = new Date();
		d.setDate(d.getDate() + 1);
		return dateKey(d);
	})();

	// Derived reasignable: el valor del URL manda tras cada navegación y la
	// elección local del usuario lo pisa hasta el próximo cambio de `value`.
	let selected = $derived(value);
	let open = $state(false);
	let viewYear = $state(new Date().getFullYear());
	let viewMonth = $state(new Date().getMonth());

	// El mes visible se sincroniza al abrir el panel (toggleOpen).
	const syncView = (key: string) => {
		const base = isDateKey(key) ? parseKey(key) : new Date();
		viewYear = base.getFullYear();
		viewMonth = base.getMonth();
	};

	const isAny = $derived(selected === 'any');
	const monthTitle = $derived(
		capitalize(
			new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(viewYear, viewMonth, 1))
		)
	);
	const triggerLabel = $derived.by(() => {
		if (isAny) return 'Cualquier día';
		if (!isDateKey(selected)) return 'Elegir día';
		const d = parseKey(selected);
		const formatted = capitalize(
			new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
		);
		if (selected === todayKey) return `Hoy · ${formatted}`;
		if (selected === tomorrowKey) return `Mañana · ${formatted}`;
		return d.getFullYear() === new Date().getFullYear() ? formatted : `${formatted} ${d.getFullYear()}`;
	});

	const weekdays = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
	const cells = $derived.by(() => {
		const first = new Date(viewYear, viewMonth, 1);
		const offset = (first.getDay() + 6) % 7; // semana que arranca en lunes
		const total = new Date(viewYear, viewMonth + 1, 0).getDate();
		return [
			...Array.from({ length: offset }, () => null as number | null),
			...Array.from({ length: total }, (_, i) => (i + 1) as number | null)
		];
	});
	const keyOf = (day: number) => `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;

	const toggleOpen = () => {
		if (!open) syncView(selected);
		open = !open;
	};
	const pick = (val: string) => {
		selected = val;
		open = false;
	};
	const moveMonth = (delta: number) => {
		const d = new Date(viewYear, viewMonth + delta, 1);
		viewYear = d.getFullYear();
		viewMonth = d.getMonth();
	};

	const quickPickClass = (active: boolean) =>
		`rounded-xl border px-2 py-2.5 text-xs font-bold transition ${
			active
				? 'border-[#8b5cf6] bg-[#7c3aed]/25 text-white'
				: 'border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/10'
		}`;
	const dayClass = (key: string) =>
		`grid h-9 w-9 place-items-center justify-self-center rounded-lg text-sm font-semibold transition ${
			selected === key
				? 'bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30'
				: key === todayKey
					? 'text-[#c4b5fd] ring-1 ring-inset ring-[#8b5cf6]/50 hover:bg-white/10'
					: 'text-white/75 hover:bg-white/10'
		}`;
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && open) open = false;
	}}
/>

<input type="hidden" {name} value={selected} />

<div class="relative">
	<button
		type="button"
		class="ux-input flex items-center justify-between gap-2 text-left"
		aria-haspopup="dialog"
		aria-expanded={open}
		onclick={toggleOpen}
	>
		<span class="flex min-w-0 items-center gap-2.5">
			<svg class="h-5 w-5 shrink-0 text-[#c4b5fd]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<rect x="3" y="4.5" width="18" height="17" rx="3" />
				<path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
			</svg>
			<span class="truncate font-semibold">{triggerLabel}</span>
		</span>
		<svg class={`h-4 w-4 shrink-0 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="m6 9 6 6 6-6" />
		</svg>
	</button>

	{#if open}
		<button
			type="button"
			class="fixed inset-0 z-20 cursor-default"
			tabindex="-1"
			aria-label="Cerrar calendario"
			onclick={() => (open = false)}
		></button>
		<div
			class="absolute left-0 top-full z-30 mt-2 w-[19.5rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-[#244062] bg-[#0b1d32] p-4 shadow-2xl shadow-black/50"
			role="dialog"
			aria-label="Elegir día"
		>
			<div class="grid grid-cols-[1.35fr_1fr_1fr] gap-2">
				<button type="button" class={quickPickClass(isAny)} onclick={() => pick('any')}>Cualquier día</button>
				<button type="button" class={quickPickClass(selected === todayKey)} onclick={() => pick(todayKey)}>Hoy</button>
				<button type="button" class={quickPickClass(selected === tomorrowKey)} onclick={() => pick(tomorrowKey)}>
					Mañana
				</button>
			</div>

			<div class="mt-4 flex items-center justify-between">
				<button
					type="button"
					aria-label="Mes anterior"
					class="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/75 transition hover:bg-white/10"
					onclick={() => moveMonth(-1)}
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
				</button>
				<p class="text-sm font-bold text-white">{monthTitle}</p>
				<button
					type="button"
					aria-label="Mes siguiente"
					class="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/75 transition hover:bg-white/10"
					onclick={() => moveMonth(1)}
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
				</button>
			</div>

			<div class="mt-3 grid grid-cols-7 gap-1 text-center">
				{#each weekdays as weekday}
					<span class="text-[11px] font-bold uppercase text-white/35">{weekday}</span>
				{/each}
				{#each cells as cell, index (index)}
					{#if cell === null}
						<span></span>
					{:else}
						{@const key = keyOf(cell)}
						<button type="button" class={dayClass(key)} aria-pressed={selected === key} onclick={() => pick(key)}>
							{cell}
						</button>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>
