<script lang="ts">
	import type { PageProps } from './$types';

    import PublicBookingFlow from '$lib/booking/PublicBookingFlow.svelte';
    let { data, form }: PageProps = $props();
</script>

<PublicBookingFlow {data} {form} />
