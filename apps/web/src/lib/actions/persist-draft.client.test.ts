/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { persistDraft } from './persist-draft';

function form() {
	const node = document.createElement('form');
	node.innerHTML = '<input name="name" value="Original"><input name="consent" type="checkbox"><input name="secret" type="password" value="Untouched">';
	document.body.append(node);
	return node;
}

afterEach(() => { sessionStorage.clear(); document.body.replaceChildren(); });

describe('optional form drafts at their storage boundary', () => {
	it.each(['5', 'true', '"text"', '[]', 'null', '{broken'])('ignores invalid stored shapes without breaking the form: %s', raw => {
		sessionStorage.setItem('draft:synthetic', raw);
		const node = form();
		const action = persistDraft(node, 'synthetic');
		expect(node.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('Original');
		if (action) action.destroy?.();
	});

	it('restores valid field types while preserving password exclusion', () => {
		sessionStorage.setItem('draft:synthetic', JSON.stringify({ name: 'Draft', consent: true, secret: 'Do not restore' }));
		const node = form();
		const action = persistDraft(node, 'synthetic');
		expect(node.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('Draft');
		expect(node.querySelector<HTMLInputElement>('[name="consent"]')?.checked).toBe(true);
		expect(node.querySelector<HTMLInputElement>('[name="secret"]')?.value).toBe('Untouched');
		if (action) action.destroy?.();
	});

	it('does not convert a malformed consent string to true', () => {
		sessionStorage.setItem('draft:synthetic', JSON.stringify({ consent: 'false' }));
		const node = form();
		const action = persistDraft(node, 'synthetic');
		expect(node.querySelector<HTMLInputElement>('[name="consent"]')?.checked).toBe(false);
		if (action) action.destroy?.();
	});
});
