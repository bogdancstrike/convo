import type { EChartsOption } from 'echarts';
export interface ChartData { columns: { key: string; title: string }[]; rows: Record<string, string | number | null>[] }
/** Expose the exact plotted values, including missing observations, without sampling. */
export function chartData(option: EChartsOption): ChartData {
  const series = (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) as { name?: string; type?: string; data?: unknown[] }[];
  const axis = (Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis) as { data?: (string | number)[] } | undefined;
  const value = (v: unknown): string | number | null => {
    if (v == null) return null;
    if (typeof v === 'number' || typeof v === 'string') return v;
    if (typeof v === 'object' && 'value' in v) return value((v as { value: unknown }).value);
    return null;
  };
  if (axis?.data) return {
    columns: [{ key: 'category', title: 'Period' }, ...series.map((s, i) => ({ key: `s${i}`, title: s.name ?? `Series ${i + 1}` }))],
    rows: axis.data.map((category, row) => Object.fromEntries([['key', String(row)], ['category', category], ...series.map((s, i) => [`s${i}`, value(s.data?.[row])])])),
  };
  const rows: ChartData['rows'] = [];
  for (const [index, s] of series.entries()) for (const [i, raw] of (s.data ?? []).entries()) {
    const item = raw as { name?: string; value?: unknown };
    rows.push({ key: `${index}:${i}`, category: Array.isArray(raw) ? String(raw[0]) : item.name ?? String(i + 1), series: s.name ?? 'Value', value: Array.isArray(raw) ? value(raw[1]) : value(raw) });
  }
  return { columns: [{ key: 'category', title: 'Category / date' }, { key: 'series', title: 'Series' }, { key: 'value', title: 'Value' }], rows };
}
