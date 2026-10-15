import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	envDir: '../..',
	plugins: [sveltekit()],
	resolve: {
		conditions: ['browser']
	},
	test: {
		maxWorkers: 1,
		fileParallelism: false,
		passWithNoTests: false,
		environment: 'jsdom',
		include: ['src/**/*.client.test.ts'],
		exclude: ['node_modules/**', '.svelte-kit/**', 'build/**']
	}
});
