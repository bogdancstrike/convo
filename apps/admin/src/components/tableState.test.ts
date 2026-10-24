import { expect, it } from 'vitest';
import { parseTableState } from './tableState';
const base = { q: '', sort: 'seq', order: 'desc' as const, page: 1, size: 50, filters: {} };
it('bounds shared table page sizes and preserves valid query state', () => {
  expect(parseTableState('{"page":-10,"size":10000,"filters":{"actor":"ana","bad":4}}', base)).toMatchObject({ page: 1, size: 100, filters: { actor: 'ana' } });
  expect(parseTableState('{"q":"Ana & Dan","page":3,"size":10,"order":"asc"}', base)).toMatchObject({ q: 'Ana & Dan', page: 3, size: 10, order: 'asc' });
});
it('recovers from invalid URLs without breaking the page', () => {
  for (const value of ['{', 'null', '[]', '"text"']) expect(parseTableState(value, base)).toEqual(base);
});
