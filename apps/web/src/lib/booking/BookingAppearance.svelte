<script lang="ts">
    import { page } from '$app/state';
    import type { Snippet } from 'svelte';
    import type { BookingTheme } from '@cita-suite/shared/booking-integration';
    let { theme = 'cita-suite', children }: { theme?: BookingTheme; children: Snippet } = $props();
    const framed = $derived(page.url.searchParams.has('parent_origin') && page.url.searchParams.has('instance_id'));
    const colorMode = $derived(page.data?.bookingColorMode === 'dark' ? 'dark' : 'light');
    $effect(() => {
        if (theme !== 'natalia' || window.parent !== window) return;
        const prior = document.documentElement.dataset.bookingColorMode;
        document.documentElement.dataset.bookingColorMode = colorMode;
        // Only her page opened on its own: a framed booking of any practice also gets a color mode.
        document.documentElement.dataset.bookingCanvas = 'natalia';
        // The app's browser bar color belongs to its own light or dark mode: this appearance keeps the
        // bar it had before the light mode (none), and gives it back when the page leaves.
        const bars = [...document.head.querySelectorAll('meta[name="theme-color"]')];
        for (const bar of bars) bar.remove();
        return () => {
            if (prior) document.documentElement.dataset.bookingColorMode = prior; else delete document.documentElement.dataset.bookingColorMode;
            delete document.documentElement.dataset.bookingCanvas;
            for (const bar of bars) document.head.append(bar);
        };
    });
</script>

<svelte:head>
    {#if theme === 'natalia'}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap" />
    {/if}
</svelte:head>

<div class:booking-natalia={theme === 'natalia'} class="booking-surface" data-booking-theme={theme} data-booking-color-mode={theme === 'natalia' && !framed ? colorMode : undefined}>
    {@render children()}
</div>

<style>
	:global(html[data-booking-embedded='true'] body), :global(html[data-booking-embedded='true'] .booking-surface main) { min-height: 0; }
	/* Her page opened on its own, as her site opens it: the canvas around her paper (what shows when the
	   page is pulled past its edges) and the page scrollbar follow her mode, never the app mode. The
	   values are her --paper. `html:root` outweighs the app's `:root.dark`. */
	:global(html:root[data-booking-canvas='natalia'][data-booking-color-mode='light']) { --booking-canvas: #f3eee5; color-scheme: light; }
	:global(html:root[data-booking-canvas='natalia'][data-booking-color-mode='dark']) { --booking-canvas: #1a1612; color-scheme: dark; }
	:global(html:root[data-booking-canvas='natalia']), :global(html:root[data-booking-canvas='natalia'] body) { background-color: var(--booking-canvas); }
    :global(.booking-natalia), :global(.booking-control-menu-natalia) {
        --paper: #f3eee5; --surface: #fffaf2; --text: #1e1a16;
        --text-muted: #463e36; --text-subtle: #6b6155;
        --accent: #a94b22; --accent-strong: #8e3d1a;
        --accent-soft: rgba(169,75,34,.09); --on-accent: #fff8f0; --border-strong: rgba(30,26,22,.2);
        --shadow-accent: 0 6px 18px rgba(169,75,34,.16);
        --border: rgba(30,26,22,.13); --shadow: 0 8px 24px rgba(30,26,22,.07);
		--error-text: #9c2d19; --error-bg: #fbece8; --error-border: #d69b8f;
		--success-text: #26623b; --success-bg: #eef5ea; --success-border: #93b59c;
		--notice-text: #67417f; --notice-bg: #f0e8f6; --notice-border: #b6a0c5;
		--warning-text: #805a0b; --warning-bg: #fbf2de; --warning-border: #c8aa67;
        color: var(--text); background: var(--paper); color-scheme: light;
        font-family: 'Hanken Grotesk', system-ui, sans-serif;
        caret-color: var(--accent);
    }
    :global(.booking-natalia[data-booking-color-mode='dark']), :global(html[data-booking-color-mode='dark'] .booking-natalia:not([data-booking-color-mode])), :global(html[data-booking-color-mode='dark'] .booking-control-menu-natalia) {
        --paper: #1a1612; --surface: #211c17; --text: #efe8dc;
        --text-muted: #cfc5b6; --text-subtle: #a39888;
        --accent: #e07a4f; --accent-strong: #ec9068;
        --shadow-accent: 0 6px 18px rgba(224,122,79,.12);
        --accent-soft: rgba(224,122,79,.13); --on-accent: #1e1a16; --border-strong: rgba(241,234,223,.24);
        --border: rgba(241,234,223,.14); color-scheme: dark;
		--error-text: #ffb09d; --error-bg: #4a201a; --error-border: #a25443;
		--success-text: #abd9b4; --success-bg: #203526; --success-border: #477b53;
		--notice-text: #d9c4ec; --notice-bg: #302139; --notice-border: #79598c;
		--warning-text: #f2ce82; --warning-bg: #3d301a; --warning-border: #91743a;
    }
    :global(.booking-natalia main) { background: var(--paper) !important; color: var(--text) !important; }
    :global(.booking-natalia .ux-card), :global(.booking-natalia .ux-hero), :global(.booking-natalia .ux-panel) {
        background: var(--surface); border-color: var(--border); box-shadow: none; border-radius: 14px;
    }
    :global(.booking-natalia .ux-soft-card), :global(.booking-natalia .ux-choice), :global(.booking-natalia .ux-empty) {
        color: var(--text); background: var(--accent-soft); border-color: var(--border);
    }
    :global(.booking-natalia h1), :global(.booking-natalia .ux-section-title), :global(.booking-natalia .ux-title) {
        font-family: 'Newsreader', Georgia, serif; color: var(--text); font-weight: 500;
    }
    /* Roles marked in the booking components (bk-*): each marks exactly the class strings that this
       appearance repainted before the light mode, when it matched fragments of Tailwind class names. */
    :global(.booking-natalia .bk-text) { color: var(--text) !important; }
    :global(.booking-natalia .bk-muted) { color: var(--text-muted) !important; }
    :global(.booking-natalia .bk-accent-text) { color: var(--accent-strong) !important; }
    :global(.booking-natalia .bk-accent-fill) { background: var(--accent) !important; color: var(--on-accent) !important; }
    :global(.booking-natalia .bk-line) { border-color: var(--border) !important; }
    :global(.booking-natalia .bk-soft) { background: var(--accent-soft) !important; }
    :global(.booking-natalia .ux-label), :global(.booking-natalia .ux-subtitle), :global(.booking-natalia .ux-muted) { color: var(--text-muted); }
    :global(.booking-natalia .ux-input), :global(.booking-natalia .ux-textarea), :global(.booking-natalia .ux-select) {
        background: var(--paper); color: var(--text); border-color: var(--border); color-scheme: inherit;
    }
    :global(.booking-natalia select option) { color: var(--text); background: var(--surface); }
    :global(.booking-natalia .ux-btn-primary) { background: var(--accent-strong); color: var(--on-accent); border-color: var(--accent-strong); }
    :global(.booking-natalia .ux-btn-primary:hover) { background: var(--accent); }
    :global(.booking-natalia .ux-btn-secondary) { background: transparent; color: var(--text); border-color: var(--border-strong); }
    :global(.booking-natalia .ux-badge) { background: var(--accent-soft); color: var(--accent-strong); border-color: var(--border); }
    :global(.booking-natalia .ux-alert) { color: var(--text); background: var(--accent-soft); border-color: var(--border-strong); }
	:global(.booking-natalia .bk-error-text) { color: var(--error-text) !important; }
	:global(.booking-natalia .bk-error-fill) { background: var(--error-bg) !important; }
	:global(.booking-natalia .bk-error-line) { border-color: var(--error-border) !important; }
	:global(.booking-natalia .bk-success-text) { color: var(--success-text) !important; }
	:global(.booking-natalia .bk-success-fill) { background: var(--success-bg) !important; }
	:global(.booking-natalia .bk-success-line) { border-color: var(--success-border) !important; }
	:global(.booking-natalia .bk-notice-text) { color: var(--notice-text) !important; }
	:global(.booking-natalia .bk-notice-fill) { background: var(--notice-bg) !important; }
	:global(.booking-natalia .bk-notice-line) { border-color: var(--notice-border) !important; }
	:global(.booking-natalia .bk-warning-text) { color: var(--warning-text) !important; }
	:global(.booking-natalia .bk-warning-fill) { background: var(--warning-bg) !important; }
	:global(.booking-natalia .bk-warning-line) { border-color: var(--warning-border) !important; }
    :global(.booking-natalia a:focus-visible), :global(.booking-natalia button:focus-visible) { outline: 2px solid var(--accent); outline-offset: 3px; }
    :global(.booking-natalia ::selection) { background: var(--accent-soft); color: var(--text); }
    :global(.booking-natalia *) { scrollbar-color: var(--accent) var(--paper); }

    :global(.booking-control-menu-natalia) { background: var(--surface); border-color: var(--border-strong); color: var(--text); }
    :global(.booking-control-menu-natalia .ux-control-option:hover), :global(.booking-control-menu-natalia .ux-control-option.is-active) { background: var(--accent-soft); }
    :global(.booking-control-menu-natalia .ux-control-option[aria-selected='true']) { background: var(--accent-strong); color: var(--on-accent); }
</style>
