<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type {
		ProfessionalDraft,
		ProfessionalDirtyFields,
		ProfessionalEditorSaving
	} from '$lib/team/professional-editor';
	let {
		draft = $bindable(),
		dirtyFields,
		canOperate,
		accountLinkPending,
		shouldSaveProfile,
		missingItems,
		saving,
		onSave
	}: {
		draft: ProfessionalDraft;
		dirtyFields: ProfessionalDirtyFields;
		canOperate: boolean;
		accountLinkPending: boolean;
		shouldSaveProfile: boolean;
		missingItems: string[];
		saving: ProfessionalEditorSaving;
		onSave: SubmitFunction;
	} = $props();
	const fieldStateClass = (dirty: boolean, missing = false) =>
		missing ? 'ux-state-required' : dirty ? 'ux-state-unsaved' : '';
	const sectionStateClass = fieldStateClass;
</script>
		<form method="POST" action="?/update_profile" class={`ux-card ${sectionStateClass(shouldSaveProfile, missingItems.includes('Nombre visible'))}`} use:enhance={onSave}>
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div class="min-w-0 flex-1">
					<h2 class="ux-section-title">Perfil</h2>
					<p class="mt-1 text-sm text-white/55">Datos básicos del profesional.</p>
					{#if missingItems.includes('Nombre visible')}
						<p class="ux-section-meta ux-section-meta-danger">Nombre visible necesario para recibir turnos</p>
					{:else if shouldSaveProfile}
						<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
					{/if}
				</div>
				<button type="submit" disabled={!canOperate || saving !== null || !shouldSaveProfile} class="ux-btn-secondary shrink-0">
					{saving === 'profile' ? 'Guardando...' : 'Guardar sólo perfil'}
				</button>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Nombre
						{#if missingItems.includes('Nombre visible')}
							<span class="ux-inline-status ux-inline-status-danger">Necesario para recibir turnos</span>
						{:else if dirtyFields.name}
							<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>
						{/if}
					</span>
					<input name="name" bind:value={draft.name} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.name, missingItems.includes('Nombre visible'))}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Especialidad (opcional)
						{#if dirtyFields.specialty}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="specialty" bind:value={draft.specialty} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.specialty)}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Teléfono (opcional)
						{#if dirtyFields.phone}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="phone" bind:value={draft.phone} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.phone)}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Correo electrónico (opcional)
						{#if dirtyFields.email}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="email" bind:value={draft.email} type="email" disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.email)}`} />
				</label>
			</div>
			<label class={`mt-5 inline-flex items-center gap-3 rounded-2xl border bg-white/[0.04] px-4 py-3 text-sm font-bold text-white ${fieldStateClass(dirtyFields.profilePublic) || 'border-white/10'}`}>
				<input
					type="checkbox"
						name="is_available"
						value="true"
						bind:checked={draft.isAvailable}
						disabled={!canOperate || accountLinkPending}
						class="accent-[#7c3aed]"
					/>
					{accountLinkPending ? 'Visible cuando vincule su cuenta' : 'Visible en reservas'}
				{#if dirtyFields.profilePublic}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
			</label>
		</form>
