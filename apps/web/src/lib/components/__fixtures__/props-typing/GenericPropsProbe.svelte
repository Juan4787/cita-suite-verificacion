<script lang="ts">
 let { value } = $props<{ value: string }>();
 const incompatible: number = value;
</script>
<p>{incompatible}</p>
