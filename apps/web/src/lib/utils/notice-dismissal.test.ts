import { describe, expect, it } from 'vitest';
import { dismissNotice, isNoticeDismissed, type NoticeStorage } from './notice-dismissal';

const memoryStorage = (): NoticeStorage => {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value)
	};
};

describe('global notice dismissal', () => {
	it('persists a visual dismissal for the same notice identity', () => {
		const storage = memoryStorage();
		expect(isNoticeDismissed(storage, 'notice:one')).toBe(false);

		dismissNotice(storage, 'notice:one');

		expect(isNoticeDismissed(storage, 'notice:one')).toBe(true);
	});

	it('does not hide a different or newly identified notice', () => {
		const storage = memoryStorage();
		dismissNotice(storage, 'notice:old');

		expect(isNoticeDismissed(storage, 'notice:new')).toBe(false);
	});
});
