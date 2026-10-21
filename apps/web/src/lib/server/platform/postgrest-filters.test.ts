import { describe, expect, it } from 'vitest';
import { ilikeContains } from './postgrest-filters';

// How PostgREST splits a logic tree (src/library/PostgREST/ApiRequest/QueryParams.hs,
// pLogicSingleVal and pQuotedValue): a quoted value reads `\x` as `x` up to the closing
// quote; an unquoted one ends at `,` or `)`.
const conditions = (tree: string) => {
	const found: Array<{ field: string; value: string }> = [];
	let rest = tree;
	while (rest.length) {
		const match = /^([a-z_]+)\.ilike\./.exec(rest);
		if (!match) throw new Error(`Unexpected condition: ${rest}`);
		rest = rest.slice(match[0].length);
		let value = '';
		if (rest.startsWith('"')) {
			let index = 1;
			for (; index < rest.length && rest[index] !== '"'; index += 1) {
				if (rest[index] === '\\') index += 1;
				value += rest[index];
			}
			rest = rest.slice(index + 1);
		} else {
			const end = rest.search(/[,)]/);
			value = end === -1 ? rest : rest.slice(0, end);
			rest = end === -1 ? '' : rest.slice(end);
		}
		found.push({ field: match[1], value });
		if (rest.startsWith(',')) rest = rest.slice(1);
		else if (rest.length) throw new Error(`Condition not closed: ${rest}`);
	}
	return found;
};

describe('ilikeContains', () => {
	it('keeps commas and parentheses as text of one condition', () => {
		const tree = [ilikeContains('full_name', 'Pérez, Juan (hijo)'), ilikeContains('dni', '30')].join(',');
		expect(conditions(tree)).toEqual([
			{ field: 'full_name', value: '%Pérez, Juan (hijo)%' },
			{ field: 'dni', value: '%30%' }
		]);
	});

	it('matches the text as written: wildcards, quotes and backslashes are not operators', () => {
		expect(conditions(ilikeContains('full_name', '50%_"x\\'))).toEqual([
			{ field: 'full_name', value: '%50\\%\\_"x\\\\%' }
		]);
	});

	it('cannot add a condition through the text', () => {
		expect(conditions(ilikeContains('full_name', 'x",id.not.is.null,full_name.ilike."'))).toHaveLength(1);
	});
});
