// Globals defined by the isolated host page of scripts/serve-booking-fixture.mjs.
declare global {
	interface Window {
		completions?: unknown[][];
		widget?: { open(): void; setTheme(mode: 'light' | 'dark'): void };
	}
}

export {};
