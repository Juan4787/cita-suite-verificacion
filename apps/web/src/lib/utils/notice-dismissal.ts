export type NoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const isNoticeDismissed = (storage: NoticeStorage, key: string) =>
	storage.getItem(key) === '1';

export const dismissNotice = (storage: NoticeStorage, key: string) => {
	storage.setItem(key, '1');
};
