<script lang="ts">
	import { formatDateTime } from '$lib/utils/format';

	type ProfessionalLink = {
		professional_id: string;
		professionals: { id: string; name: string; specialty: string | null; is_active: boolean };
	};
	type Appointment = {
		id: string;
		starts_at: string;
		ends_at: string;
		status: string;
		source: string;
		service_name_snapshot: string;
		professional_name_snapshot: string;
		patients?: { id: string; full_name: string; phone_e164: string | null } | null;
	};

	let { data } = $props<{
		data: {
			professionalLinks: ProfessionalLink[];
			selectedProfessionalId: string;
			todayAppointments: Appointment[];
			upcomingAppointments: Appointment[];
			demo: boolean;
		};
	}>();

	const statusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Reprogramar'
	};

	const statusTone: Record<string, string> = {
		reserved: 'ux-badge',
		confirmed: 'ux-badge ux-badge-success',
		cancelled: 'ux-badge ux-badge-danger',
		reschedule_requested: 'ux-badge ux-badge-warning'
	};

	const timeOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

	const selectedProfile = $derived(
		data.professionalLinks.find((link: ProfessionalLink) => link.professional_id === data.selectedProfessionalId)?.professionals ??
			null
	);
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Profesional</p>
				<h1 class="ux-title mt-4">Mis turnos</h1>
				<p class="ux-subtitle">
					{selectedProfile ? selectedProfile.name : 'Tu agenda de hoy y próximos turnos.'}
				</p>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="ux-soft-card min-w-0 p-4 text-center">
					<p class="text-sm font-bold text-white/55">Hoy</p>
					<p class="mt-1 text-3xl font-bold text-white">{data.todayAppointments.length}</p>
				</div>
				<div class="ux-soft-card min-w-0 p-4 text-center">
					<p class="text-sm font-bold text-white/55">Próximos</p>
					<p class="mt-1 text-3xl font-bold text-white">{data.upcomingAppointments.length}</p>
				</div>
			</div>
		</div>
	</div>

	{#if data.professionalLinks.length === 0}
		<div class="ux-empty">Tu usuario no está asociado a ningún profesional.</div>
	{:else}
		<div class="ux-card">
			<form method="GET" class="grid gap-4 md:grid-cols-[1fr_auto]">
				<label>
					<span class="ux-label">Perfil</span>
					<select name="professional_id" class="ux-select">
						<option value="">Todos mis perfiles</option>
						{#each data.professionalLinks as link}
							<option value={link.professional_id} selected={link.professional_id === data.selectedProfessionalId}>
								{link.professionals.name}{link.professionals.specialty ? ` · ${link.professionals.specialty}` : ''}
							</option>
						{/each}
					</select>
				</label>
				<button class="ux-btn-primary self-end">Ver</button>
			</form>
		</div>

		<div class="ux-card">
			<h2 class="ux-section-title">Hoy</h2>
			<div class="mt-5 grid gap-3">
				{#each data.todayAppointments as appointment}
					<a href={`/odonto/turnos/${appointment.id}`} class="ux-choice flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
						<div class="w-14 shrink-0 text-center sm:w-20">
							<p class="text-xl font-bold text-white sm:text-2xl">{timeOnly(appointment.starts_at)}</p>
							<p class="mt-0.5 text-xs text-white/40">{timeOnly(appointment.ends_at)}</p>
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-base font-bold text-white sm:text-lg">{appointment.service_name_snapshot}</p>
							<p class="mt-0.5 truncate text-sm text-white/55">
								{appointment.patients?.full_name ?? 'Paciente'}{appointment.patients?.phone_e164 ? ` · ${appointment.patients.phone_e164}` : ''}
							</p>
							<div class="mt-2">
								<span class={statusTone[appointment.status] ?? 'ux-badge'}>{statusLabels[appointment.status] ?? appointment.status}</span>
							</div>
						</div>
						<svg class="h-5 w-5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
					</a>
				{/each}
				{#if data.todayAppointments.length === 0}
					<p class="ux-empty">No tenés turnos asignados para hoy.</p>
				{/if}
			</div>
		</div>

		<div class="ux-card">
			<h2 class="ux-section-title">Próximos</h2>
			<div class="mt-5 grid gap-3">
				{#each data.upcomingAppointments as appointment}
					<a href={`/odonto/turnos/${appointment.id}`} class="ux-choice flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
						<div class="min-w-0 flex-1">
							<p class="truncate text-base font-bold text-white">{formatDateTime(appointment.starts_at)}</p>
							<p class="mt-0.5 truncate text-sm text-white/55">{appointment.service_name_snapshot}</p>
							<div class="mt-2">
								<span class={statusTone[appointment.status] ?? 'ux-badge'}>{statusLabels[appointment.status] ?? appointment.status}</span>
							</div>
						</div>
						<svg class="h-5 w-5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
					</a>
				{/each}
				{#if data.upcomingAppointments.length === 0}
					<p class="ux-empty">Todavía no hay turnos futuros asignados.</p>
				{/if}
			</div>
		</div>
	{/if}
</section>
