import { expect, it } from 'vitest';
import { chartData } from './chartData';
it('exposes aligned series values and missing observations without changing them', () => {
  const data = chartData({ xAxis: { data: ['Monday', 'Tuesday'] }, series: [{ name: 'Sent', type: 'bar', data: [3, 0] }, { name: 'Opened', type: 'scatter', data: [1, null] }] });
  expect(data.rows).toEqual([{ key: '0', category: 'Monday', s0: 3, s1: 1 }, { key: '1', category: 'Tuesday', s0: 0, s1: null }]);
});
it('exposes named pie slices and calendar values', () => {
  expect(chartData({ series: [{ type: 'pie', data: [{ name: 'Active', value: 12 }] }] }).rows[0]).toMatchObject({ category: 'Active', value: 12 });
  expect(chartData({ series: [{ type: 'heatmap', data: [['2026-10-24', 3]] }] }).rows[0]).toMatchObject({ category: '2026-10-24', value: 3 });
});
