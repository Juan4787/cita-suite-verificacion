<script lang="ts">
 import type { BookingDay, BookingDateWindow, BookingSelection, BookingQuery } from '$lib/scheduling/booking-view';
 let { days, dateWindow, selection, compact, queryFor, visibleDayCount = $bindable(6), activeStepCard = $bindable(null) }: {
  days: BookingDay[]; dateWindow?: BookingDateWindow; selection: BookingSelection; compact: boolean;
  queryFor: (params: BookingQuery) => string; visibleDayCount: number; activeStepCard: HTMLElement | null;
 } = $props();
 const visibleDays = $derived(days.slice(0, visibleDayCount));
	const dateWindowLabel = $derived.by(() => {
		if (!dateWindow) return '';
		const formatter = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
		return formatter.formatRange(new Date(dateWindow.fromDate + 'T12:00:00Z'), new Date(dateWindow.toDate + 'T12:00:00Z'));
	});
</script>

					<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
						<h2 class="ux-section-title">Elegí un día</h2>
						{#if dateWindowLabel}<p class="mt-2 text-sm text-white/70">{dateWindowLabel}</p>{/if}
						<div class="mt-5 grid gap-3 sm:grid-cols-2">
							{#each visibleDays as day (day.date)}
								<a
									data-sveltekit-noscroll
									data-sveltekit-preload-data="hover"
									href={queryFor({ date: day.date, slot: '' })}
									class="ux-choice px-4 py-3"
								>
									<span class="block font-bold text-white">{day.label}</span>
									<span class="mt-0.5 block text-sm text-white/50">
										Horarios disponibles
									</span>
								</a>
							{/each}
						</div>
						{#if visibleDayCount < days.length}
							<button
								type="button"
								class="ux-btn-secondary mt-4 w-full"
								onclick={() => (visibleDayCount = Math.min(visibleDayCount + 6, days.length))}
							>
								Ver más días
							</button>
						{/if}
						{#if days.length === 0}
							<div class="ux-empty mt-4">
								<p class="font-bold text-white/80">
									No hay horarios disponibles entre estas fechas.
								</p>
								<p class="mt-2 text-sm text-white/55">
									{dateWindow?.nextFromDate ? 'Probá con las siguientes fechas.' : 'Elegí otro servicio o profesional, o consultá al consultorio.'}
								</p>
								<a
									data-sveltekit-noscroll
									href={queryFor({
										...(compact ? { service_id: '' } : {}),
										booking_mode: selection.bookingMode,
										professional_id: '',
										professional_ids: '',
										date: '',
										slot: ''
									})}
									class="mt-4 inline-flex font-bold text-[#a78bfa] hover:underline"
								>
									{compact ? 'Cambiar el servicio' : selection.bookingMode === 'joint' ? 'Cambiar el equipo' : 'Cambiar el profesional'}
								</a>
							</div>
						{/if}
                        {#if dateWindow && (dateWindow.previousFromDate || (dateWindow.nextFromDate && visibleDayCount >= days.length))}
                            <nav aria-label="Otras fechas para reservar" class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {#if dateWindow.previousFromDate}
                                    <a class="ux-btn-secondary min-w-0 text-center" data-sveltekit-noscroll data-sveltekit-preload-data="off"
                                        href={queryFor({ dates_from: dateWindow.previousFromDate, date: '', slot: '' })}>Fechas anteriores</a>
                                {/if}
                                {#if dateWindow.nextFromDate && visibleDayCount >= days.length}
                                    <a class={days.length === 0 ? "ux-btn-primary min-w-0 text-center sm:col-start-2" : "ux-btn-secondary min-w-0 text-center sm:col-start-2"} data-sveltekit-noscroll data-sveltekit-preload-data="off"
                                        href={queryFor({ dates_from: dateWindow.nextFromDate, date: '', slot: '' })}>Fechas siguientes</a>
                                {/if}
                            </nav>
                        {/if}
					</section>
