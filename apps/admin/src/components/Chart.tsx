import { Button, Space, Table, Tooltip } from 'antd';
import { LineChartOutlined, TableOutlined } from '@ant-design/icons';
import { chartData } from './chartData';
import { useViewState } from './useViewState';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { chartTheme, SERIES } from '../theme';
import { useDark } from './useDark';

/** ECharts with the console's colours, axis styling and an accessible label. */
export function Chart({ option, height = 280, label }: { option: EChartsOption; height?: number; label: string }) {
  const dark = useDark();
  const stateKey = `chart_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const { view, update } = useViewState({ [stateKey]: 'chart' });
  const mode = view[stateKey];
  const data = chartData(option);
  const t = chartTheme(dark);
  const axis = { axisLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.text, fontSize: 12 }, splitLine: { lineStyle: { color: t.grid } } };
  const themed: EChartsOption = {
    color: [...SERIES],
    textStyle: { fontFamily: "'Inter Variable', Inter, system-ui, sans-serif", color: t.text, fontSize: 13 },
    grid: { left: 40, right: 16, top: 36, bottom: 28, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, textStyle: { color: t.text } },
    legend: { top: 0, textStyle: { color: t.text }, icon: 'roundRect' },
    ...option,
    xAxis: Array.isArray(option.xAxis) ? option.xAxis.map((x) => ({ ...axis, ...x })) : option.xAxis ? { ...axis, ...option.xAxis } : undefined,
    yAxis: Array.isArray(option.yAxis) ? option.yAxis.map((y) => ({ ...axis, ...y })) : option.yAxis ? { ...axis, ...option.yAxis } : undefined,
  } as EChartsOption;
  return (
    <div className="data-chart" aria-label={label}>
      <div className="chart-view-controls"><Space.Compact><Tooltip title="Chart"><Button size="small" type={mode === 'chart' ? 'primary' : 'default'} icon={<LineChartOutlined />} aria-label={`Show chart: ${label}`} onClick={() => update({ [stateKey]: 'chart' })} /></Tooltip><Tooltip title="Table"><Button size="small" type={mode === 'table' ? 'primary' : 'default'} icon={<TableOutlined />} aria-label={`Show table: ${label}`} onClick={() => update({ [stateKey]: 'table' })} /></Tooltip></Space.Compact></div>
      {mode === 'table' ? <Table size="small" rowKey="key" dataSource={data.rows} pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 'max-content', y: height - 70 }}
        columns={data.columns.map((c) => ({ title: c.title, dataIndex: c.key, key: c.key, sorter: (a, b) => typeof a[c.key] === 'number' && typeof b[c.key] === 'number' ? Number(a[c.key]) - Number(b[c.key]) : String(a[c.key] ?? '').localeCompare(String(b[c.key] ?? '')), render: (v: unknown) => v == null ? 'No observation' : String(v) }))} /> : <div role="img" aria-label={label}><ReactECharts option={themed} style={{ height }} notMerge lazyUpdate opts={{ renderer: 'svg' }} /></div>}
    </div>
  );
}
