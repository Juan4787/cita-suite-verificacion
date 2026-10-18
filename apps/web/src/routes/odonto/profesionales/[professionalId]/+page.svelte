<script lang="ts">
 import ProfessionalEditor from '$lib/components/team/ProfessionalEditor.svelte';
 import type { PageProps } from './$types';
 let { data, form }: PageProps = $props();
</script>

{#key `${data.context.business.id}:${data.userId}:${data.professional?.id}`}
 <ProfessionalEditor {data} {form} />
{/key}
