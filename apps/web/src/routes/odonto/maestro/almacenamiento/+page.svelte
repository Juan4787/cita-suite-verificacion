<script lang="ts">
	import { enhance } from '$app/forms';
	import BackLink from '$lib/components/BackLink.svelte';
	import { storageMegabytesInput } from '$lib/clinical-storage-units';
	import type { SubmitFunction } from '@sveltejs/kit';
	let { data, form } = $props();
	let pending = $state<string | null>(null);
	const mb = (value: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value / 1_000_000);
	const amount = (target: string, bytes: number) => form?.target === target && form.values ? form.values.megabytes : storageMegabytesInput(bytes);
	const enabled = (target: string, value: boolean) => form?.target === target && form.values ? form.values.enabled : value;
	const submit = (target: string): SubmitFunction => () => {
		pending = target;
		return async ({ result, update }) => {
			try { await update({ reset: false, invalidateAll: result.type === 'success' }); }
			finally { pending = null; }
		};
	};
</script>

<svelte:head><title>Espacio para documentos · Cita Suite</title></svelte:head>
<section class="ux-page mx-auto max-w-4xl">
	<header>
		<BackLink href="/odonto/maestro" label="Panel maestro" class="mb-5" />
		<h1 class="ux-title">Espacio para documentos</h1>
		<p class="mt-3 text-[var(--text-muted)]">{mb(data.budget.used_bytes)} MB utilizados y {mb(data.budget.reserved_bytes)} MB en cargas pendientes, de {mb(data.budget.max_bytes)} MB compartidos.</p>
	</header>
	{#if form?.message}
		<p class={form.saved ? 'ux-alert ux-alert-success' : 'ux-alert'} role={form.saved ? 'status' : 'alert'}>{form.message}</p>
	{/if}
	<form method="POST" action="?/defaults" class="ux-card" use:enhance={submit('defaults')} aria-busy={pending === 'defaults'}>
		<h2 class="ux-section-title">Configuración general</h2>
		<p class="mt-2 text-sm text-[var(--text-muted)]">El valor inicial se aplica a nuevos consultorios. Cada límite usa el espacio compartido.</p>
		<input type="hidden" name="policy_revision" value={data.budget.policy_revision} />
		<label class="mt-5 grid gap-2 max-w-sm">
			<span class="font-semibold">Límite inicial por consultorio (MB)</span>
			<input class="ux-input" name="megabytes" inputmode="decimal" required maxlength="30" value={amount('defaults', data.budget.default_business_max_bytes)} disabled={pending !== null} />
		</label>
		<label class="mt-4 flex min-h-11 items-center gap-3">
			<input type="checkbox" name="uploads_enabled" value="true" checked={enabled('defaults', data.budget.uploads_enabled)} disabled={pending !== null} />
			<span>Permitir nuevas cargas en Cita Suite</span>
		</label>
		<p class="mt-1 text-sm text-[var(--text-muted)]">Pausar conserva los documentos guardados.</p>
		<button class="ux-btn-primary mt-5" disabled={pending !== null}>{pending === 'defaults' ? 'Guardando…' : 'Guardar configuración general'}</button>
	</form>
	<section class="ux-card" aria-labelledby="clinics-title">
		<h2 id="clinics-title" class="ux-section-title">Límites por consultorio</h2>
		{#if !data.accounts.length}<p class="ux-empty mt-4">No hay consultorios en esta página.</p>{/if}
		{#each data.accounts as account (account.business_id)}
			<form method="POST" action="?/business" class="border-t border-[var(--border)] mt-6 pt-6" use:enhance={submit(account.business_id)} aria-busy={pending === account.business_id}>
				<h3 class="font-bold break-words">{account.business.name}</h3>
				<p class="mt-2 text-sm text-[var(--text-muted)]">{mb(account.used_bytes)} MB utilizados · {mb(account.reserved_bytes)} MB en cargas pendientes</p>
				<input type="hidden" name="business_id" value={account.business_id} />
				<input type="hidden" name="policy_revision" value={account.policy_revision} />
				<div class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
					<label class="grid gap-2 min-w-0">
						<span class="font-semibold">Límite de {account.business.name} (MB)</span>
						<input class="ux-input" name="megabytes" inputmode="decimal" required maxlength="30" value={amount(account.business_id, account.max_bytes)} disabled={pending !== null} />
					</label>
					<button class="ux-btn-secondary" disabled={pending !== null}>{pending === account.business_id ? 'Guardando…' : 'Guardar límite'}</button>
				</div>
				<label class="mt-3 flex min-h-11 items-center gap-3">
					<input type="checkbox" name="uploads_enabled" value="true" checked={enabled(account.business_id, account.uploads_enabled)} disabled={pending !== null} />
					<span>Permitir nuevas cargas en este consultorio</span>
				</label>
			</form>
		{/each}
		{#if data.next || data.after}
			<nav class="mt-6 flex flex-wrap gap-3" aria-label="Páginas de consultorios">
				{#if data.after}<a class="ux-btn-secondary" href="/odonto/maestro/almacenamiento">Primera página</a>{/if}
				{#if data.next}<a class="ux-btn-secondary" href={'?after=' + encodeURIComponent(data.next)}>Más consultorios</a>{/if}
			</nav>
		{/if}
	</section>
</section>
