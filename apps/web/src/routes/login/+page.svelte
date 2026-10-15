<script lang="ts">
	let { data, form } = $props();
	type AuthMode = 'login' | 'register';
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);
	let mode = $state<AuthMode>('login');
	const formEmail = $derived(form?.email ?? '');
	const formMode = $derived(form?.mode as AuthMode | undefined);
	const serverMessage = $derived(form?.message ?? data?.message ?? '');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let acceptedTerms = $state(false);
	let googleSubmitting = $state(false);
	let localMessage = $state('');
	const message = $derived(localMessage || serverMessage);

	const setMode = (nextMode: AuthMode) => {
		mode = nextMode;
		localMessage = '';
	};

	const clearLocalMessage = () => {
		if (localMessage) localMessage = '';
	};

	const handleCredentialsSubmit = (event: SubmitEvent) => {
		localMessage = '';
		if (mode !== 'register') return;
		if (password !== confirmPassword) {
			event.preventDefault();
			localMessage = 'Las contraseñas no coinciden.';
		}
	};

	$effect(() => {
		if (formEmail) {
			email = formEmail;
		}
	});

	$effect(() => {
		if (formMode === 'login' || formMode === 'register') {
			mode = formMode;
		}
		if (form?.acceptedTerms === true) {
			acceptedTerms = true;
		}
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0b1626] via-[#0f1f36] to-[#0a1222] px-4 py-10">
	<div class="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur sm:p-8">
		<div class="mb-7 flex flex-col items-center text-center">
			<picture>
				<img src="/logo-cita-suite.png" alt="Cita Suite" class="h-16 w-16 rounded-2xl shadow-lg" width="64" height="64" decoding="async" />
			</picture>
			<h1 class="mt-4 text-2xl font-bold text-white">Cita Suite</h1>
			<p class="mt-1 text-sm text-white/55">
				{mode === 'register' ? 'Creá tu cuenta para empezar.' : 'Ingresá a tu consultorio.'}
			</p>
		</div>

		<div class="mb-6 flex justify-center">
			<div class="ux-pill-nav text-xs font-bold text-white/65">
				<button
					type="button"
					class={`rounded-full px-5 py-2 transition ${mode === 'login' ? 'bg-[#7c3aed] text-white' : 'hover:text-white'}`}
					onclick={() => setMode('login')}
				>
					Ingresar
				</button>
				<button
					type="button"
					class={`rounded-full px-5 py-2 transition ${mode === 'register' ? 'bg-[#7c3aed] text-white' : 'hover:text-white'}`}
					onclick={() => setMode('register')}
				>
					Crear cuenta
				</button>
			</div>
		</div>

		<form method="post" action={mode === 'register' ? '?/register' : '?/login'} class="space-y-5" onsubmit={handleCredentialsSubmit}>
			<label class="block">
				<span class="ux-label">Correo electrónico</span>
				<input
					id="email"
					name="email"
					type="email"
					class="ux-input"
					placeholder="tu@correo.com"
					required
					bind:value={email}
					oninput={clearLocalMessage}
					autocomplete="email"
				/>
			</label>

			<label class="block">
				<span class="ux-label">Contraseña</span>
				<div class="relative">
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						class="ux-input pr-16"
						placeholder={mode === 'register' ? 'Creá una contraseña segura' : 'Ingresá tu contraseña'}
						required
						bind:value={password}
						oninput={clearLocalMessage}
						autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
					/>
					<button
						type="button"
						class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10"
						onclick={() => (showPassword = !showPassword)}
					>
						{showPassword ? 'Ocultar' : 'Ver'}
					</button>
				</div>
			</label>

			{#if mode === 'register'}
				<label class="block">
					<span class="ux-label">Confirmar contraseña</span>
					<div class="relative">
						<input
							id="confirm_password"
							name="confirm_password"
							type={showConfirmPassword ? 'text' : 'password'}
							class="ux-input pr-16"
							placeholder="Repetí la misma contraseña"
							required
							bind:value={confirmPassword}
							oninput={clearLocalMessage}
							autocomplete="new-password"
						/>
						<button
							type="button"
							class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10"
							onclick={() => (showConfirmPassword = !showConfirmPassword)}
						>
							{showConfirmPassword ? 'Ocultar' : 'Ver'}
						</button>
					</div>
				</label>
			{/if}

			{#if message}
				<p class="ux-alert flex items-center gap-2">
					<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
					</svg>
					{message}
				</p>
			{/if}

			{#if mode === 'register'}
				<label class="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left text-sm leading-5 text-white/70">
					<input
						name="accepted_terms"
						type="checkbox"
						value="true"
						required
						bind:checked={acceptedTerms}
						class="mt-1 h-4 w-4 rounded border-white/20 bg-white/10 text-[#7c3aed] focus:ring-[#8b5cf6]"
					/>
					<span>
						Leí y acepto los
						<a href="/terminos" class="font-bold text-[#c4b5fd] hover:underline" target="_blank" rel="noreferrer">Términos y condiciones</a>
						y la
						<a href="/privacidad" class="font-bold text-[#c4b5fd] hover:underline" target="_blank" rel="noreferrer">Política de privacidad</a>.
					</span>
				</label>
			{/if}

			<button type="submit" class="ux-btn-primary w-full text-base">
				{mode === 'register' ? 'Crear cuenta' : 'Ingresar'}
			</button>

			{#if mode === 'login'}
				<div class="text-center text-sm text-white/55">
					<a href="/reset" class="font-semibold text-[#c4b5fd] hover:underline">¿Olvidaste tu contraseña?</a>
				</div>
			{:else}
				<div class="text-center text-sm text-white/55">
					<button type="button" class="font-semibold text-[#c4b5fd] hover:underline" onclick={() => setMode('login')}>
						¿Ya tenés cuenta? Ingresá
					</button>
				</div>
			{/if}
		</form>

		<div class="my-6 flex items-center gap-3 text-xs font-bold uppercase tracking-wide text-white/35">
			<div class="h-px flex-1 bg-white/10"></div>
			<span>o</span>
			<div class="h-px flex-1 bg-white/10"></div>
		</div>

		<form method="GET" action="/auth/google" class="space-y-3" onsubmit={() => (googleSubmitting = true)}>
			<input type="hidden" name="mode" value={mode} />
			<input type="hidden" name="accepted_terms" value={acceptedTerms ? 'true' : 'false'} />
			<button
				type="submit"
				class="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white px-4 py-3 text-sm font-black text-neutral-950 shadow-lg transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={googleSubmitting || (mode === 'register' && !acceptedTerms)}
				aria-busy={googleSubmitting}
			>
				<img src="/logo-google.webp" alt="" class="h-5 w-5 object-contain" width="20" height="20" decoding="async" />
				{#if googleSubmitting}
					Redirigiendo a Google…
				{:else}
					{mode === 'register' ? 'Crear cuenta con Google' : 'Ingresar con Google'}
				{/if}
			</button>
			<p class="text-center text-xs font-semibold text-white/45">
				{mode === 'register'
					? acceptedTerms
						? 'Al continuar con Google confirmás que aceptaste los términos y condiciones.'
						: 'Para crear cuenta con Google, aceptá primero los términos y condiciones.'
					: 'Al continuar con Google aceptás los términos y condiciones vigentes.'}
			</p>
		</form>
	</div>
</div>
