import { expect, it } from 'vitest';
import { fold, matches } from './text';
it('folds case and Romanian diacritics (comma and cedilla forms)', () => {
  expect(fold('Ștefan Țăran')).toBe('stefan taran');
  expect(fold('Şerban Ţuţea')).toBe('serban tutea');
  expect(matches('stef tar', 'Ștefan Țăran', '@stefan')).toBe(true);
  expect(matches('ion', 'Ștefan', '@stefan')).toBe(false);
  expect(matches('  ', 'anything')).toBe(true);
});
