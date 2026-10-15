<script lang="ts">
	type Rounded = 'sm' | 'md' | 'lg' | 'full';

	let { class: className = '', rounded = 'md', animated = true } = $props<{
		class?: string;
		rounded?: Rounded;
		animated?: boolean;
	}>();

	const roundedClass = $derived.by(() => {
		switch (rounded) {
			case 'sm':
				return 'rounded-md';
			case 'lg':
				return 'rounded-2xl';
			case 'full':
				return 'rounded-full';
			default:
				return 'rounded-xl';
		}
	});
</script>

<div
	aria-hidden="true"
	class={`skeleton-base ${roundedClass} ${animated ? 'skeleton-shimmer' : ''} ${className}`}
></div>
