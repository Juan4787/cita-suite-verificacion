<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
 import type { BookingProfessional as Professional, BookingSelection, BookingQuery } from '$lib/scheduling/booking-view';
 let { professionals, selection, queryFor, teamDraftIds = $bindable([]), activeStepCard = $bindable(null) }: {
  professionals: Professional[]; selection: BookingSelection; queryFor: (params: BookingQuery) => string;
  teamDraftIds: string[]; activeStepCard: HTMLElement | null;
 } = $props();
	const initialsFor = (name: string) =>
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('');
	const orderedTeamDraftIds = $derived(
		professionals
			.filter((professional: Professional) => teamDraftIds.includes(professional.id))
			.map((professional: Professional) => professional.id)
	);
	const toggleTeamProfessional = (professionalId: string) => {
		teamDraftIds = teamDraftIds.includes(professionalId)
			? teamDraftIds.filter((id) => id !== professionalId)
			: [...teamDraftIds, professionalId];
	};
</script>

					<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
						<h2 class="ux-section-title">¿Con quién?</h2>
						<div class="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-line bg-fill-04 p-1.5 bk-line bk-soft">
							<a
								data-sveltekit-noscroll
								href={queryFor({
									booking_mode: 'individual',
									professional_id: '',
									professional_ids: '',
									date: '',
									slot: ''
								})}
								aria-current={selection.bookingMode === 'individual' ? 'true' : undefined}
								class={`rounded-xl px-3 py-3 text-center text-sm font-bold transition ${
									selection.bookingMode === 'individual'
										? 'bg-accent-strong text-on-accent shadow-lg shadow-shade-accent-950-30 bk-text bk-accent-fill'
										: 'text-fg-60 hover:bg-fill-04 hover:text-fg bk-muted bk-soft'
								}`}
							>
								Un profesional
							</a>
							{#if professionals.length >= 2}
								<a
									data-sveltekit-noscroll
									href={queryFor({
										booking_mode: 'joint',
										professional_id: '',
										professional_ids: '',
										date: '',
										slot: ''
									})}
									aria-current={selection.bookingMode === 'joint' ? 'true' : undefined}
									class={`rounded-xl px-3 py-3 text-center text-sm font-bold transition ${
										selection.bookingMode === 'joint'
											? 'bg-accent-strong text-on-accent shadow-lg shadow-shade-accent-950-30 bk-text bk-accent-fill'
											: 'text-fg-60 hover:bg-fill-04 hover:text-fg bk-muted bk-soft'
									}`}
								>
									Equipo de profesionales
								</a>
							{:else}
								<span
									aria-disabled="true"
									class="cursor-not-allowed rounded-xl px-3 py-3 text-center text-sm font-bold text-fg-25 bk-muted"
									title="Este procedimiento tiene un solo profesional disponible."
								>
									Equipo de profesionales
								</span>
							{/if}
						</div>

						{#if selection.bookingMode === 'joint'}
							<p class="mt-4 text-sm leading-relaxed text-fg-55 bk-muted">
								Seleccioná dos o más integrantes. Sólo te mostraremos días y horarios en los que todo el
								equipo pueda atender al mismo tiempo.
							</p>
							<div class="mt-4 grid gap-3 sm:grid-cols-2">
								{#each professionals as professional (professional.id)}
									<button
										type="button"
										aria-pressed={teamDraftIds.includes(professional.id)}
										onclick={() => toggleTeamProfessional(professional.id)}
										class={`ux-choice flex min-h-24 items-start gap-4 p-5 text-left ${
											teamDraftIds.includes(professional.id)
												? 'border-accent bg-accent-soft ring-1 ring-focus-accent-500-50 bk-accent-fill'
												: ''
										}`}
									>
										{#if professional.avatar_url}
											<img src={professional.avatar_url} alt="" class="h-12 w-12 shrink-0 rounded-full object-cover" />
										{:else}
											<div class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fill-10 text-sm font-bold text-fg-80 bk-muted bk-soft">
												{initialsFor(professional.name)}
											</div>
										{/if}
										<div class="min-w-0 flex-1">
											<p class="text-lg font-bold text-fg bk-text">{professional.name}</p>
											<p class="mt-0.5 text-sm text-fg-55 bk-muted">{professional.specialty ?? 'Profesional'}</p>
										</div>
										<span
											aria-hidden="true"
											class={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm font-bold ${
												teamDraftIds.includes(professional.id)
													? 'border-accent-400 bg-accent-strong text-on-accent bk-text bk-accent-fill'
													: 'border-line-20 text-transparent bk-line'
											}`}
										>
											<Icon name="check" class="h-4 w-4" />
										</span>
									</button>
								{/each}
							</div>
							<p class="mt-4 text-sm font-semibold text-fg-60 bk-muted" aria-live="polite">
								{orderedTeamDraftIds.length === 0
									? 'Todavía no seleccionaste integrantes.'
									: `${orderedTeamDraftIds.length} ${
											orderedTeamDraftIds.length === 1 ? 'integrante seleccionado' : 'integrantes seleccionados'
										}.`}
							</p>
							{#if orderedTeamDraftIds.length >= 2}
								<a
									data-sveltekit-noscroll
									href={queryFor({
										booking_mode: 'joint',
										professional_id: '',
										professional_ids: orderedTeamDraftIds.join(','),
										date: '',
										slot: ''
									})}
									class="ux-btn-primary mt-4 flex w-full items-center justify-center"
								>
									Buscar horarios para todo el equipo
								</a>
							{:else}
								<button type="button" disabled class="ux-btn-primary mt-4 w-full opacity-45">
									Seleccioná al menos dos profesionales
								</button>
							{/if}
						{:else}
							<p class="mt-4 text-sm text-fg-55 bk-muted">Elegí quién realizará el procedimiento.</p>
							<div class="mt-4 grid gap-3 sm:grid-cols-2">
								{#each professionals as professional (professional.id)}
									<a
										data-sveltekit-noscroll
										data-sveltekit-preload-data="hover"
										href={queryFor({
											booking_mode: 'individual',
											professional_id: professional.id,
											professional_ids: '',
											date: '',
											slot: ''
										})}
										class="ux-choice flex min-h-24 items-start gap-4 p-5"
									>
										{#if professional.avatar_url}
											<img src={professional.avatar_url} alt="" class="h-12 w-12 shrink-0 rounded-full object-cover" />
										{:else}
											<div class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fill-10 text-sm font-bold text-fg-80 bk-muted bk-soft">
												{initialsFor(professional.name)}
											</div>
										{/if}
										<div class="min-w-0">
											<p class="text-lg font-bold text-fg bk-text">{professional.name}</p>
											<p class="mt-0.5 text-sm text-fg-55 bk-muted">{professional.specialty ?? 'Profesional'}</p>
										</div>
									</a>
								{/each}
							</div>
						{/if}
					</section>
