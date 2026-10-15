export const STALLED_NAVIGATION_RECOVERY_MS = 12_000;

type StalledNavigationRecoveryOptions = {
	/** Devuelve true únicamente si la misma navegación todavía sigue pendiente. */
	isPending: (targetHref: string) => boolean;
	/** Recupera la navegación con una carga completa, fuera del router cliente. */
	recover: (targetHref: string) => void;
	timeoutMs?: number;
};

/**
 * Evita que una navegación del router quede esperando indefinidamente después
 * de que el navegador vuelve de estar inactivo. La carga normal nunca llega a
 * este límite; si la misma navegación continúa pendiente, se recupera con una
 * carga completa de la ruta de destino.
 */
export const createStalledNavigationRecovery = ({
	isPending,
	recover,
	timeoutMs = STALLED_NAVIGATION_RECOVERY_MS
}: StalledNavigationRecoveryOptions) => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let scheduledTarget = '';

	const clear = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		scheduledTarget = '';
	};

	const schedule = (targetHref: string) => {
		if (timer && scheduledTarget === targetHref) return;
		clear();
		scheduledTarget = targetHref;
		timer = setTimeout(() => {
			const target = scheduledTarget;
			timer = null;
			scheduledTarget = '';
			if (target && isPending(target)) recover(target);
		}, timeoutMs);
	};

	return { schedule, clear };
};
