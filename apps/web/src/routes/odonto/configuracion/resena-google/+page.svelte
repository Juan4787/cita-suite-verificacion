<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import {
		GOOGLE_REVIEW_ACTION_MAX_LENGTH,
		GOOGLE_REVIEW_BODY_MAX_LENGTH,
		GOOGLE_REVIEW_DEFAULT_ACTION_LABEL,
		GOOGLE_REVIEW_DEFAULT_BODY,
		GOOGLE_REVIEW_DEFAULT_TITLE,
		GOOGLE_REVIEW_TITLE_MAX_LENGTH
	} from '$lib/google-reviews';

	type SettingsValues = {
		enabled: boolean;
		reviewUrl: string;
		title: string;
		body: string;
		actionLabel: string;
	};

	let { data, form } = $props<{
		data: {
			demo: boolean;
			context: { canManage: boolean; business: { name: string } };
			settings: SettingsValues;
		};
		form?: { success?: boolean; message?: string; values?: SettingsValues };
	}>();

	// svelte-ignore state_referenced_locally
	const initial = form?.values ?? data.settings;
	let enabled = $state(Boolean(initial.enabled));
	let reviewUrl = $state(initial.reviewUrl);
	let title = $state(initial.title);
	let body = $state(initial.body);
	let actionLabel = $state(initial.actionLabel);
	const canManage = $derived(Boolean(data.context.canManage) && !data.demo);

	const restoreDefaultMessage = () => {
		title = GOOGLE_REVIEW_DEFAULT_TITLE;
		body = GOOGLE_REVIEW_DEFAULT_BODY;
		actionLabel = GOOGLE_REVIEW_DEFAULT_ACTION_LABEL;
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<p class="ux-badge">Configuración</p>
		<h1 class="ux-title mt-4">Reseña de Google</h1>
		<p class="ux-subtitle">Invitá a tus pacientes a compartir su experiencia.</p>
	</div>

	<form method="post" class="ux-card">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div class="max-w-2xl">
				<h2 class="ux-section-title">Solicitud automática</h2>
				<p class="mt-2 text-sm text-white/55">
					Se envía 2 horas después de que termina el turno y como máximo una vez cada 180 días por paciente.
				</p>
			</div>
			<button type="submit" disabled={!canManage} class="ux-btn-primary">Guardar</button>
		</div>

		<label class="ux-choice mt-6 flex items-center gap-3 px-4 py-3">
			<input
				type="checkbox"
				name="enabled"
				value="true"
				bind:checked={enabled}
				disabled={!canManage}
				class="accent-[#7c3aed]"
			/>
			<span class="font-bold text-white">Solicitar reseñas automáticamente</span>
		</label>

		<div class="mt-6 grid gap-5">
			<label>
				<span class="ux-label">Enlace directo para dejar una reseña</span>
				<input
					name="review_url"
					type="url"
					bind:value={reviewUrl}
					required={enabled}
					disabled={!canManage}
					maxlength="2048"
					placeholder="https://g.page/r/.../review"
					class="ux-input"
				/>
				<span class="mt-1 block text-xs text-white/45">
					Copialo desde tu Perfil de Empresa de Google, en “Leer reseñas” → “Conseguir más reseñas”.
				</span>
			</label>

			<div class="border-t border-white/10 pt-5">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h2 class="ux-section-title">Mensaje</h2>
						<p class="mt-1 text-sm text-white/55">Podés adaptar el texto al tono de tu consultorio.</p>
					</div>
					<button
						type="button"
						disabled={!canManage}
						class="ux-btn-secondary"
						onclick={restoreDefaultMessage}>Restablecer frase original</button
					>
				</div>

				<div class="mt-5 grid gap-4">
					<label>
						<span class="ux-label">Título</span>
						<textarea
							name="notification_title"
							rows="2"
							bind:value={title}
							required
							disabled={!canManage}
							maxlength={GOOGLE_REVIEW_TITLE_MAX_LENGTH}
							class="ux-textarea"></textarea
						>
					</label>
					<label>
						<span class="ux-label">Texto</span>
						<textarea
							name="notification_body"
							rows="3"
							bind:value={body}
							required
							disabled={!canManage}
							maxlength={GOOGLE_REVIEW_BODY_MAX_LENGTH}
							class="ux-textarea"></textarea
						>
					</label>
					<label>
						<span class="ux-label">Texto del botón</span>
						<input
							name="notification_action_label"
							bind:value={actionLabel}
							required
							disabled={!canManage}
							maxlength={GOOGLE_REVIEW_ACTION_MAX_LENGTH}
							class="ux-input"
						/>
					</label>
				</div>
			</div>
		</div>

		<div class="ux-soft-card mt-6 p-5" aria-label="Vista previa de la notificación">
			<p class="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Vista previa</p>
			<p class="mt-3 font-bold text-white">{title || 'Título de la notificación'}</p>
			<p class="mt-2 whitespace-pre-line text-sm leading-6 text-white/65">
				{body || 'Texto de la notificación'}
			</p>
			<span class="mt-4 inline-flex rounded-xl bg-violet-500/15 px-3 py-2 text-sm font-bold text-violet-200">
				{actionLabel || 'Compartir mi opinión'}
			</span>
		</div>

		{#if form?.message}
			<p class="ux-alert mt-5" role="alert">{form.message}</p>
		{/if}
		{#if form?.success}
			<p class="ux-alert ux-alert-success mt-5" role="status">Configuración guardada.</p>
		{/if}
		{#if !canManage}
			<p class="ux-empty mt-5">Tu permiso actual no permite editar esta configuración.</p>
		{/if}
	</form>
</section>
