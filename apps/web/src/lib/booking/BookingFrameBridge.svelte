<script lang="ts">
    import { onMount } from 'svelte';
    import { BOOKING_EMBED_PROTOCOL, BOOKING_EMBED_VERSION, isBookingHostMessage, type BookingHostMessage } from '@turnos-saas/shared/booking-integration';
    let { context, requestId, completed = false } = $props<{ context: { parentOrigin: string; instanceId: string }; requestId?: string; completed?: boolean }>();
    onMount(() => {
        if (window.parent === window) return;
		document.documentElement.dataset.bookingEmbedded = 'true';
        const send = (type: BookingHostMessage['type'], extra: Partial<BookingHostMessage> = {}) => window.parent.postMessage({ protocol: BOOKING_EMBED_PROTOCOL, version: BOOKING_EMBED_VERSION, instanceId: context.instanceId, type, ...extra }, context.parentOrigin);
        const message = (event: MessageEvent) => {
            if (event.source !== window.parent || event.origin !== context.parentOrigin || !isBookingHostMessage(event.data, context.instanceId)) return;
            if (event.data.type === 'theme') document.documentElement.dataset.bookingColorMode = event.data.theme;
        };
        let frame = 0;
        const resize = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => send('resize', { height: Math.max(200, Math.min(10000, Math.ceil(document.body.getBoundingClientRect().height))) }));
        };
        const observer = new ResizeObserver(resize);
        observer.observe(document.body);
        window.addEventListener('message', message);
		const escape = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !event.defaultPrevented && !(event.target instanceof HTMLSelectElement)) send('close');
		};
		window.addEventListener('keydown', escape);
        send('ready');
        if (requestId) send('request', { requestId });
        if (completed) send('completed');
        resize();
        return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('message', message); window.removeEventListener('keydown', escape); delete document.documentElement.dataset.bookingEmbedded; };
    });
</script>
