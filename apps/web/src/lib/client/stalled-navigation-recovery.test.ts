import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createStalledNavigationRecovery,
	STALLED_NAVIGATION_RECOVERY_MS
} from './stalled-navigation-recovery';

describe('stalled navigation recovery', () => {
	afterEach(() => vi.useRealTimers());

	it('recovers only when the same navigation remains pending past the limit', () => {
		vi.useFakeTimers();
		let pendingTarget = 'https://app.test/odonto/pacientes/patient-1';
		const recover = vi.fn();
		const recovery = createStalledNavigationRecovery({
			isPending: (target) => pendingTarget === target,
			recover
		});

		recovery.schedule(pendingTarget);
		vi.advanceTimersByTime(STALLED_NAVIGATION_RECOVERY_MS - 1);
		expect(recover).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(recover).toHaveBeenCalledWith(pendingTarget);
	});

	it('does not recover a navigation that finished or changed before the limit', () => {
		vi.useFakeTimers();
		let pendingTarget = 'https://app.test/odonto/pacientes/patient-1';
		const recover = vi.fn();
		const recovery = createStalledNavigationRecovery({
			isPending: (target) => pendingTarget === target,
			recover
		});

		recovery.schedule(pendingTarget);
		pendingTarget = 'https://app.test/odonto/pacientes/patient-2';
		vi.advanceTimersByTime(STALLED_NAVIGATION_RECOVERY_MS);

		expect(recover).not.toHaveBeenCalled();
	});

	it('clears a completed navigation before its recovery timer fires', () => {
		vi.useFakeTimers();
		const recover = vi.fn();
		const recovery = createStalledNavigationRecovery({
			isPending: () => true,
			recover
		});

		recovery.schedule('https://app.test/odonto/pacientes/patient-1');
		recovery.clear();
		vi.advanceTimersByTime(STALLED_NAVIGATION_RECOVERY_MS);

		expect(recover).not.toHaveBeenCalled();
	});
});
