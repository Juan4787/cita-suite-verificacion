<script lang="ts">
 let { value }: { value: string } = $props();
 const incompatible: number = value;
</script>
<p>{incompatible}</p>
