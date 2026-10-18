<script lang="ts">
	import type { PageProps } from './$types';

	import { enhance } from '$app/forms';
	import BackLink from '$lib/components/BackLink.svelte';
	import { storageMegabytesInput } from '$lib/clinical-storage-units';
	import { guardUnsavedChanges } from '$lib/ui/confirm-action';
	import type { SubmitFunction } from '@sveltejs/kit';
	let { data, form }: PageProps = $props();
	let pending = $state<string | null>(null);
	type Draft = { megabytes: string; enabled: boolean; revision: number; originalAmount: string; originalEnabled: boolean };
	let drafts = $state<Record<string, Draft>>({});
	const dirty = $derived(Object.values(drafts).some(draft => draft.megabytes !== draft.originalAmount || draft.enabled !== draft.originalEnabled));
	guardUnsavedChanges(() => dirty, 'Tenés límites sin guardar.', () => { drafts = {}; });
	function edit(target: string, bytes: number, allowed: boolean, revision: number, changes: Partial<Pick<Draft, 'megabytes' | 'enabled'>>) {
		const originalAmount = storageMegabytesInput(bytes);
		const current = drafts[target] ?? { megabytes: originalAmount, enabled: allowed, revision, originalAmount, originalEnabled: allowed };
		const next = { ...current, ...changes };
		if (!drafts[target] && next.megabytes === originalAmount && next.enabled === allowed) return;
		drafts[target] = next;
	}
	const mb = (value: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value / 1_000_000);
	const amount = (target: string, bytes: number) => drafts[target]?.megabytes ?? (form?.target === target && form.values ? form.values.megabytes : storageMegabytesInput(bytes));
	const enabled = (target: string, value: boolean) => drafts[target]?.enabled ?? (form?.target === target && form.values ? form.values.enabled : value);
	const submit = (target: string): SubmitFunction => () => {
		pending = target;
		return async ({ result, update }) => {
			try {
				await update({ reset: false, invalidateAll: result.type === 'success' });
				if (result.type === 'success') delete drafts[target];
			}
			finally { pending = null; }
		};
	};
</script>

<svelte:head><title>Espacio para documentos · Cita Suite</title></svelte:head>
<svelte:window onbeforeunload={event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }} />
<section class="ux-page mx-auto max-w-4xl">
	<header>
		<BackLink href="/odonto/maestro" label="Panel maestro" class="mb-5" />
		<h1 class="ux-title">Espacio para documentos</h1>
		<p class="mt-3 text-[var(--text-muted)]">{mb(data.budget.used_bytes)} MB utilizados y {mb(data.budget.reserved_bytes)} MB en cargas pendientes, de {mb(data.budget.max_bytes)} MB compartidos.</p>
	</header>
	<form method="POST" action="?/defaults" class="ux-card" use:enhance={submit('defaults')} aria-busy={pending === 'defaults'}>
		<h2 class="ux-section-title">Configuración general</h2>
		<p class="mt-2 text-sm text-[var(--text-muted)]">El valor inicial se aplica a nuevos consultorios. Cada límite usa el espacio compartido.</p>
		<input type="hidden" name="policy_revision" value={drafts.defaults?.revision ?? data.budget.policy_revision} />
		<label class="mt-5 grid gap-2 max-w-sm">
			<span class="font-semibold">Límite inicial por consultorio (MB)</span>
			<input class="ux-input" name="megabytes" inputmode="decimal" required maxlength="30" disabled={pending !== null}
				aria-invalid={form?.target === 'defaults' && form.field === 'megabytes' ? true : undefined}
				aria-describedby={form?.target === 'defaults' && form.message ? 'storage-defaults-feedback' : undefined}
				bind:value={() => amount('defaults', data.budget.default_business_max_bytes), (value: string) => edit('defaults', data.budget.default_business_max_bytes, data.budget.uploads_enabled, data.budget.policy_revision, { megabytes: value })} />
		</label>
		{#if form?.target === 'defaults' && form.message}
			<p id="storage-defaults-feedback" class={form.saved ? 'ux-alert ux-alert-success mt-4' : 'ux-alert mt-4'} role={form.saved ? 'status' : 'alert'}>{form.message}</p>
		{/if}
		<label class="mt-4 flex min-h-11 items-center gap-3">
			<input type="checkbox" name="uploads_enabled" value="true" disabled={pending !== null}
				bind:checked={() => enabled('defaults', data.budget.uploads_enabled), (checked: boolean) => edit('defaults', data.budget.default_business_max_bytes, data.budget.uploads_enabled, data.budget.policy_revision, { enabled: checked })} />
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
				<input type="hidden" name="policy_revision" value={drafts[account.business_id]?.revision ?? account.policy_revision} />
				<div class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
					<label class="grid gap-2 min-w-0">
						<span class="font-semibold">Límite de {account.business.name} (MB)</span>
						<input class="ux-input" name="megabytes" inputmode="decimal" required maxlength="30" disabled={pending !== null}
							aria-invalid={form?.target === account.business_id && form.field === 'megabytes' ? true : undefined}
							aria-describedby={form?.target === account.business_id && form.message ? `storage-${account.business_id}-feedback` : undefined}
							bind:value={() => amount(account.business_id, account.max_bytes), (value: string) => edit(account.business_id, account.max_bytes, account.uploads_enabled, account.policy_revision, { megabytes: value })} />
					</label>
					<button class="ux-btn-secondary" disabled={pending !== null}>{pending === account.business_id ? 'Guardando…' : 'Guardar límite'}</button>
				</div>
				{#if form?.target === account.business_id && form.message}
					<p id={`storage-${account.business_id}-feedback`} class={form.saved ? 'ux-alert ux-alert-success mt-4' : 'ux-alert mt-4'} role={form.saved ? 'status' : 'alert'}>{form.message}</p>
				{/if}
				<label class="mt-3 flex min-h-11 items-center gap-3">
					<input type="checkbox" name="uploads_enabled" value="true" disabled={pending !== null}
						bind:checked={() => enabled(account.business_id, account.uploads_enabled), (checked: boolean) => edit(account.business_id, account.max_bytes, account.uploads_enabled, account.policy_revision, { enabled: checked })} />
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
