import type { TableQuery } from '../api';
/** Query URLs may be old, edited or malformed; never pass unbounded paging into a table. */
export function parseTableState(raw: string | undefined, base: TableQuery): TableQuery {
  try {
    const value = JSON.parse(raw || '{}') as Partial<TableQuery>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    const bounded = (n: unknown, fallback: number, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : fallback;
    return {
      q: typeof value.q === 'string' ? value.q : base.q,
      sort: typeof value.sort === 'string' ? value.sort : base.sort,
      order: value.order === 'asc' || value.order === 'desc' ? value.order : base.order,
      page: bounded(value.page, base.page, 100000), size: bounded(value.size, base.size, 100),
      filters: value.filters && typeof value.filters === 'object' && !Array.isArray(value.filters) ? Object.fromEntries(Object.entries(value.filters).filter(([, v]) => typeof v === 'string')) : {},
    };
  } catch { return base; }
}
