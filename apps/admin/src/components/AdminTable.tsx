import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Input, Popover, Segmented, Space, Table, Typography, type TableProps } from 'antd';
import { ReloadOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { api, errorText, type TablePage, type TableQuery } from '../api';
import { parseTableState } from './tableState';
import { useViewState } from './useViewState';

interface Props<T extends object> {
  id: string; resource: string; columns: ColumnType<T>[]; rowKey: TableProps<T>['rowKey']; scope?: Record<string, string>;
  defaultSort?: string; defaultOrder?: 'asc' | 'desc'; defaultSize?: number; searchId?: string; searchPlaceholder?: string;
  refreshKey?: unknown; controls?: ReactNode; onRow?: TableProps<T>['onRow']; testId?: string;
}

/** All source-backed admin tables share backend paging, column queries and persistent display settings. */
export function AdminTable<T extends object>({ id, resource, columns, rowKey, scope = {}, defaultSort = '', defaultOrder = 'asc', defaultSize = 20, searchId, searchPlaceholder = 'Search this table', refreshKey, controls, onRow, testId }: Props<T>) {
  const stateKey = `table_${id}`;
  const { view, update } = useViewState({ [stateKey]: '' });
  const query = useMemo<TableQuery>(() => {
    const base: TableQuery = { q: '', sort: defaultSort, order: defaultOrder, page: 1, size: defaultSize, filters: {} };
    return parseTableState(view[stateKey], base);
  }, [view[stateKey], defaultSort, defaultOrder, defaultSize]);
  const setQuery = (patch: Partial<TableQuery>, replace = false) => update({ [stateKey]: JSON.stringify({ ...query, ...patch }) }, replace);
  const [data, setData] = useState<TablePage<T> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const keys = columns.map((c) => String(c.key ?? c.dataIndex));
  const [visible, setVisible] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem(`convo-table-${id}`) || 'null'); return saved?.columns?.length ? saved.columns : keys; } catch { return keys; } });
  const [density, setDensity] = useState<'small' | 'middle' | 'large'>(() => { try { return JSON.parse(localStorage.getItem(`convo-table-${id}`) || 'null')?.density ?? 'middle'; } catch { return 'middle'; } });
  useEffect(() => { try { localStorage.setItem(`convo-table-${id}`, JSON.stringify({ columns: visible, density })); } catch { /* private mode */ } }, [visible, density, id]);
  const request = JSON.stringify({ query, scope });
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true); setError(null);
      const { query: q, scope: s } = JSON.parse(request) as { query: TableQuery; scope: Record<string, string> };
      void api.table<T>(resource, s, q).then((r) => { if (active) setData(r); }).catch((e) => { if (active) setError(errorText(e)); }).finally(() => { if (active) setBusy(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [request, resource, refreshKey, version]);
  const configured: ColumnType<T>[] = columns.filter((c) => visible.includes(String(c.key ?? c.dataIndex))).map((column) => {
    const key = String(column.key ?? column.dataIndex);
    if (key === 'actions') return column;
    const label = typeof column.title === 'string' ? column.title : key;
    return { ...column, sorter: true, sortOrder: query.sort === key ? query.order === 'desc' ? 'descend' : 'ascend' : null,
      filteredValue: query.filters[key] ? [query.filters[key]!] : null,
      filterIcon: (active) => <SearchOutlined style={{ color: active ? '#2596BE' : undefined }} />,
      filterDropdown: ({ selectedKeys, setSelectedKeys, confirm, clearFilters }) => <div style={{ padding: 12, width: 250 }} onKeyDown={(e) => e.stopPropagation()}>
        <Typography.Text strong>Search {label}</Typography.Text><Input autoFocus style={{ marginBlock: 10 }} placeholder={`Search ${label}`} value={String(selectedKeys[0] ?? '')} onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])} onPressEnter={() => confirm()} />
        <Space><Button type="primary" size="small" onClick={() => confirm()}>Apply</Button><Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>Clear</Button></Space>
      </div>,
    };
  });
  return <div className="remote-table" data-testid={testId}>
    <div className="table-controls">{controls}<Input.Search allowClear value={query.q} onChange={(e) => setQuery({ q: e.target.value, page: 1 }, true)} placeholder={searchPlaceholder} data-testid={searchId} aria-label={searchPlaceholder} />
      <div className="table-tools"><Typography.Text type="secondary">{data?.total ?? '…'} results</Typography.Text><Button type="text" icon={<ReloadOutlined />} aria-label="Refresh table" loading={busy} onClick={() => setVersion((v) => v + 1)} />
        <Popover trigger="click" placement="bottomRight" title="Table settings" content={<Space direction="vertical" size="middle" style={{ width: 260 }}>
          <Typography.Text type="secondary">Visible columns</Typography.Text><Checkbox.Group value={visible} onChange={(values) => { if (values.length) setVisible(values as string[]); }} options={columns.map((c) => ({ value: String(c.key ?? c.dataIndex), label: typeof c.title === 'string' ? c.title : String(c.key) }))} className="column-options" />
          <Typography.Text type="secondary">Row density</Typography.Text><Segmented value={density} onChange={(v) => setDensity(v as typeof density)} options={[{ value: 'small', label: 'Compact' }, { value: 'middle', label: 'Default' }, { value: 'large', label: 'Roomy' }]} />
          <Button onClick={() => { setVisible(keys); setDensity('middle'); }}>Reset display settings</Button>
        </Space>}><Button icon={<SettingOutlined />} aria-label="Table settings" data-testid={`table-settings-${id}`} /></Popover>
      </div>
    </div>
    {error && <Alert type="error" showIcon message={error} />}{data?.warnings.map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}
    <Table<T> rowKey={rowKey} columns={configured} dataSource={data?.rows ?? []} loading={busy} size={density} scroll={{ x: 'max-content', y: 1 }} onRow={onRow}
      pagination={{ current: data?.page ?? query.page, pageSize: query.size, total: data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`, hideOnSinglePage: false }}
      onChange={(pagination, filters, sorter, extra) => {
        const sort = Array.isArray(sorter) ? sorter[0] : sorter;
        setQuery({ page: extra.action === 'paginate' && pagination.pageSize === query.size ? pagination.current ?? 1 : 1, size: pagination.pageSize ?? query.size,
          sort: sort?.order ? String(sort.columnKey ?? '') : defaultSort, order: sort?.order === 'descend' ? 'desc' : sort?.order === 'ascend' ? 'asc' : defaultOrder,
          filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v?.length).map(([k, v]) => [k, String(v![0])])) });
      }} />
  </div>;
}
