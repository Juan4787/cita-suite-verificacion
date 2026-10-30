<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance, deserialize, applyAction } from '$app/forms';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { emailConfirmationFragment } from '$lib/access/email-confirmation';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let verifying = $state(false);
	let invalidLink = $state(false);
	let localMessage = $state('');
	let sending = $state(false);
	let now = $state(Date.now());
	const confirmed = $derived(!verifying && !invalidLink && !localMessage && form?.kind !== 'invalid' && form?.kind !== 'error' && data.context?.status === 'confirmed');
	const email = $derived(data.context?.email ?? '');
	const nextSend = $derived(form && 'resendAfter' in form ? form.resendAfter ?? 0 : data.context?.resendAfter ?? 0);
	const remaining = $derived(Math.max(0, Math.ceil((nextSend - now) / 1000)));
	const problem = $derived(localMessage || (form?.kind === 'error' ? form.message : ''));
	const notice = $derived(form?.kind === 'notice' ? form.message : '');
	const linkUnavailable = $derived(invalidLink || form?.kind === 'invalid');

	$effect(() => {
		if (remaining <= 0) return;
		const timer = setInterval(() => { now = Date.now(); }, 1000);
		return () => clearInterval(timer);
	});

	const verifyFragment = async () => {
		if (verifying) return;
		const fragment = emailConfirmationFragment(window.location.hash);
		if (fragment.kind === 'none') return;
		invalidLink = false;
		localMessage = '';
		// Remove credentials before any request, including when verification fails.
		replaceState('/confirmar-correo', {});
		if (fragment.kind === 'invalid') { invalidLink = true; return; }
		verifying = true;
		try {
			const response = await fetch('?/confirm', {
				method: 'POST', credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
				body: new URLSearchParams({ access_token: fragment.accessToken, type: fragment.type })
			});
			const result = deserialize(await response.text());
			if (result.type === 'error') throw new Error('CONFIRMATION_UNAVAILABLE');
			await applyAction(result);
		} catch {
			localMessage = 'No pudimos comprobar el enlace en este momento. Podés intentar ingresar o pedir uno nuevo.';
		} finally { verifying = false; }
	};

	afterNavigate(() => {
		void Promise.resolve().then(verifyFragment);
	});
	// A native fragment navigation can reuse this document without a Kit
	// navigation callback. It must invalidate the previous result as well.
	onMount(() => {
		const changed = () => { void verifyFragment(); };
		window.addEventListener('hashchange', changed);
		return () => window.removeEventListener('hashchange', changed);
	});
</script>

<svelte:head>
	<title>{confirmed ? 'Correo confirmado' : 'Confirmá tu correo'} · Cita Suite</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="confirmation-page">
	<section class="confirmation-panel" aria-labelledby="confirmation-title" aria-busy={verifying}>
		<a class="confirmation-brand" href="/login" aria-label="Cita Suite: volver al ingreso">
			<img src="/logo-cita-suite.png" alt="" width="48" height="48" />
			<span>Cita Suite</span>
		</a>
		<div class="confirmation-symbol" class:complete={confirmed} aria-hidden="true">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				{#if confirmed}<path d="m5 12 4 4L19 6" />{:else}<rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" />{/if}
			</svg>
		</div>
		{#if verifying}
			<h1 id="confirmation-title">Comprobando tu correo</h1>
			<p role="status">Estamos validando el enlace. Esto puede tardar unos segundos.</p>
		{:else if confirmed}
			<h1 id="confirmation-title">Correo confirmado</h1>
			<p role="status">Tu dirección <strong class="confirmation-email">{email}</strong> ya está confirmada. Ahora podés ingresar con tu contraseña.</p>
			{#if data.currentEmail && data.currentEmail.toLowerCase() !== email}
				<p class="confirmation-help">Hay otra cuenta abierta en este navegador. Cerrá esa sesión para ingresar con este correo.</p>
				<form method="post" action="/logout"><button class="ux-btn-primary confirmation-primary" type="submit">Cerrar sesión e ingresar</button></form>
			{:else}
				<a class="ux-btn-primary confirmation-primary" href={data.currentEmail ? data.entryRoute : '/login'}>{data.currentEmail ? 'Entrar al consultorio' : 'Ingresar a mi cuenta'}</a>
			{/if}
		{:else}
			<h1 id="confirmation-title">{linkUnavailable ? 'Abrí el enlace más reciente' : 'Revisá tu correo'}</h1>
			{#if linkUnavailable}
				<p role="status">Este enlace ya se usó o venció. Si ya confirmaste tu correo, podés ingresar. Si todavía no lo confirmaste, pedí uno nuevo.</p>
			{:else}
				<p>Para continuar, confirmá tu dirección{#if email}: <strong class="confirmation-email">{email}</strong>{:else}.{/if}</p>
				<p class="confirmation-help">Buscá el correo de Cita Suite y tocá el botón de confirmación. Si no aparece, revisá el correo no deseado.</p>
			{/if}
			{#if problem}<p class="confirmation-feedback error" role="alert">{problem}</p>{/if}
			{#if notice}<p class="confirmation-feedback" role="status">{notice}</p>{/if}
			<form method="post" action="?/resend" class="confirmation-resend" use:enhance={() => {
				sending = true;
				return async ({ update }) => { try { await update({ reset: false }); now = Date.now(); } finally { sending = false; } };
			}}>
				{#if email}<input type="hidden" name="email" value={email} />{:else}
					<label for="confirmation-email">Correo electrónico</label>
					<input class="ux-input" id="confirmation-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="tu@correo.com" />
				{/if}
				<button type="submit" class="confirmation-secondary" disabled={sending || remaining > 0} aria-busy={sending}>
					{sending ? 'Pidiendo el correo…' : remaining > 0 ? `Reenviar en ${remaining} s` : 'Reenviar correo'}
				</button>
			</form>
			<noscript><p class="confirmation-help">Para pedir otro correo después de un minuto, recargá esta página. Si ya abriste el enlace del correo, probá ingresar con tu contraseña.</p></noscript>
			<a class="ux-btn-primary confirmation-primary" href="/login">Ya confirmé, ir a ingresar</a>
			<a class="confirmation-correct" href="/login?registro=1">¿Escribiste mal el correo? Usar otro</a>
		{/if}
	</section>
</main>

<style>
	.confirmation-page { min-height:100svh; display:grid; place-items:center; padding:2rem 1rem; background:var(--bg, #0b1626); color:var(--text, #eaf1ff); }
	.confirmation-panel { width:100%; max-width:30rem; padding:2rem; border:1px solid var(--border); border-radius:1rem; background:var(--surface, #0b1d32); }
	.confirmation-brand { display:inline-flex; align-items:center; gap:.75rem; color:var(--text); font-weight:700; text-decoration:none; }
	.confirmation-brand img { border-radius:.75rem; }
	.confirmation-symbol { margin:2rem 0 1.25rem; width:3.5rem; height:3.5rem; padding:.8rem; border-radius:1rem; color:var(--accent-text); background:var(--accent-soft); }
	.confirmation-symbol.complete { color:var(--success-text); background:var(--success-soft); }
	h1 { margin:0 0 1.25rem; font-size:clamp(1.65rem, 5vw, 2rem); line-height:1.15; font-weight:700; letter-spacing:-.02em; text-wrap:balance; }
	p { margin:0 0 1.25rem; font-size:1rem; line-height:1.6; color:var(--text-muted); }
	.confirmation-email { display:block; overflow-wrap:anywhere; color:var(--text); font-weight:600; }
	.confirmation-help { font-size:.9rem; }
	.confirmation-primary, .confirmation-secondary { display:flex; justify-content:center; align-items:center; width:100%; min-height:3rem; padding:.85rem 1rem; text-align:center; font-size:1rem; line-height:1.35; font-weight:700; text-decoration:none; }
	.confirmation-resend { display:grid; gap:.65rem; margin:1.75rem 0 .8rem; }
	.confirmation-resend label { font-size:.9rem; font-weight:600; }
	.confirmation-secondary { border:1px solid var(--border-strong); border-radius:.85rem; color:var(--accent-text); background:transparent; cursor:pointer; }
	.confirmation-secondary:hover:not(:disabled) { background:var(--accent-soft); }
	.confirmation-secondary:disabled { color:var(--text-muted); cursor:default; }
	.confirmation-correct { display:block; margin-top:1.5rem; font-size:.9rem; line-height:1.5; text-align:center; color:var(--accent-text); text-underline-offset:.2em; }
	.confirmation-feedback { padding:1rem; border-radius:.75rem; background:var(--accent-soft); color:var(--accent-text); font-size:.9rem; }
	.confirmation-feedback.error { background:var(--danger-soft); color:var(--danger-text); }
	a:focus-visible, button:focus-visible { outline:2px solid var(--accent); outline-offset:4px; }
	@media(max-width:390px) { .confirmation-panel { padding:1.5rem; } }
</style>
