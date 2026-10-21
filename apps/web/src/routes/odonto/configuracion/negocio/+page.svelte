<script lang="ts">
  import { styledSelect } from "$lib/ui/styled-controls";
	import BackLink from '$lib/components/BackLink.svelte';
	import type { BusinessContext, BusinessIndustry } from '$lib/access/contracts';

	let { data, form }: {
		data: {
			context: BusinessContext;
			industries: readonly BusinessIndustry[];
			demo: boolean;
		};
		form?: { success?: boolean; message?: string; values?: Record<string, unknown> };
	} = $props();

	const business = $derived(data.context.business);
	const canManage = $derived(Boolean(data.context.canManage) && !data.demo);
	type FormField = 'name' | 'industry' | 'timezone' | 'phone' | 'email' | 'address' | 'address_instructions' | 'maps_url' | 'logo_url' | 'slug';
	const values = $derived((form?.values ?? {}) as Record<string, unknown>);
	const valueOf = (key: FormField, fallback = '') => String(values[key] ?? business[key] ?? fallback);
	const checkedOf = (key: string, fallback: boolean) =>
		values[key] != null ? values[key] === 'true' : Boolean(fallback);
	const industryLabels: Record<BusinessIndustry, string> = {
		odontology: 'Odontología',
		aesthetics: 'Estética',
		kinesiology: 'Kinesiología',
		nutrition: 'Nutrición',
		therapy: 'Terapia',
		other: 'Otro'
	};
	const industryLabel = (industry: BusinessIndustry) => industryLabels[industry] ?? industry;
	const timezoneOptions = [
		'America/Argentina/Buenos_Aires',
		'America/Argentina/Cordoba',
		'America/Argentina/Mendoza',
		'America/Argentina/Salta',
		'America/Argentina/Tucuman'
	];
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="ux-title">Datos del consultorio</h1>
				<p class="ux-subtitle">Nombre, dirección y contacto.</p>
			</div>

		</div>
	</div>

	<a class="inline-flex min-h-11 items-center gap-3 font-semibold underline underline-offset-4" href="/odonto/configuracion/negocio/contacto">Contacto en tu web</a>
	<form id="datos-visibles" method="post" action="?/update_business" class="ux-card scroll-mt-28">
		<input type="hidden" name="whatsapp_enabled" value={checkedOf('whatsapp_enabled', business.whatsapp_enabled) ? 'true' : 'false'} />
		<input type="hidden" name="is_active" value={checkedOf('is_active', business.is_active) ? 'true' : 'false'} />
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Datos visibles</h2>
				<p class="mt-1 text-sm text-white/55">Información básica del consultorio.</p>
			</div>
			<button type="submit" disabled={!canManage} class="ux-btn-primary">Guardar</button>
		</div>

		<div class="mt-6 grid gap-4 md:grid-cols-2">
			<label>
				<span class="ux-label">Nombre</span>
				<input name="name" required value={valueOf('name')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Rubro</span>
				<select use:styledSelect name="industry" disabled={!canManage} class="ux-select">
					{#each data.industries as industry}
						<option value={industry} selected={valueOf('industry') === industry}>{industryLabel(industry)}</option>
					{/each}
				</select>
			</label>
			<label>
				<span class="ux-label">Zona horaria</span>
				<select use:styledSelect name="timezone" disabled={!canManage} class="ux-select">
					{#if !timezoneOptions.includes(valueOf('timezone', 'America/Argentina/Cordoba'))}
						<option value={valueOf('timezone', 'America/Argentina/Cordoba')} selected>
							{valueOf('timezone', 'America/Argentina/Cordoba')}
						</option>
					{/if}
					{#each timezoneOptions as timezone}
						<option value={timezone} selected={valueOf('timezone', 'America/Argentina/Cordoba') === timezone}>{timezone}</option>
					{/each}
				</select>
			</label>
			<label>
				<span class="ux-label">Teléfono de contacto (opcional)</span>
				<input name="phone" value={valueOf('phone')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Correo de contacto (opcional)</span>
				<input name="email" type="email" value={valueOf('email')} disabled={!canManage} class="ux-input" />
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Dirección visible para pacientes</span>
				<input
					name="address"
					value={valueOf('address')}
					disabled={!canManage}
					placeholder="Av. Santa Fe 1234, Piso 3, Consultorio B, CABA"
					class="ux-input"
				/>
				<span class="mt-1 block text-xs text-white/45">
					Aparece en la confirmación del turno, el evento de calendario y el botón "Cómo llegar".
					Obligatoria para la reserva online.
				</span>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Indicaciones para llegar (opcional)</span>
				<textarea
					name="address_instructions"
					rows="2"
					disabled={!canManage}
					placeholder="Tocar timbre 4B. Entrada por galería. Presentarse 10 minutos antes."
					class="ux-textarea">{valueOf('address_instructions')}</textarea>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Link de Google Maps (opcional)</span>
				<input
					name="maps_url"
					value={valueOf('maps_url')}
					disabled={!canManage}
					placeholder="https://maps.app.goo.gl/..."
					class="ux-input"
				/>
				<span class="mt-1 block text-xs text-white/45">
					Si lo dejás vacío, generamos el mapa automáticamente desde la dirección.
				</span>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Logo (opcional)</span>
				<input name="logo_url" value={valueOf('logo_url')} disabled={!canManage} class="ux-input" />
				<span class="mt-1 block text-xs text-white/45">
					Usá una URL HTTPS del dominio público configurado o del proyecto de datos del consultorio para que el logo se vea también en la reserva online.
				</span>
			</label>

		</div>

		{#if form?.message}
			<p class="ux-alert mt-5">{form.message}</p>
		{/if}
		{#if form?.success}
			<p class="ux-alert ux-alert-success mt-5">Consultorio guardado.</p>
		{/if}
		{#if !canManage}
			<p class="ux-empty mt-5">Tu permiso actual no permite editar esta configuración.</p>
		{/if}
		<details class="mt-6 border-t border-white/10 pt-4">
			<summary class="min-h-11 cursor-pointer font-semibold">Dirección personalizada</summary>
			<label class="mt-3 block">
				<span class="ux-label">Última parte de la dirección</span>
				<input name="slug" required value={valueOf('slug')} disabled={!canManage} class="ux-input mt-2" />
			</label>
			<p class="mt-2 text-sm text-white/70">/reservar/{valueOf('slug')}</p>
		</details>
	</form>
</section>
