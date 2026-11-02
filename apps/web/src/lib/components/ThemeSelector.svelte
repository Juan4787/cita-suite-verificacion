<script lang="ts">
	import {
		THEME_LABELS,
		THEME_PREFERENCES,
		applyThemePreference,
		type ThemePreference
	} from '$lib/theme/preference';

	// The color mode of this device: Claro (default), Oscuro or Automático (follows the device).
	// `menu`: options inside the account menu (role="menu"), as menuitemradio.
	// `fieldset`: native radio buttons, for the navigation sheet on phones.
	// Both are rows, like the other menu items: «Automático» never has to fit a narrow column.
	let { value = 'light', variant = 'fieldset' }: { value?: ThemePreference; variant?: 'menu' | 'fieldset' } = $props();

	const id = $props.id();
	let chosen = $state<ThemePreference | null>(null);
	const current = $derived(chosen ?? value);

	function choose(preference: ThemePreference) {
		chosen = preference;
		applyThemePreference(preference);
	}

	const rowClass = (option: ThemePreference) =>
		`flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-2 text-left text-sm font-semibold transition ${
			current === option ? 'bg-accent-soft text-accent' : 'text-fg-n200 hover:bg-fill-10 hover:text-fg'
		}`;
</script>

{#snippet check()}
	<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
{/snippet}

{#if variant === 'menu'}
	<div role="group" aria-labelledby={`${id}-label`} class="py-1">
		<p id={`${id}-label`} class="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-n300">Modo de color</p>
		{#each THEME_PREFERENCES as option (option)}
			<button type="button" role="menuitemradio" aria-checked={current === option} class={rowClass(option)} onclick={() => choose(option)}>
				<span>{THEME_LABELS[option]}</span>
				{#if current === option}{@render check()}{/if}
			</button>
		{/each}
	</div>
{:else}
	<fieldset class="min-w-0">
		<legend class="px-1 text-xs font-semibold uppercase tracking-wide text-fg-n300">Modo de color</legend>
		<div class="mt-2 grid gap-1">
			{#each THEME_PREFERENCES as option (option)}
				<label class={`${rowClass(option)} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring`}>
					<input class="sr-only" type="radio" name={`${id}-theme`} value={option} checked={current === option} onchange={() => choose(option)} />
					<span>{THEME_LABELS[option]}</span>
					{#if current === option}{@render check()}{/if}
				</label>
			{/each}
		</div>
	</fieldset>
{/if}
