<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import type { PageData } from './$types';

	let { data }: {
		data: {
			appointment: PageData['appointment'];
			active: boolean;
			demo: boolean;
		};
	} = $props();

	const appointment = $derived(data.appointment);
	const timezone = $derived(appointment?.business?.timezone ?? 'America/Argentina/Cordoba');
</script>

<main class="min-h-screen bg-[#06111f] px-4 py-6 text-white sm:py-10">
	<div class="mx-auto flex w-full max-w-2xl flex-col gap-5">
		{#if appointment && data.active}
			<section class="ux-hero">
				{#if appointment.business?.logo_url}
					<img
						src={appointment.business.logo_url}
						alt={appointment.business.name}
						class="mb-5 h-16 w-16 rounded-2xl object-cover"
					/>
				{/if}
				<h1 class="ux-title">Tu turno fue reprogramado</h1>
				<p class="ux-subtitle">Este es el detalle actualizado de tu turno.</p>
			</section>

			<section class="ux-card">
				<h2 class="ux-section-title">Nuevo turno</h2>
				<div class="mt-5 grid gap-4 sm:grid-cols-2">
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-white/55">Servicio</p>
						<p class="mt-2 text-lg font-bold text-white">{appointment.service_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-white/55">
							{appointment.is_joint ? 'Equipo profesional' : 'Profesional'}
						</p>
						<p class="mt-2 text-lg font-bold text-white">{appointment.professional_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5 sm:col-span-2">
						<p class="text-sm font-bold text-white/55">Nueva fecha y hora</p>
						<p class="mt-2 text-lg font-bold text-white">
							{formatDateTime(appointment.starts_at, timezone)}
						</p>
					</div>
					{#if appointment.business?.address}
						<div class="ux-soft-card p-5 sm:col-span-2">
							<p class="text-sm font-bold text-white/55">Ubicación</p>
							<p class="mt-2 text-lg font-bold text-white">{appointment.business.address}</p>
							{#if appointment.business.address_instructions}
								<p class="mt-2 text-sm text-white/70">{appointment.business.address_instructions}</p>
							{/if}
						</div>
					{/if}
				</div>
			</section>

			<section class="ux-card">
				<ul class="flex flex-col gap-3 text-sm text-white/80">
					<li class="flex gap-2">
						<Icon name="bell" class="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							Si activaste las notificaciones de la aplicación al reservar, vas a recibir
							recordatorios en la nueva fecha y horario.
						</span>
					</li>
					<li class="flex gap-2">
						<Icon name="calendar" class="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							Si habías agregado el turno anterior a tu calendario, no olvides actualizarlo.
						</span>
					</li>
				</ul>
			</section>
		{:else}
			<section class="ux-card">
				<h2 class="ux-section-title">Enlace no disponible</h2>
				<p class="mt-3 text-sm text-white/70">
					Este enlace no es válido o el turno ya no está activo. Si tenés dudas, comunicate con el
					consultorio.
				</p>
			</section>
		{/if}
	</div>
</main>
