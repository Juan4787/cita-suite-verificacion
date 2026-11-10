<script lang="ts">
  import { styledSelect } from "$lib/ui/styled-controls";
	import { untrack } from 'svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import { normalizeSlug } from '$lib/booking/booking-link';
	import type { BusinessContext, BusinessIndustry } from '$lib/access/contracts';

	let { data, form }: {
		data: {
			context: BusinessContext;
			industries: readonly BusinessIndustry[];
			slugFollowsName: boolean;
			bookingOrigin: string;
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
		medicine: 'Medicina',
		nutrition: 'Nutrición',
		therapy: 'Terapia',
		other: 'Otro'
	};
	const industryLabel = (industry: BusinessIndustry) => industryLabels[industry] ?? industry;

	// The booking link. An empty address means «the name's»: the database gives it, adds a number when
	// another practice uses it or used it, and changes it with the name. The preview shows what saving
	// gives, and the address saved when the name has not changed.
	let nameValue = $state(untrack(() => valueOf('name')));
	let slugValue = $state(untrack(() => (form?.values ? String(form.values.slug ?? '') : data.slugFollowsName ? '' : business.slug)));
	const typedSlug = $derived(normalizeSlug(slugValue));
	const nameSlug = $derived(
		data.slugFollowsName && nameValue.trim() === business.name.trim() ? business.slug : normalizeSlug(nameValue)
	);
	const previewSlug = $derived(typedSlug || nameSlug);
	const bookingHost = $derived(data.bookingOrigin.replace(/^https?:\/\//, ''));
	const timezoneOptions = [
		'America/Argentina/Buenos_Aires',
		'America/Argentina/Cordoba',
		'America/Argentina/Mendoza',
		'America/Argentina/Salta',
		'America/Argentina/Tucuman'
	];
</script>

<section class="ux-page mx-auto w-full max-w-5xl">
	<header>
		<BackLink href="/odonto/configuracion" label="Configuración" class="mb-5" />
		<h1 class="ux-title">Datos del consultorio</h1>
		<p class="ux-subtitle">Nombre, dirección y contacto.</p>
	</header>

	<a class="inline-flex min-h-11 items-center gap-3 font-semibold underline underline-offset-4" href="/odonto/configuracion/negocio/contacto">Contacto en tu web</a>
	<form id="datos-visibles" method="post" action="?/update_business" class="ux-card scroll-mt-28">
		<input type="hidden" name="whatsapp_enabled" value={checkedOf('whatsapp_enabled', business.whatsapp_enabled) ? 'true' : 'false'} />
		<input type="hidden" name="is_active" value={checkedOf('is_active', business.is_active) ? 'true' : 'false'} />
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Datos visibles</h2>
				<p class="mt-1 text-sm text-fg-55">Información básica del consultorio.</p>
			</div>
			<button type="submit" disabled={!canManage} class="ux-btn-primary">Guardar</button>
		</div>

		<div class="mt-6 grid gap-4 md:grid-cols-2">
			<label>
				<span class="ux-label">Nombre</span>
				<input name="name" required bind:value={nameValue} disabled={!canManage} class="ux-input" />
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
					placeholder="Av. Santa Fe 1234, CABA"
					class="ux-input"
				/>
				<span class="mt-1 block text-xs text-copy-subtle">
					Incluí piso y consultorio si corresponde.
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
					placeholder="Pegá el enlace de Maps"
					class="ux-input"
				/>
				<span class="mt-1 block text-xs text-copy-subtle">
					Si lo dejás vacío, generamos el mapa automáticamente desde la dirección.
				</span>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Logo (opcional)</span>
				<input name="logo_url" value={valueOf('logo_url')} disabled={!canManage} class="ux-input" />
				<span class="mt-1 block text-xs text-copy-subtle">
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
		<!-- «Cambiar la dirección del enlace», in Reserva online, opens the page here. -->
		<section
			id="enlace-de-reserva"
			class="mt-6 scroll-mt-28 border-t border-line pt-5"
			aria-labelledby="enlace-de-reserva-titulo"
		>
			<h3 id="enlace-de-reserva-titulo" class="font-semibold">Enlace de reserva</h3>
			<p class="mt-1 text-sm text-fg-70">Es la dirección que compartís con tus pacientes.</p>
			<!-- Chromium does not wrap a web address after a slash: <wbr> lets the address move to the next
			     line whole instead of breaking one of its words at 320 px. The smaller size on phones keeps
			     app.cita-suite.com.ar/reservar/ on one line there. -->
			<p class="mt-3 text-sm sm:text-base">
				<span class="text-fg-70">{bookingHost}/reservar/</span><wbr /><strong class="font-semibold">{previewSlug || 'consultorio'}</strong>
			</p>
			<label class="mt-4 block">
				<span class="ux-label">Dirección personalizada (opcional)</span>
				<input
					name="slug"
					bind:value={slugValue}
					disabled={!canManage}
					placeholder={nameSlug || 'consultorio'}
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
					maxlength="120"
					class="ux-input mt-2"
				/>
			</label>
			<p class="mt-2 text-sm text-copy-subtle">
				{#if slugValue.trim()}
					Elegida por vos: no cambia si cambiás el nombre. Para volver a armarla con el nombre, dejá el campo vacío.
				{:else}
					Vacía, se arma con el nombre del consultorio y cambia con él. Si otro consultorio ya la usa, se le agrega un número.
				{/if}
				Si la dirección cambia, el enlace anterior sigue funcionando.
			</p>
		</section>
	</form>
</section>
