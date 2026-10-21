<script lang="ts">
	import TeamMemberWizard from '$lib/components/team/TeamMemberWizard.svelte';
	import { roleLabels, type TeamServiceOption } from '$lib/team/member-editor';
	import { createClientReadiness } from '$lib/client/readiness.svelte';
	const client = createClientReadiness();
	import type { BusinessRoleAccess as RoleAccess } from '$lib/access/team-contracts';
	import type { BusinessContext, BusinessRole } from '$lib/access/contracts';
	import { canConfigureAttendingProfile } from '$lib/utils/team-permissions';
	import Modal from '$lib/components/Modal.svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		data,
		form
	}: {
		data: {
			context: BusinessContext;
			members: RoleAccess[];
			services: TeamServiceOption[];
			roles: readonly BusinessRole[];
			defaultServiceNames: readonly string[];
			currentUserId: string | null;
			demo: boolean;
		};
		form?: {
			success?: boolean;
			message?: string;
			openRole?: BusinessRole;
			values?: Record<string, FormDataEntryValue>;
		};
	} = $props();

	const members = $derived(data.members);
	const roles = $derived(data.roles);
	const canManage = $derived(data.context.canManage && !data.demo && client.ready);
	const isAssisting = $derived(Boolean(data.context.assistance));

	// ----- Configurar atendible (dueño/admin que también atiende pacientes) -----
	let showAttendingForm = $state(false);
	let attendingAccessId = $state('');
	let attendingName = $state('');
	let attendingError = $state('');
	const attendingEligible = $derived(
		members.filter((member) =>
			canConfigureAttendingProfile({
				actorRole: data.context.role,
				targetRole: member.role,
				isAssisting
			})
		)
	);
	const attendingPending = $derived(attendingEligible.filter((m) => !m.professional_id));
	const attendingActive = $derived(attendingEligible.filter((m) => m.professional_id));

	// Categorías desplegables de la pantalla Equipo.
	type Category = { id: string; title: string; role: BusinessRole };
	const baseCategories: Category[] = [
		{ id: 'owner', title: 'Dueño', role: 'owner' },
		{ id: 'admin', title: 'Administradores', role: 'admin' },
		{ id: 'reception', title: 'Recepción', role: 'reception' },
		{ id: 'professional', title: 'Profesionales', role: 'professional' }
	];
	const categories = $derived(
		members.some((member) => member.role === 'readonly')
			? [
					...baseCategories,
					{ id: 'readonly', title: 'Solo lectura', role: 'readonly' as BusinessRole }
				]
			: baseCategories
	);
	// svelte-ignore state_referenced_locally
	let openCategories = $state<Record<string, boolean>>(
		form?.success && form.openRole ? { [form.openRole]: true } : {}
	);
	const toggleCategory = (id: string) => {
		openCategories = { ...openCategories, [id]: !openCategories[id] };
	};
	const membersByRole = (role: BusinessRole) => members.filter((member) => member.role === role);

	const memberRoleOptions = (member: RoleAccess) =>
		roles.includes(member.role) ? roles : [...roles, member.role];
	const canEditMemberRole = (member: RoleAccess) =>
		member.status === 'active' &&
		member.role !== 'owner' &&
		!(isAssisting && member.role === 'admin');
	const canRemoveMember = (member: RoleAccess) =>
		member.role !== 'owner' && !(isAssisting && member.role === 'admin');

	const formatDate = (value: string) =>
		value
			? new Intl.DateTimeFormat('es-AR', {
					day: '2-digit',
					month: '2-digit',
					year: 'numeric'
				}).format(new Date(value))
			: 'Sin fecha';

	let showWizard = $state(false);
	let attendingSubmitting = $state(false);
	let teamActionBusy = $state('');
	let memberToRemove = $state<RoleAccess | null>(null);
	$effect(() => {
		if (form?.values) showWizard = true;
	});
	const toggleWizard = () => {
		showWizard = !showWizard;
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="ux-title">Equipo</h1>
				<p class="ux-subtitle">Gestioná quién puede entrar al consultorio y qué rol cumple.</p>
			</div>
			<button type="button" class="ux-btn-primary" disabled={!canManage} onclick={toggleWizard}>
				{showWizard ? 'Cerrar' : 'Agregar integrante'}
			</button>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}
	{#if data.demo}
		<p class="ux-empty">El equipo no se modifica en modo demo.</p>
	{/if}

	{#if showWizard}
        {#key `${data.context.business.id}:${data.currentUserId}`}
        <TeamMemberWizard services={data.services} roles={data.roles} defaultServiceNames={data.defaultServiceNames} {canManage} {form} onclose={()=>showWizard=false} />
        {/key}
    {/if}

	{#if attendingEligible.length > 0}
		<div class="ux-card">
			<h2 class="ux-section-title">¿El dueño o un administrador también atiende pacientes?</h2>
			<p class="mt-2 text-sm text-white/55">
				Si una persona del equipo también atiende pacientes, creá su perfil profesional para configurar
				horarios y servicios. Si todavía no creó su cuenta, el perfil queda preparado y oculto de las
				reservas online hasta que se registre. No cambia su rol.
			</p>

			{#if attendingActive.length > 0}
				<div class="mt-4 grid gap-2">
					{#each attendingActive as m (m.id)}
						<div class="ux-choice flex min-w-0 items-center justify-between gap-3 p-4">
							<span class="min-w-0 break-all font-bold text-white">{m.email}</span>
							<a href={`/odonto/profesionales/${m.professional_id}`} class="ux-btn-secondary shrink-0 text-sm">
								Ver profesional
							</a>
						</div>
					{/each}
				</div>
			{/if}

			{#if attendingPending.length > 0}
				{#if !showAttendingForm}
					<button
						type="button"
						onclick={() => (showAttendingForm = true)}
						disabled={!canManage}
						class="ux-btn-primary mt-4 disabled:opacity-50"
					>
						Configurar
					</button>
				{:else}
					<form
						method="POST"
						action="?/make_attending"
						class="mt-4 grid gap-3"
						use:enhance={() => {
							attendingError = '';
							attendingSubmitting = true;
							return async ({ result }) => {
								if (result.type === 'redirect') {
									window.location.assign(result.location);
									return;
								}
								attendingSubmitting = false;
								if (result.type === 'failure') {
									attendingError = (result.data?.message as string) ?? 'No se pudo configurar.';
									return;
								}
								if (result.type === 'error') {
									attendingError = 'Ocurrió un error. Intentá de nuevo.';
								}
							};
						}}
					>
						<label class="block">
							<span class="ux-label">Persona del equipo</span>
							<select name="access_id" bind:value={attendingAccessId} required class="ux-select">
								<option value="" disabled>Elegí…</option>
								{#each attendingPending as m (m.id)}
									<option value={m.id}>
										{m.email} · {roleLabels[m.role]}{m.status === 'pending' ? ' · cuenta pendiente' : ''}
									</option>
								{/each}
							</select>
						</label>
						<label class="block">
							<span class="ux-label">Nombre profesional (como aparece en la agenda)</span>
							<input name="name" bind:value={attendingName} placeholder="Ej: Dr. Juan Pérez" required class="ux-input" />
						</label>
						{#if attendingError}<p class="ux-alert">{attendingError}</p>{/if}
						<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<button type="button" onclick={() => (showAttendingForm = false)} class="ux-btn-secondary">Cancelar</button>
							<button type="submit" disabled={!canManage || attendingSubmitting} class="ux-btn-primary disabled:opacity-50">
								{attendingSubmitting ? 'Creando...' : 'Crear perfil profesional'}
							</button>
						</div>
					</form>
				{/if}
			{:else}
				<p class="mt-4 text-sm text-white/45">
					Todos los dueños y administradores del equipo ya tienen su perfil profesional.
				</p>
			{/if}
		</div>
	{/if}

		<div class="grid gap-4">
		{#each categories as category}
			{@const categoryMembers = membersByRole(category.role)}
			<article class="ux-card overflow-hidden p-0">
				<button
					type="button"
					class="flex w-full items-center justify-between gap-4 px-4 py-4 text-left sm:px-6 sm:py-5"
					onclick={() => toggleCategory(category.id)}
					disabled={!client.ready}
					aria-expanded={Boolean(openCategories[category.id])}
				>
					<span class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
						<span class="text-lg font-bold text-white sm:text-xl">{category.title}</span>
						<span class="ux-badge">{categoryMembers.length}</span>
					</span>
					<svg
						class={`h-5 w-5 shrink-0 text-white/45 transition-transform ${openCategories[category.id] ? 'rotate-180' : ''}`}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
					</svg>
				</button>

				{#if openCategories[category.id]}
					<div class="grid gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
						{#each categoryMembers as member}
							<div class="ux-soft-card min-w-0 p-4">
								<div class="flex flex-col gap-4 min-w-0 lg:flex-row lg:items-center lg:justify-between">
									<div class="min-w-0 flex-1">
										<div class="flex min-w-0 flex-wrap items-center gap-2">
											<h3 class="min-w-0 max-w-full break-all text-lg font-bold text-white">{member.email}</h3>
											{#if member.user_id === data.currentUserId}
												<span class="ux-badge shrink-0">Vos</span>
											{/if}
											{#if member.status === 'pending'}
												<span class="ux-badge ux-badge-warning shrink-0">Pendiente</span>
											{/if}
										</div>
										<p class="mt-2 text-sm text-white/55">
											{roleLabels[member.role]} · {member.status === 'pending' ? 'invitado el' : 'agregado el'} {formatDate(member.created_at)}
										</p>
										{#if member.status === 'pending' && member.professional_id}
											<div class="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3" role="status">
												<p class="font-bold text-amber-100">Cuenta profesional pendiente</p>
												<p class="mt-1 text-sm text-amber-50/80">
													No aparecerá en las reservas online hasta que cree su cuenta con <strong>{member.email}</strong>.
													Cuando se registre, accederá al perfil ya configurado.
												</p>
											</div>
										{/if}
									</div>

									<div class="flex flex-col gap-2 min-w-0 sm:flex-row sm:items-center sm:flex-wrap">
										{#if member.professional_id && (member.role === 'professional' || member.role === 'owner' || member.role === 'admin')}
											<a href={`/odonto/profesionales/${member.professional_id}`} class="ux-btn-primary text-center w-full sm:w-auto shrink-0">
												Ver profesional
											</a>
										{/if}
										{#if canEditMemberRole(member)}
											<form
												method="POST"
												action="?/update_role"
												class="flex w-full flex-col gap-2 min-w-0 sm:w-auto sm:flex-row sm:items-center"
												use:enhance={() => {
													teamActionBusy = `update-${member.id}`;
													return async ({ update }) => {
														teamActionBusy = '';
												await update({ reset: false, invalidateAll: false });
												await invalidate('app:team');
													};
												}}
											>
												<input type="hidden" name="membership_id" value={member.id} />
												<select name="role" disabled={!canManage} class="ux-select w-full min-w-0 sm:w-auto sm:min-w-44">
													{#each memberRoleOptions(member) as option}
														<option value={option} selected={member.role === option}>{roleLabels[option]}</option>
													{/each}
												</select>
												<button type="submit" disabled={!canManage || teamActionBusy === `update-${member.id}`} class="ux-btn-secondary w-full sm:w-auto shrink-0">
													{teamActionBusy === `update-${member.id}` ? 'Guardando...' : 'Guardar'}
												</button>
											</form>
										{/if}
										{#if canRemoveMember(member)}
											<button
												type="button"
												disabled={!canManage || member.user_id === data.currentUserId || teamActionBusy === `remove-${member.id}`}
												class="ux-btn-danger w-full sm:w-auto shrink-0"
												onclick={() => (memberToRemove = member)}
											>
												Quitar
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/each}
						{#if categoryMembers.length === 0}
							<p class="ux-empty">
								{category.role === 'professional'
									? 'Todavía no hay profesionales. Usá Agregar integrante con rol Profesional.'
									: 'Nadie ocupa este rol todavía.'}
							</p>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</div>
</section>

<Modal
	open={Boolean(memberToRemove)}
	title="Eliminar rol"
	dismissible={!teamActionBusy}
	on:close={() => {
		if (!teamActionBusy) memberToRemove = null;
	}}
>
	{#if memberToRemove}
		<div class="space-y-4 text-neutral-800 dark:text-neutral-100">
			<p class="text-base font-semibold text-neutral-900 dark:text-white">
				¿Seguro querés eliminar este rol?
			</p>
			<p class="text-sm text-neutral-600 dark:text-white/70">
				Se quitará el rol de <strong class="text-neutral-900 dark:text-white">{roleLabels[memberToRemove.role]}</strong> para <strong class="text-neutral-900 dark:text-white">{memberToRemove.email}</strong>{memberToRemove.status === 'pending' ? ' (invitación pendiente)' : ''}. Esta acción no se puede deshacer.
			</p>
			<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<button
					type="button"
					class="ux-btn-secondary"
					disabled={Boolean(teamActionBusy)}
					onclick={() => (memberToRemove = null)}
				>
					Cancelar
				</button>
				<form
					method="POST"
					action="?/remove_user"
					use:enhance={() => {
						const removingId = memberToRemove?.id;
						teamActionBusy = `remove-${removingId}`;
						return async ({ update }) => {
							teamActionBusy = '';
							memberToRemove = null;
							await update({ reset: false, invalidateAll: false });
							await invalidate('app:team');
						};
					}}
				>
					<input type="hidden" name="access_id" value={memberToRemove.id} />
					<input type="hidden" name="status" value={memberToRemove.status} />
					<button
						type="submit"
						disabled={!canManage || Boolean(teamActionBusy)}
						class="ux-btn-danger w-full sm:w-auto"
					>
						{teamActionBusy === `remove-${memberToRemove.id}` ? 'Quitando...' : 'Quitar rol'}
					</button>
				</form>
			</div>
		</div>
	{/if}
</Modal>
