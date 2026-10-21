import { theme as antdTheme, type ThemeConfig } from 'antd';

/**
 * Design tokens for the console, one source for Ant Design and the charts (the nucleus approach):
 * neutral surfaces, one accent (Convo ocean), fixed status colours, compact density.
 */
export const BRAND = { navy: '#17324D', ocean: '#2596BE', cyan: '#8BD3E2', amber: '#F2B66D' } as const;
export const STATUS = { success: '#2E9D6A', warning: '#D9922E', danger: '#D14B4B', info: BRAND.ocean } as const;
/** Series colours in a fixed order (charts never reuse status colours for neutral series). */
export const SERIES = ['#2596BE', '#8BD3E2', '#7A6FF0', '#F2B66D', '#5BB98C', '#E37A9D'] as const;

export function themeConfig(dark: boolean): ThemeConfig {
  return {
    algorithm: dark ? [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm] : [antdTheme.defaultAlgorithm, antdTheme.compactAlgorithm],
    token: {
      colorPrimary: BRAND.ocean,
      colorInfo: BRAND.ocean,
      colorSuccess: STATUS.success,
      colorWarning: STATUS.warning,
      colorError: STATUS.danger,
      fontFamily: "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontSize: 13,
      borderRadius: 8,
      colorBgLayout: dark ? '#0b0c10' : '#f4f6f8',
      colorBgContainer: dark ? '#15171c' : '#ffffff',
      colorBorderSecondary: dark ? '#232730' : '#e6eaee',
    },
    components: {
      Layout: { siderBg: dark ? '#0e0f14' : '#ffffff', headerBg: dark ? '#0e0f14' : '#ffffff', bodyBg: dark ? '#0b0c10' : '#f4f6f8' },
      Menu: { itemBg: 'transparent', itemSelectedBg: dark ? '#1b2a33' : '#eaf5f9', itemSelectedColor: BRAND.ocean },
      Card: { headerFontSize: 14 },
      Table: { headerBg: dark ? '#1b1e24' : '#f8fafc' },
    },
  };
}

/** ECharts colours/axes matching the Ant Design theme. */
export function chartTheme(dark: boolean) {
  const text = dark ? '#c9ced8' : '#475569';
  const grid = dark ? '#262a33' : '#e6eaee';
  return { text, grid, tooltipBg: dark ? '#1b1e24' : '#ffffff', tooltipBorder: grid };
}
