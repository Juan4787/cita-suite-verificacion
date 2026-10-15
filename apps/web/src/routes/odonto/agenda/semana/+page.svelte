<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { formatDate } from '$lib/utils/format';

	type DaySummary = {
		date: string;
		total: number;
		stats: Array<{ status: string; count: number }>;
	};
	type Professional = { id: string; name: string; is_active: boolean };

	let { data } = $props<{
		data: {
			selectedDate: string;
			selectedProfessionalId: string;
			days: DaySummary[];
			professionals: Professional[];
		};
	}>();

	const statusLabels: Record<string, string> = {
		reserved: 'Reservados',
		confirmed: 'Confirmados',
		cancelled: 'Cancelados',
		reschedule_requested: 'Reprogramar'
	};

	const statusText = (day: DaySummary) =>
		day.stats
			.filter((stat) => stat.count > 0)
			.map((stat) => `${statusLabels[stat.status] ?? stat.status}: ${stat.count}`)
			.join(' · ');
	const shiftedWeekHref = (days: number) => {
		const date = new Date(`${data.selectedDate}T00:00:00.000Z`);
		date.setUTCDate(date.getUTCDate() + days);
		const params = new URLSearchParams({ date: date.toISOString().slice(0, 10) });
		if (data.selectedProfessionalId) params.set('professional_id', data.selectedProfessionalId);
		return `/odonto/agenda/semana?${params.toString()}`;
	};

	const totalWeek = $derived(data.days.reduce((sum: number, day: DaySummary) => sum + day.total, 0));
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<BackLink href={`/odonto/agenda?date=${data.selectedDate}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} label="Volver al día" class="mb-4" />
				<p class="ux-badge">Semana</p>
				<h1 class="ux-title mt-4">Agenda semanal</h1>
				<p class="ux-subtitle">Carga de turnos por día para anticipar demanda.</p>
			</div>
			<div class="ux-soft-card min-w-36 p-5 text-center">
				<p class="text-sm font-bold text-white/55">Turnos</p>
				<p class="mt-1 text-4xl font-bold text-white">{totalWeek}</p>
			</div>
		</div>
	</div>

	<div class="ux-card">
		<form method="GET" class="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
			<label>
				<span class="ux-label">Semana</span>
				<input type="date" name="date" value={data.selectedDate} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Profesional</span>
				<select name="professional_id" class="ux-select">
					<option value="">Todos</option>
					{#each data.professionals as professional}
						<option value={professional.id} selected={professional.id === data.selectedProfessionalId}>{professional.name}</option>
					{/each}
				</select>
			</label>
			<button class="ux-btn-primary self-end">Buscar</button>
		</form>
	</div>

	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
		{#each data.days as day}
			<a href={`/odonto/agenda?date=${day.date}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} class={`ux-choice p-5 ${day.total > 0 ? '' : 'opacity-70'}`}>
				<p class="text-sm font-bold capitalize text-white">{formatDate(`${day.date}T00:00:00`)}</p>
				<p class="mt-4 text-4xl font-bold text-white">{day.total}</p>
				<p class="mt-1 text-sm text-white/50">turnos</p>
				{#if statusText(day)}
					<p class="mt-5 text-xs leading-5 text-white/55">{statusText(day)}</p>
				{:else}
					<p class="mt-5 text-xs leading-5 text-white/42">Sin turnos.</p>
				{/if}
			</a>
		{/each}
	</div>
	<nav class="flex items-center justify-between gap-3 pt-1" aria-label="Navegación entre semanas">
		<a href={shiftedWeekHref(-7)} class="ux-btn-secondary min-w-0 flex-1 px-3 text-sm sm:min-w-44 sm:flex-none sm:px-5">
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-4 w-4 shrink-0">
				<path d="M12.5 5 7.5 10l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			<span class="truncate">Semana anterior</span>
		</a>
		<a href={shiftedWeekHref(7)} class="ux-btn-secondary min-w-0 flex-1 px-3 text-sm sm:min-w-44 sm:flex-none sm:px-5">
			<span class="truncate">Semana siguiente</span>
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-4 w-4 shrink-0">
				<path d="m7.5 5 5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</a>
	</nav>

	{#if data.days.length === 0}
		<div class="ux-empty">No hay datos semanales para mostrar.</div>
	{/if}
</section>
