<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { createClient, type SupabaseClient } from '@supabase/supabase-js';
	import { env } from '$env/dynamic/public';
	import BackLink from '$lib/components/BackLink.svelte';

	let status = $state<'loading' | 'ready' | 'success' | 'error'>('loading');
	let message = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let showPassword = $state(false);
	let supabase: SupabaseClient | null = null;

	const initSessionFromHash = async () => {
		const supabaseUrl = env.PUBLIC_ODONTO_SUPABASE_URL?.trim();
		const supabaseKey = env.PUBLIC_ODONTO_SUPABASE_ANON_KEY?.trim();

		if (!supabaseUrl || !supabaseKey) {
			status = 'error';
			message = 'La conexión para recuperar la contraseña no está configurada.';
			return;
		}
		try {
			new URL(supabaseUrl);
		} catch {
			status = 'error';
			message = 'La conexión para recuperar la contraseña no es válida.';
			return;
		}

		const hash = window.location.hash.replace(/^#/, '');
		const params = new URLSearchParams(hash);
		const accessToken = params.get('access_token');
		const refreshToken = params.get('refresh_token');
		const type = params.get('type');

		if (!accessToken || !refreshToken) {
			status = 'error';
			message = 'El enlace es inválido o expiró. Volvé a solicitarlo.';
			return;
		}
		if (type && type !== 'recovery') {
			status = 'error';
			message = 'El enlace de recuperación no es válido.';
			return;
		}

		supabase = createClient(supabaseUrl, supabaseKey, {
			auth: {
				persistSession: false,
				autoRefreshToken: false
			}
		});

		const { error } = await supabase.auth.setSession({
			access_token: accessToken,
			refresh_token: refreshToken
		});

		if (error) {
			status = 'error';
			message = 'No pudimos validar el enlace. Pedí uno nuevo.';
			return;
		}

		window.history.replaceState({}, '', window.location.pathname);
		status = 'ready';
	};

	const handleSubmit = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!supabase) {
			status = 'error';
			message = 'No pudimos iniciar la sesión de recuperación.';
			return;
		}
		if (!password || password.length < 6) {
			message = 'La contraseña debe tener al menos 6 caracteres.';
			return;
		}
		if (password !== confirmPassword) {
			message = 'Las contraseñas no coinciden.';
			return;
		}

		const { error } = await supabase.auth.updateUser({ password });
		if (error) {
			const msg = error.message?.toLowerCase() ?? '';
			if (
				msg.includes('same password') ||
				msg.includes('same as the old password') ||
				msg.includes('new password should be different') ||
				msg.includes('password should be different')
			) {
				await supabase.auth.signOut();
				status = 'success';
				return;
			}
			message = 'No pudimos actualizar la contraseña. Intentá de nuevo.';
			return;
		}

		await supabase.auth.signOut();
		status = 'success';
	};

	onMount(async () => {
		if (!browser) return;
		await initSessionFromHash();
	});
</script>

<div class="min-h-screen bg-gradient-to-br from-[#0b1626] via-[#0f1f36] to-[#0a1222] flex items-center justify-center px-4 py-10">
	<div class="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur dark:border-[#1f3554] dark:bg-[#0f1f36]/90">
		<div class="mb-6 text-center space-y-3">
			<h1 class="text-3xl font-semibold text-white">Restablecer contraseña</h1>
			<p class="text-sm text-neutral-200">Elegí una nueva contraseña para tu cuenta.</p>
		</div>

		{#if status === 'loading'}
			<p class="rounded-xl bg-white/10 px-4 py-3 text-sm text-neutral-200">Validando enlace...</p>
		{:else if status === 'error'}
			<p class="rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200">{message}</p>
			<div class="mt-4 flex justify-center">
				<BackLink href="/reset" label="Volver a recuperar contraseña" />
			</div>
		{:else if status === 'success'}
			<div class="space-y-4">
				<p class="rounded-xl bg-green-500/15 px-4 py-3 text-sm font-semibold text-green-100">
					Contraseña actualizada correctamente.
				</p>
				<a
					href="/login"
					class="inline-flex w-full items-center justify-center rounded-2xl bg-[#7c3aed] px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
				>
					Volver a ingresar
				</a>
			</div>
		{:else}
			<form class="space-y-6" onsubmit={handleSubmit}>
				<div class="space-y-3">
					<label class="text-sm font-medium text-white" for="password">Nueva contraseña</label>
					<div class="relative">
						<input
							id="password"
							type={showPassword ? 'text' : 'password'}
							class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 pr-16 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
							placeholder="Mínimo 6 caracteres"
							bind:value={password}
							autocomplete="new-password"
							required
						/>
						<button
							type="button"
							class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-semibold text-neutral-100 transition hover:bg-white/10"
							onclick={() => (showPassword = !showPassword)}
						>
							{showPassword ? 'Ocultar' : 'Ver'}
						</button>
					</div>
				</div>

				<div class="space-y-3">
					<label class="text-sm font-medium text-white" for="confirm">Confirmar contraseña</label>
					<input
						id="confirm"
						type={showPassword ? 'text' : 'password'}
						class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
						placeholder="Repetí tu contraseña"
						bind:value={confirmPassword}
						autocomplete="new-password"
						required
					/>
				</div>

				{#if message}
					<p class="rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200">{message}</p>
				{/if}

				<button
					type="submit"
					class="flex w-full items-center justify-center rounded-2xl bg-[#7c3aed] px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
				>
					Guardar nueva contraseña
				</button>
			</form>
		{/if}
	</div>
</div>
