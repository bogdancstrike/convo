import { ChartCard, ChartViewSwitch, useChartHeader } from './ChartCard';
import { LocalDataTable } from './LocalDataTable';
import { chartData } from './chartData';
import { useViewState } from './useViewState';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { chartTheme, SERIES } from '../theme';
import { useDark } from './useDark';

/** ECharts with the console's colours, axis styling and an accessible label. */
interface Props { option: EChartsOption; height?: number; label: string }
export function Chart(props: Props) {
  const header = useChartHeader();
  return header === undefined ? <ChartCard title={props.label}><ChartBody {...props} /></ChartCard> : <ChartBody {...props} />;
}

function ChartBody({ option, height = 280, label }: Props) {
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
      <ChartViewSwitch mode={mode} label={label} onChange={(next) => update({ [stateKey]: next })} />
      {mode === 'table' ? <LocalDataTable id={stateKey} rows={data.rows} columns={data.columns} height={height} /> : <div role="img" aria-label={label}><ReactECharts option={themed} style={{ height }} notMerge lazyUpdate opts={{ renderer: 'svg' }} /></div>}
    </div>
  );
}
