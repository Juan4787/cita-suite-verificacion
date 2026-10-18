import { onMount } from 'svelte';

/** Per-component lifecycle; never shared across SSR requests or patient sessions. */
export function createClientReadiness() {
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});
	return {
		get ready() {
			return ready;
		}
	};
}
