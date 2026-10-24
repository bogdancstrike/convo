import { useState } from 'react';
import { Button, Checkbox, Input, Popover, Space, Table, Typography } from 'antd';
import { SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { useViewState } from './useViewState';

/** A complete, already fetched visualization dataset; filters never operate on a sampled page. */
export function LocalDataTable({ id, columns, rows, height = 300, onRow }: {
  id: string; columns: { key: string; title: string }[]; rows: Record<string, string | number | null>[]; height?: number; onRow?: (row: Record<string, string | number | null>) => void;
}) {
  const key = `values_${id}`;
  const { view, update } = useViewState({ [key]: '' });
  let state: { q: string; sort: string; order: 'ascend' | 'descend' | null; page: number; size: number; filters: Record<string, string> } = { q: '', sort: '', order: null, page: 1, size: 10, filters: {} };
  try { state = { ...state, ...JSON.parse(view[key] || '{}') }; } catch { /* invalid shared URL */ }
  const change = (patch: Partial<typeof state>, replace = false) => update({ [key]: JSON.stringify({ ...state, ...patch }) }, replace);
  const [visible, setVisible] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(`convo-columns-${id}`) || 'null') ?? columns.map((c) => c.key); } catch { return columns.map((c) => c.key); } });
  const shown = rows.filter((row) => !state.q || Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(state.q.toLowerCase())));
  return <div className="local-data-table" style={{ height }}><div className="table-controls"><Input.Search allowClear placeholder="Search displayed values" value={state.q} onChange={(e) => change({ q: e.target.value, page: 1 }, true)} />
    <Popover trigger="click" title="Visible columns" content={<Checkbox.Group className="column-options" value={visible} options={columns.map((c) => ({ label: c.title, value: c.key }))} onChange={(values) => { if (values.length) { setVisible(values as string[]); try { localStorage.setItem(`convo-columns-${id}`, JSON.stringify(values)); } catch { /* private mode */ } } }} />}><Button icon={<SettingOutlined />} aria-label="Table settings" /></Popover></div>
    <Table size="small" rowKey="key" dataSource={shown} scroll={{ x: 'max-content', y: Math.max(120, height - 115) }} onRow={(row) => ({ onClick: () => onRow?.(row), style: onRow ? { cursor: 'pointer' } : undefined })}
      pagination={{ current: state.page, pageSize: state.size, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }}
      onChange={(pagination, filters, sorter) => { const sort = Array.isArray(sorter) ? sorter[0] : sorter; change({ page: pagination.current ?? 1, size: pagination.pageSize ?? 10, sort: String(sort?.columnKey ?? ''), order: sort?.order ?? null, filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v?.length).map(([k, v]) => [k, String(v![0])])) }); }}
      columns={columns.filter((c) => visible.includes(c.key)).map((c) => ({ title: c.title, dataIndex: c.key, key: c.key,
        sorter: (a, b) => typeof a[c.key] === 'number' && typeof b[c.key] === 'number' ? Number(a[c.key]) - Number(b[c.key]) : String(a[c.key] ?? '').localeCompare(String(b[c.key] ?? '')), sortOrder: state.sort === c.key ? state.order : null,
        filteredValue: state.filters[c.key] ? [state.filters[c.key]!] : null, onFilter: (value, row) => String(row[c.key] ?? '').toLowerCase().includes(String(value).toLowerCase()), filterIcon: (active) => <SearchOutlined style={{ color: active ? '#2596be' : undefined }} />,
        filterDropdown: ({ selectedKeys, setSelectedKeys, confirm, clearFilters }) => <Space direction="vertical" style={{ padding: 12 }}><Typography.Text>Search {c.title}</Typography.Text><Input value={String(selectedKeys[0] ?? '')} onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])} onPressEnter={() => confirm()} /><Space><Button size="small" type="primary" onClick={() => confirm()}>Apply</Button><Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>Clear</Button></Space></Space>,
        render: (value: unknown) => value == null ? 'No observation' : String(value),
      }))} />
  </div>;
}
