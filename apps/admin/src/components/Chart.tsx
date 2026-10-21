import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { chartTheme, SERIES } from '../theme';
import { useDark } from './useDark';

/** ECharts with the console's colours, axis styling and an accessible label. */
export function Chart({ option, height = 280, label }: { option: EChartsOption; height?: number; label: string }) {
  const dark = useDark();
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
    <div role="img" aria-label={label}>
      <ReactECharts option={themed} style={{ height }} notMerge lazyUpdate opts={{ renderer: 'svg' }} />
    </div>
  );
}
