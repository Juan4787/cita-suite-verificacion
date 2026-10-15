<script lang="ts">
    import PublicBookingFlow from '$lib/booking/PublicBookingFlow.svelte';
    let { data, form } = $props();
</script>

<PublicBookingFlow {data} {form} />
