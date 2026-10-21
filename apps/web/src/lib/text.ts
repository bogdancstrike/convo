/**
 * Search folding: case-insensitive and diacritic-insensitive (Romanian ă â î ș ț, both the comma
 * and legacy cedilla forms), so "stefan" finds "Ștefan".
 */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('ro');
}

/** True when every whitespace-separated query term occurs in one of the fields. */
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const haystack = fold(fields.filter(Boolean).join(' '));
  return fold(query).split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}
