import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	envDir: '../..',
	plugins: [sveltekit()],
	test: {
		maxWorkers: 1,
		fileParallelism: false,
		passWithNoTests: false,
		exclude: ['e2e/**', 'node_modules/**', '.svelte-kit/**', 'build/**', '**/*.client.test.ts', '**/*.office.test.ts']
	}
});
