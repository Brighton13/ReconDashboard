import { useEffect, useMemo, useState } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const SESSION_STORAGE_KEY = 'recon-dashboard-session';
const DAY_FILTERS = [7, 14, 30, 60];
const ZRA_DAY_FILTERS = [1, 7, 14, 30, 60];
const DASHBOARD_PRESETS = [
  { value: 1, label: 'Today' },
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
];
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const MENU_GROUPS = [
  {
    key: 'overview',
    label: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
    ],
  },
  {
    key: 'transactions',
    label: 'Transactions',
    items: [
      { key: 'sales', label: 'Sales', path: '/sales' },
      { key: 'credit-notes', label: 'Credit Notes', path: '/credit-notes' },
    ],
  },
  {
    key: 'batches',
    label: 'Batches',
    items: [
      { key: 'day-end-batches', label: 'Day End Batches', path: '/day-end-batches' },
      { key: 'credit-note-batches', label: 'Credit Note Batches', path: '/credit-note-batches' },
    ],
  },
  {
    key: 'compliance',
    label: 'Compliance & Ops',
    items: [
      { key: 'zra-compliance', label: 'ZRA Compliance', path: '/zra-compliance' },
      { key: 'terminal-visibility', label: 'Terminal Visibility', path: '/terminal-visibility' },
      { key: 'attention-queue', label: 'Attention Queue', path: '/attention-queue' },
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    items: [
      { key: 'release-management', label: 'Release Management', path: '/release-management' },
      { key: 'user-management', label: 'User Management', path: '/user-management' },
    ],
  },
];

const MENU_ITEMS = MENU_GROUPS.flatMap((group) => group.items);

function getGroupKeyForMenu(menuKey) {
  const group = MENU_GROUPS.find((entry) => entry.items.some((item) => item.key === menuKey));
  return group?.key || MENU_GROUPS[0].key;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatBytes(value) {
  const numericValue = Number(value || 0);
  if (!numericValue) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(numericValue) / Math.log(1024)), units.length - 1);
  const normalized = numericValue / (1024 ** unitIndex);
  return `${normalized.toFixed(normalized >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDateTime(value) {
  if (!value) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatShortDate(value) {
  if (!value) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function formatDayFilterLabel(days) {
  return days === 1 ? 'Today' : `Last ${days} days`;
}

function titleizeDocumentType(value) {
  return String(value || '')
    .split(/[_\.]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function slugToTitle(value) {
  return String(value || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusTone(statusBucket) {
  if (statusBucket === 'completed') {
    return 'tone-green';
  }

  if (statusBucket === 'failed') {
    return 'tone-red';
  }

  return 'tone-amber';
}

function complianceBucket(rate) {
  if (rate >= 95) {
    return 'completed';
  }

  if (rate >= 80) {
    return 'processing';
  }

  return 'failed';
}

function buildQueryString(params) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    searchParams.set(key, String(value));
  });

  return searchParams.toString();
}

function paginateClientRows(rows, page, pageSize) {
  const total = rows.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;

  return {
    rows: rows.slice(startIndex, startIndex + pageSize),
    pagination: {
      page: currentPage,
      pageSize,
      total,
      totalPages,
    },
  };
}

function readStoredSession() {
  const rawValue = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function getMenuFromPath(pathname) {
  const matchedItem = MENU_ITEMS.find((item) => pathname === item.path);
  return matchedItem?.key || 'dashboard';
}

function navigateToPath(path, replace = false) {
  if (window.location.pathname === path) {
    return;
  }

  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
}

function createBatchFilters(eventType) {
  return {
    branchId: '',
    terminalId: '',
    status: '',
    startDate: '',
    endDate: '',
    page: 1,
    pageSize: 10,
    type: eventType,
  };
}

async function requestJson(path, { method = 'GET', token, body, signal } = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function downloadFile(path, { token, params } = {}) {
  const query = params ? buildQueryString(params) : '';
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}${query ? `?${query}` : ''}`, { headers });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (payload?.message) {
        message = payload.message;
      }
    } catch (parseError) {
      // Non-JSON error body; keep the default message.
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const fileName = match ? match[1] : 'download';

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function useReconApi(path, params, token, enabled = true, onUnauthorized) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !token) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const queryString = buildQueryString(params);

    async function loadData() {
      setLoading(true);
      setError('');

      try {
        const payload = await requestJson(`${path}${queryString ? `?${queryString}` : ''}`, {
          token,
          signal: controller.signal,
        });
        setData(payload);
      } catch (loadError) {
        if (loadError.name === 'AbortError') {
          return;
        }

        if (loadError.status === 401 && onUnauthorized) {
          onUnauthorized();
        }

        setError(loadError.message || 'Failed to load dashboard data');
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    loadData();

    return () => controller.abort();
  }, [enabled, path, token, JSON.stringify(params)]);

  return { data, loading, error };
}

function MetricCard({ label, value, meta, accent }) {
  return (
    <article className={`metric-card ${accent || ''}`}>
      <p className="eyebrow">{label}</p>
      <h3>{value}</h3>
      <p className="metric-meta">{meta}</p>
    </article>
  );
}

function StatusPill({ status, bucket }) {
  return <span className={`status-pill ${statusTone(bucket)}`}>{status}</span>;
}

function PerformanceList({ rows, valueKey, className = '' }) {
  const maxValue = Math.max(...rows.map((row) => row[valueKey] || 0), 1);

  return (
    <div className={`performance-list ${className}`.trim()}>
      {rows.map((row) => {
        const width = `${Math.max(((row[valueKey] || 0) / maxValue) * 100, 6)}%`;
        return (
          <article key={row.key} className="performance-row">
            <div className="performance-header">
              <div>
                <h4>{row.label}</h4>
                <p>
                  {row.branchId ? `Branch ${row.branchId} • ` : ''}
                  {formatNumber(row.salesCount)} sales
                </p>
              </div>
              <strong>{formatCurrency(row.totalAmount)}</strong>
            </div>
            <div className="performance-bar-track">
              <div className="performance-bar-fill" style={{ width }} />
            </div>
            <div className="performance-meta">
              <span>Posted {formatNumber(row.postedSalesCount)}</span>
              <span>Pending {formatNumber(row.pendingSalesCount)}</span>
              <span>Batches {formatNumber(row.batches)}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function DataState({ loading, error, empty, children }) {
  if (loading) {
    return <section className="state-panel">Loading reconciliation data...</section>;
  }

  if (error) {
    return <section className="state-panel error-panel">{error}</section>;
  }

  if (empty) {
    return <section className="state-panel">No data found for the selected filters.</section>;
  }

  return children;
}

function Pagination({ pagination, onPageChange }) {
  if (!pagination || pagination.totalPages <= 1) {
    return null;
  }

  return (
    <div className="pagination-bar">
      <button
        type="button"
        className="pagination-button"
        onClick={() => onPageChange(pagination.page - 1)}
        disabled={pagination.page <= 1}
      >
        Previous
      </button>
      <span>
        Page {pagination.page} of {pagination.totalPages} • {formatNumber(pagination.total)} records
      </span>
      <button
        type="button"
        className="pagination-button"
        onClick={() => onPageChange(pagination.page + 1)}
        disabled={pagination.page >= pagination.totalPages}
      >
        Next
      </button>
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function PageSizeField({ value, onChange }) {
  return (
    <FilterField label="Page size">
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {PAGE_SIZE_OPTIONS.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </FilterField>
  );
}

function SaleDetailsDialog({ sale, onClose, onReconcile, reconciling, canReconcile }) {
  const [manualOrderNumber, setManualOrderNumber] = useState('');

  if (!sale) {
    return null;
  }

  const showReconcile = canReconcile && !sale.postedToSage;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog-panel sale-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">Sale Details</p>
            <h2 id="sale-details-title">Sale #{sale.saleId}</h2>
          </div>
          <div className="dialog-header-actions">
            {showReconcile && (
              <button
                type="button"
                className="primary-button"
                onClick={() => onReconcile(sale)}
                disabled={reconciling}
              >
                {reconciling ? 'Reconciling...' : 'Reconcile with Sage'}
              </button>
            )}
            <button type="button" className="secondary-button" onClick={onClose}>Close</button>
          </div>
        </div>

        <article className="detail-reason-card">
          <div className="detail-reason-header">
            <strong>{sale.postedToSage ? 'Posting result' : 'Why this sale is pending'}</strong>
            <StatusPill status={sale.batchStatus} bucket={sale.batchStatusBucket} />
          </div>
          <p>{sale.pendingReason || 'No additional detail is available for this sale.'}</p>
        </article>

        {showReconcile && (
          <article className="detail-reason-card sale-correction-card">
            <strong>Correct this sale</strong>
            <p>
              If the day-end batch never posted, re-post it to create the Sage order. If the order already
              exists in Sage under a different reference, enter its OE order number to link it.
            </p>
            <div className="correction-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => onReconcile(sale, { repost: true })}
                disabled={reconciling}
              >
                {reconciling ? 'Working...' : 'Re-post batch to Sage'}
              </button>
            </div>
            <div className="correction-link-row">
              <input
                type="text"
                placeholder="Sage OE order number (e.g. ORD0000000000000020667)"
                value={manualOrderNumber}
                onChange={(event) => setManualOrderNumber(event.target.value)}
              />
              <button
                type="button"
                className="primary-button"
                onClick={() => onReconcile(sale, { sageOrderNumber: manualOrderNumber.trim() })}
                disabled={reconciling || manualOrderNumber.trim().length === 0}
              >
                Link order
              </button>
            </div>
          </article>
        )}

        <div className="detail-grid">
          <article className="detail-card">
            <span>Receipt</span>
            <strong>{sale.receiptNumber || 'N/A'}</strong>
          </article>
          <article className="detail-card">
            <span>Branch</span>
            <strong>{sale.branchId}</strong>
          </article>
          <article className="detail-card">
            <span>Terminal</span>
            <strong>{sale.terminalId}</strong>
          </article>
          <article className="detail-card">
            <span>Amount</span>
            <strong>{formatCurrency(sale.amount)}</strong>
          </article>
          <article className="detail-card">
            <span>Payment</span>
            <strong>{sale.paymentMethod || 'N/A'}</strong>
          </article>
          <article className="detail-card">
            <span>OE order</span>
            <strong>{sale.oeOrderNumber || 'Pending'}</strong>
          </article>
        </div>

        <div className="detail-list">
          <div>
            <span>Batch received</span>
            <strong>{formatDateTime(sale.batchReceivedAt)}</strong>
          </div>
          <div>
            <span>Batch processed</span>
            <strong>{sale.batchProcessedAt ? formatDateTime(sale.batchProcessedAt) : 'Not processed yet'}</strong>
          </div>
          <div>
            <span>Last attempt</span>
            <strong>{sale.batchLastAttemptAt ? formatDateTime(sale.batchLastAttemptAt) : 'No attempt recorded'}</strong>
          </div>
          <div>
            <span>Retry count</span>
            <strong>{formatNumber(sale.batchRetryCount)}</strong>
          </div>
          <div>
            <span>Sage reference</span>
            <strong>{sale.sageReference || 'N/A'}</strong>
          </div>
          <div>
            <span>Idempotency key</span>
            <strong>{sale.batchIdempotencyKey || 'N/A'}</strong>
          </div>
          <div className="detail-list-full">
            <span>Last batch error</span>
            <strong>{sale.batchLastError || 'No batch error recorded'}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function LoginScreen({ onLogin, loading }) {
  const [email, setEmail] = useState('admin@recon.local');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    const result = await onLogin({ email, password });
    if (result?.error) {
      setError(result.error);
      return;
    }

    setError('');
  }

  return (
    <div className="login-shell">
      <section className="login-panel login-brand-panel">
        <p className="eyebrow">Recon Dashboard</p>
        <h1>Finance visibility for every sale, batch, and Sage posting.</h1>
        <p className="login-copy">
          Track what has reached Sage, what is pending, and where branch or terminal-level reconciliation needs attention.
        </p>
      </section>

      <section className="login-panel login-form-panel">
        <div>
          <p className="eyebrow">Secure sign in</p>
          <h2>Login to continue</h2>
          <p className="login-copy">Credentials are now validated by Central Sync Server users, not browser-local demo state.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <FilterField label="Email address">
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </FilterField>
          <FilterField label="Password">
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </FilterField>
          {error ? <div className="inline-error">{error}</div> : null}
          <button type="submit" className="primary-button" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
        </form>
      </section>
    </div>
  );
}

function DashboardScreen({ token, onUnauthorized }) {
  const [days, setDays] = useState(14);
  const [rangeDraft, setRangeDraft] = useState({ startDate: '', endDate: '' });
  const [appliedRange, setAppliedRange] = useState({ startDate: '', endDate: '' });
  const [branchPage, setBranchPage] = useState(1);
  const [branchPageSize, setBranchPageSize] = useState(10);
  const [terminalPage, setTerminalPage] = useState(1);
  const [terminalPageSize, setTerminalPageSize] = useState(10);
  const [attentionPage, setAttentionPage] = useState(1);
  const [attentionPageSize, setAttentionPageSize] = useState(10);

  const usingCustomRange = Boolean(appliedRange.startDate || appliedRange.endDate);
  const summaryParams = usingCustomRange
    ? { startDate: appliedRange.startDate, endDate: appliedRange.endDate, limit: 20 }
    : { days, limit: 20 };
  const { data, loading, error } = useReconApi('/api/recon/summary', summaryParams, token, true, onUnauthorized);

  function selectPreset(value) {
    setDays(value);
    setRangeDraft({ startDate: '', endDate: '' });
    setAppliedRange({ startDate: '', endDate: '' });
  }

  function applyCustomRange() {
    setAppliedRange({ startDate: rangeDraft.startDate, endDate: rangeDraft.endDate });
  }

  function clearCustomRange() {
    setRangeDraft({ startDate: '', endDate: '' });
    setAppliedRange({ startDate: '', endDate: '' });
  }

  const summary = data?.summary || {
    postedSalesCount: 0,
    totalSalesCount: 0,
    totalBatches: 0,
    pendingSalesCount: 0,
    pendingBatches: 0,
    failedBatches: 0,
    totalSalesValue: 0,
    totalCreditNotesCount: 0,
    totalCreditNotesValue: 0,
    documentSummary: {},
  };
  const branchPerformance = data?.branchPerformance || [];
  const terminalPerformance = data?.terminalPerformance || [];
  const recentBatches = data?.recentBatches || [];
  const recentExports = data?.recentExports || [];
  const documentCards = useMemo(() => {
    const rows = summary?.documentSummary || {};
    return Object.entries(rows)
      .map(([key, value]) => ({ key, value }))
      .sort((left, right) => right.value - left.value);
  }, [summary]);

  const attentionBatches = useMemo(
    () => recentBatches.filter((row) => row.statusBucket !== 'completed'),
    [recentBatches]
  );
  const paginatedBranchPerformance = useMemo(
    () => paginateClientRows(branchPerformance, branchPage, branchPageSize),
    [branchPage, branchPageSize, branchPerformance]
  );
  const paginatedTerminalPerformance = useMemo(
    () => paginateClientRows(terminalPerformance, terminalPage, terminalPageSize),
    [terminalPage, terminalPageSize, terminalPerformance]
  );
  const paginatedAttentionBatches = useMemo(
    () => paginateClientRows(attentionBatches, attentionPage, attentionPageSize),
    [attentionBatches, attentionPage, attentionPageSize]
  );

  useEffect(() => {
    setBranchPage(1);
    setTerminalPage(1);
    setAttentionPage(1);
  }, [days, appliedRange.startDate, appliedRange.endDate, branchPageSize, terminalPageSize, attentionPageSize]);

  return (
    <section className="page-section">
      <div className="page-hero">
        <div>
          <p className="eyebrow">Finance 360 visibility</p>
          <h1>Dashboard</h1>
          <p className="page-copy">Summaries of reconciliation data across sales and day-end batch posting.</p>
        </div>
        <div className="dashboard-filters">
          <div className="toolbar-row compact-toolbar">
            {DASHBOARD_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={!usingCustomRange && preset.value === days ? 'filter-chip active' : 'filter-chip'}
                onClick={() => selectPreset(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="toolbar-row compact-toolbar">
            <FilterField label="From">
              <input
                type="date"
                value={rangeDraft.startDate}
                max={rangeDraft.endDate || undefined}
                onChange={(event) => setRangeDraft((current) => ({ ...current, startDate: event.target.value }))}
              />
            </FilterField>
            <FilterField label="To">
              <input
                type="date"
                value={rangeDraft.endDate}
                min={rangeDraft.startDate || undefined}
                onChange={(event) => setRangeDraft((current) => ({ ...current, endDate: event.target.value }))}
              />
            </FilterField>
            <button
              type="button"
              className="primary-button"
              onClick={applyCustomRange}
              disabled={!rangeDraft.startDate && !rangeDraft.endDate}
            >
              Apply range
            </button>
            {usingCustomRange && (
              <button type="button" className="secondary-button" onClick={clearCustomRange}>Clear</button>
            )}
          </div>
          {data?.filters && (
            <p className="filter-caption">
              Showing {String(data.filters.startDate || '').slice(0, 10)} to {String(data.filters.endDate || '').slice(0, 10)}
              {usingCustomRange ? ' (custom range)' : ` (last ${data.filters.days} days)`}
            </p>
          )}
        </div>
      </div>

      <DataState loading={loading} error={error} empty={!data?.summary}>
        <>
          <section className="metric-grid">
            <MetricCard
              label="Sales Posted To Sage"
              value={formatNumber(summary.postedSalesCount)}
              meta={`${formatNumber(summary.totalSalesCount)} captured in ${formatNumber(summary.totalBatches)} batches`}
              accent="accent-green"
            />
            <MetricCard
              label="Pending Sales"
              value={formatNumber(summary.pendingSalesCount)}
              meta={`${formatNumber(summary.pendingBatches)} batches still in flight`}
              accent="accent-amber"
            />
            <MetricCard
              label="Failed Batches"
              value={formatNumber(summary.failedBatches)}
              meta="Needs finance or ops attention"
              accent="accent-red"
            />
            <MetricCard
              label="Credit Notes"
              value={formatNumber(summary.totalCreditNotesCount)}
              meta={`${formatCurrency(summary.totalCreditNotesValue)} returned value`}
              accent="accent-amber"
            />
            <MetricCard
              label="Sales Value"
              value={formatCurrency(summary.totalSalesValue)}
              meta="Total value inside day-end batches"
            />
          </section>

          <section className="content-grid three-columns">
            <article className="panel panel-span-2">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Branch view</p>
                  <h2>Sales by branch</h2>
                </div>
                <p>Revenue, posted sales, and pending exposure per branch.</p>
              </div>
              <div className="toolbar-row compact-toolbar">
                <PageSizeField value={branchPageSize} onChange={setBranchPageSize} />
              </div>
              <PerformanceList rows={paginatedBranchPerformance.rows} valueKey="totalAmount" className="scroll-panel-list" />
              <Pagination pagination={paginatedBranchPerformance.pagination} onPageChange={setBranchPage} />
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Document mix</p>
                  <h2>Transaction volume</h2>
                </div>
                <p>Counts flowing through each Sage document stream.</p>
              </div>
              <div className="document-grid">
                {documentCards.map((card) => (
                  <article key={card.key} className="document-card">
                    <span>{titleizeDocumentType(card.key)}</span>
                    <strong>{formatNumber(card.value)}</strong>
                  </article>
                ))}
              </div>
            </article>
          </section>

          <section className="content-grid two-columns">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Terminal visibility</p>
                  <h2>Sales by terminal</h2>
                </div>
                <p>Terminal-level throughput and pending work.</p>
              </div>
              <div className="toolbar-row compact-toolbar">
                <PageSizeField value={terminalPageSize} onChange={setTerminalPageSize} />
              </div>
              <PerformanceList rows={paginatedTerminalPerformance.rows} valueKey="salesCount" className="scroll-panel-list" />
              <Pagination pagination={paginatedTerminalPerformance.pagination} onPageChange={setTerminalPage} />
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Attention queue</p>
                  <h2>Pending and failed batches</h2>
                </div>
                <p>Highest-priority items for reconciliation follow-up.</p>
              </div>
              <div className="toolbar-row compact-toolbar">
                <PageSizeField value={attentionPageSize} onChange={setAttentionPageSize} />
              </div>
              <div className="attention-list scroll-panel-list">
                {paginatedAttentionBatches.rows.length === 0 ? (
                  <div className="attention-empty">No pending or failed batches in the selected window.</div>
                ) : (
                  paginatedAttentionBatches.rows.map((batch) => (
                    <article key={batch.id} className="attention-item">
                      <div>
                        <StatusPill status={batch.status} bucket={batch.statusBucket} />
                        <h3>{batch.label}</h3>
                        <p>
                          Branch {batch.branchId} • Terminal {batch.terminalId} • {formatNumber(batch.transactionCount)} transactions
                        </p>
                      </div>
                      <div className="attention-meta">
                        <strong>{formatCurrency(batch.totalAmount)}</strong>
                        <span>{formatDateTime(batch.receivedAt)}</span>
                      </div>
                    </article>
                  ))
                )}
              </div>
              <Pagination pagination={paginatedAttentionBatches.pagination} onPageChange={setAttentionPage} />
            </article>
          </section>

          {/* <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Recent batches</p>
                <h2>Current batch monitor</h2>
              </div>
              <p>Latest OE order batches captured by the reconciliation service.</p>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Status</th>
                    <th>Branch</th>
                    <th>Terminal</th>
                    <th>Transactions</th>
                    <th>Value</th>
                    <th>Exported</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBatches.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="table-title">{row.label}</div>
                        <div className="table-subtitle">{row.idempotencyKey}</div>
                      </td>
                      <td><StatusPill status={row.status} bucket={row.statusBucket} /></td>
                      <td>{row.branchId}</td>
                      <td>{row.terminalId}</td>
                      <td>{formatNumber(row.transactionCount)}</td>
                      <td>{formatCurrency(row.totalAmount)}</td>
                      <td>{formatNumber(row.exportedCount)}</td>
                      <td>{formatDateTime(row.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section> */}

          {/* <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Recent Sage exports</p>
                <h2>Sales sent to Sage</h2>
              </div>
              <p>Recent export evidence across document types.</p>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Branch</th>
                    <th>Terminal</th>
                    <th>Document</th>
                    <th>Sage No.</th>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Exported</th>
                  </tr>
                </thead>
                <tbody>
                  {recentExports.map((row) => (
                    <tr key={`${row.id}-${row.documentType}`}>
                      <td>
                        <div className="table-title">Sale #{row.saleId}</div>
                        <div className="table-subtitle">Receipt {row.receiptNumber || 'N/A'}</div>
                      </td>
                      <td>{row.branchId}</td>
                      <td>{row.terminalId}</td>
                      <td>{titleizeDocumentType(row.documentType)}</td>
                      <td>
                        <div className="table-title">{row.sageDocumentNumber}</div>
                        <div className="table-subtitle">{row.sageDocumentUniquifier || 'No uniquifier'}</div>
                      </td>
                      <td>{row.sageReference || 'N/A'}</td>
                      <td>{formatCurrency(row.saleAmount)}</td>
                      <td>{formatDateTime(row.exportedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section> */}
        </>
      </DataState>
    </section>
  );
}

function TerminalVisibilityScreen({ token, onUnauthorized }) {
  const [days, setDays] = useState(14);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { data, loading, error } = useReconApi('/api/recon/summary', { days, limit: 20 }, token, true, onUnauthorized);
  const terminalPerformance = data?.terminalPerformance || [];
  const paginatedRows = useMemo(
    () => paginateClientRows(terminalPerformance, page, pageSize),
    [page, pageSize, terminalPerformance]
  );

  useEffect(() => {
    setPage(1);
  }, [days, pageSize]);

  return (
    <section className="page-section">
      <div className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Terminal visibility</p>
          <h1>Sales by terminal</h1>
          <p className="page-copy">Review terminal-level throughput, posted volume, and pending work across the selected period.</p>
        </div>
        <div className="toolbar-row compact-toolbar">
          {DAY_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={value === days ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setDays(value)}
            >
              Last {value} days
            </button>
          ))}
        </div>
      </div>

      <DataState loading={loading} error={error} empty={terminalPerformance.length === 0}>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Terminal register</p>
              <h2>Performance by terminal</h2>
            </div>
            <p>{formatNumber(paginatedRows.pagination.total)} terminals in the selected window.</p>
          </div>
          <div className="toolbar-row compact-toolbar">
            <PageSizeField value={pageSize} onChange={setPageSize} />
          </div>
          <PerformanceList rows={paginatedRows.rows} valueKey="salesCount" className="scroll-panel-list" />
          <Pagination pagination={paginatedRows.pagination} onPageChange={setPage} />
        </section>
      </DataState>
    </section>
  );
}

function ZraComplianceScreen({ token, onUnauthorized }) {
  const [days, setDays] = useState(14);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { data, loading, error } = useReconApi('/api/recon/zra-compliance', { days, limit: 100 }, token, true, onUnauthorized);
  const summary = data?.summary || {
    totalSalesCount: 0,
    submittedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    missingSdcCount: 0,
    receiptPrintedCount: 0,
    qrArtifactCount: 0,
    complianceRate: 0,
    printedRate: 0,
    qrRate: 0,
  };
  const terminalCompliance = data?.terminalCompliance || [];
  const paginatedRows = useMemo(
    () => paginateClientRows(terminalCompliance, page, pageSize),
    [page, pageSize, terminalCompliance]
  );

  useEffect(() => {
    setPage(1);
  }, [days, pageSize]);

  return (
    <section className="page-section">
      <div className="page-hero compact-hero">
        <div>
          <p className="eyebrow">ZRA compliance</p>
          <h1>Terminal compliance</h1>
          <p className="page-copy">ZRA compliance from day-end batch sales (same pool as the dashboard). Submitted means SDC id and ZRA receipt number are present.</p>
        </div>
        <div className="toolbar-row compact-toolbar">
          {ZRA_DAY_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={value === days ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setDays(value)}
            >
              {formatDayFilterLabel(value)}
            </button>
          ))}
        </div>
      </div>

      <DataState loading={loading} error={error} empty={terminalCompliance.length === 0}>
        <>
          <section className="metric-grid">
            <MetricCard
              label="With SDC Data"
              value={formatNumber(summary.submittedCount)}
              meta={`${formatNumber(summary.totalSalesCount)} sales in day-end batches`}
              accent="accent-green"
            />
            <MetricCard
              label="Missing SDC"
              value={formatNumber(summary.missingSdcCount)}
              meta="Sales without SDC id / ZRA receipt number"
              accent="accent-amber"
            />
            <MetricCard
              label="ZRA Failed"
              value={formatNumber(summary.failedCount)}
              meta={`${formatNumber(summary.pendingCount)} still pending ZRA`}
              accent="accent-red"
            />
            <MetricCard
              label="Compliance Rate"
              value={`${Number(summary.complianceRate || 0).toFixed(1)}%`}
              meta={`QR present on ${Number(summary.qrRate || 0).toFixed(1)}% of sales`}
            />
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Terminal register</p>
                <h2>Compliance by terminal</h2>
              </div>
              <p>{formatNumber(paginatedRows.pagination.total)} terminals in the selected window.</p>
            </div>
            <div className="toolbar-row compact-toolbar">
              <PageSizeField value={pageSize} onChange={setPageSize} />
            </div>
            <div className="table-wrap scroll-panel-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Terminal</th>
                    <th>Sales</th>
                    <th>With SDC</th>
                    <th>Missing SDC</th>
                    <th>Pending</th>
                    <th>Failed</th>
                    <th>Printed</th>
                    <th>QR</th>
                    <th>Compliance</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.branchId || 'Unassigned'}</td>
                      <td>
                        <div className="table-title">{row.terminalId || 'Unassigned'}</div>
                        <div className="table-subtitle">{row.label}</div>
                      </td>
                      <td>{formatNumber(row.totalSalesCount)}</td>
                      <td>{formatNumber(row.submittedCount)}</td>
                      <td>{formatNumber(row.missingSdcCount || 0)}</td>
                      <td>{formatNumber(row.pendingCount)}</td>
                      <td>{formatNumber(row.failedCount)}</td>
                      <td>{formatNumber(row.receiptPrintedCount)}</td>
                      <td>{formatNumber(row.qrArtifactCount)}</td>
                      <td>
                        <StatusPill status={`${Number(row.complianceRate || 0).toFixed(1)}%`} bucket={complianceBucket(row.complianceRate || 0)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination pagination={paginatedRows.pagination} onPageChange={setPage} />
          </section>
        </>
      </DataState>
    </section>
  );
}

function AttentionQueueScreen({ token, onUnauthorized, currentUser }) {
  const [days, setDays] = useState(14);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingRequeueIds, setPendingRequeueIds] = useState([]);
  const [pendingReconcileIds, setPendingReconcileIds] = useState([]);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const { data, loading, error } = useReconApi(
    '/api/recon/summary',
    { days, limit: 20, refreshKey },
    token,
    true,
    onUnauthorized
  );
  const attentionBatches = useMemo(
    () => (data?.recentBatches || []).filter((row) => row.statusBucket !== 'completed'),
    [data]
  );
  const paginatedRows = useMemo(
    () => paginateClientRows(attentionBatches, page, pageSize),
    [attentionBatches, page, pageSize]
  );

  useEffect(() => {
    setPage(1);
  }, [days, pageSize]);

  async function requeueBatch(batchId) {
    if (!currentUser?.role || currentUser.role !== 'admin') {
      setActionError('Only admin users may retry failed batches.');
      return;
    }

    setActionMessage('');
    setActionError('');
    setPendingRequeueIds((current) => [...current, batchId]);

    try {
      await requestJson(`/api/recon/batches/${batchId}/requeue`, {
        method: 'POST',
        token,
      });
      setActionMessage(`Requeue requested for batch ${batchId}.`);
      setRefreshKey((current) => current + 1);
    } catch (requeueError) {
      setActionError(requeueError.message || 'Failed to requeue batch.');
    } finally {
      setPendingRequeueIds((current) => current.filter((id) => id !== batchId));
    }
  }

  async function reconcileBatch(batchId) {
    if (!currentUser?.role || currentUser.role !== 'admin') {
      setActionError('Only admin users may reconcile batches with Sage.');
      return;
    }

    setActionMessage('');
    setActionError('');
    setPendingReconcileIds((current) => [...current, batchId]);

    try {
      const result = await requestJson(`/api/recon/batches/${batchId}/reconcile`, {
        method: 'POST',
        token,
      });
      if (result?.success) {
        setActionMessage(result.message || `Batch ${batchId} reconciled with Sage.`);
        setRefreshKey((current) => current + 1);
      } else {
        setActionError(result?.message || `No matching Sage order found for batch ${batchId}.`);
      }
    } catch (reconcileError) {
      setActionError(reconcileError.message || 'Failed to reconcile batch with Sage.');
    } finally {
      setPendingReconcileIds((current) => current.filter((id) => id !== batchId));
    }
  }

  async function requeueVisibleBatches() {
    if (!currentUser?.role || currentUser.role !== 'admin') {
      setActionError('Only admin users may retry failed batches.');
      return;
    }

    setActionMessage('');
    setActionError('');
    const visibleIds = paginatedRows.rows.map((batch) => batch.id);
    if (visibleIds.length === 0) {
      setActionError('No visible batches available to retry.');
      return;
    }

    setPendingRequeueIds(visibleIds);
    try {
      await Promise.all(
        visibleIds.map(async (batchId) => {
          await requestJson(`/api/recon/batches/${batchId}/requeue`, {
            method: 'POST',
            token,
          });
        })
      );
      setActionMessage(`Retry requested for ${visibleIds.length} visible batch(es).`);
      setRefreshKey((current) => current + 1);
    } catch (bulkError) {
      setActionError(bulkError.message || 'Failed to retry visible batches.');
    } finally {
      setPendingRequeueIds([]);
    }
  }

  return (
    <section className="page-section">
      <div className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Attention queue</p>
          <h1>Pending and failed batches</h1>
          <p className="page-copy">Focus finance follow-up on batches that are still pending or have failed during synchronization.</p>
        </div>
        <div className="toolbar-row compact-toolbar">
          {DAY_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={value === days ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setDays(value)}
            >
              Last {value} days
            </button>
          ))}
        </div>
      </div>

      <DataState loading={loading} error={error} empty={attentionBatches.length === 0}>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Reconciliation follow-up</p>
              <h2>Attention queue</h2>
            </div>
            <p>{formatNumber(paginatedRows.pagination.total)} batches currently need attention.</p>
          </div>
          <div className="toolbar-row compact-toolbar">
            <PageSizeField value={pageSize} onChange={setPageSize} />
            {currentUser?.role === 'admin' && (
              <button
                type="button"
                className="secondary-button"
                onClick={requeueVisibleBatches}
                disabled={pendingRequeueIds.length > 0}
              >
                {pendingRequeueIds.length > 0 ? 'Retrying batches...' : 'Retry visible batches'}
              </button>
            )}
          </div>
          {actionMessage && <div className="message success-message">{actionMessage}</div>}
          {actionError && <div className="message error-message">{actionError}</div>}
          <div className="attention-list scroll-panel-list">
            {paginatedRows.rows.map((batch) => (
              <article key={batch.id} className="attention-item">
                <div>
                  <StatusPill status={batch.status} bucket={batch.statusBucket} />
                  <h3>{batch.label}</h3>
                  <p>
                    Branch {batch.branchId} • Terminal {batch.terminalId} • {formatNumber(batch.transactionCount)} transactions
                  </p>
                  {batch.lastError && (
                    <p className="attention-error">{batch.lastError}</p>
                  )}
                </div>
                <div className="attention-meta">
                  <strong>{formatCurrency(batch.totalAmount)}</strong>
                  <span>{formatDateTime(batch.receivedAt)}</span>
                  {currentUser?.role === 'admin' && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => requeueBatch(batch.id)}
                      disabled={pendingRequeueIds.includes(batch.id)}
                    >
                      {pendingRequeueIds.includes(batch.id) ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                  {currentUser?.role === 'admin' && batch.eventType === 'day_end.ready' && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => reconcileBatch(batch.id)}
                      disabled={pendingReconcileIds.includes(batch.id)}
                    >
                      {pendingReconcileIds.includes(batch.id) ? 'Reconciling…' : 'Reconcile with Sage'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <Pagination pagination={paginatedRows.pagination} onPageChange={setPage} />
        </section>
      </DataState>
    </section>
  );
}

function SalesScreen({ token, onUnauthorized, currentUser }) {
  const [filters, setFilters] = useState({
    branchId: '',
    terminalId: '',
    startDate: '',
    endDate: '',
    page: 1,
    pageSize: 10,
    refreshKey: 0,
  });
  const [selectedSale, setSelectedSale] = useState(null);
  const [reconcilingIds, setReconcilingIds] = useState([]);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const { data, loading, error } = useReconApi('/api/recon/sales', filters, token, true, onUnauthorized);
  const rows = data?.rows || [];
  const filterMeta = data?.filters || {};
  const isAdmin = currentUser?.role === 'admin';

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? value : 1,
    }));
  }

  async function downloadSalesReport() {
    setExportError('');
    setExporting(true);

    try {
      await downloadFile('/api/recon/sales/export', {
        token,
        params: {
          branchId: filters.branchId,
          terminalId: filters.terminalId,
          startDate: filters.startDate,
          endDate: filters.endDate,
        },
      });
    } catch (downloadError) {
      if (downloadError.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      setExportError(downloadError.message || 'Failed to download the sales report.');
    } finally {
      setExporting(false);
    }
  }

  async function reconcileSale(sale, options = {}) {
    if (!isAdmin) {
      setActionError('Only admin users may reconcile sales with Sage.');
      return;
    }

    setActionMessage('');
    setActionError('');
    setReconcilingIds((current) => [...current, sale.id]);

    try {
      const result = await requestJson(`/api/recon/batches/${sale.syncEventId}/reconcile`, {
        method: 'POST',
        token,
        body: options,
      });

      if (result?.found === false || result?.success === false) {
        setActionError(result?.message || `No Sage reference found for sale #${sale.saleId}.`);
      } else {
        setActionMessage(result?.message || `Sale #${sale.saleId} reconciled with Sage.`);
        setSelectedSale(null);
        setFilters((current) => ({ ...current, refreshKey: (current.refreshKey || 0) + 1 }));
      }
    } catch (reconcileError) {
      if (reconcileError.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      setActionError(reconcileError.message || 'Failed to reconcile with Sage.');
    } finally {
      setReconcilingIds((current) => current.filter((id) => id !== sale.id));
    }
  }

  return (
    <section className="page-section">
      <div className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Sales detail</p>
          <h1>Sales</h1>
          <p className="page-copy">List all sales with branch, terminal, date, Sage posting details, and pending reasons.</p>
        </div>
      </div>

      <section className="panel filter-panel">
        <div className="filter-grid four-columns">
          <FilterField label="Branch">
            <select value={filters.branchId} onChange={(event) => updateFilter('branchId', event.target.value)}>
              <option value="">All branches</option>
              {(filterMeta.branchOptions || []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Terminal">
            <select value={filters.terminalId} onChange={(event) => updateFilter('terminalId', event.target.value)}>
              <option value="">All terminals</option>
              {(filterMeta.terminalOptions || []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Start date">
            <input type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
          </FilterField>
          <FilterField label="End date">
            <input type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
          </FilterField>
        </div>
        <div className="toolbar-row compact-toolbar">
          <PageSizeField value={filters.pageSize} onChange={(value) => updateFilter('pageSize', value)} />
          <button
            type="button"
            className="primary-button"
            onClick={downloadSalesReport}
            disabled={exporting}
            title="Download a clean sales report grouped by branch (Excel)"
          >
            {exporting ? 'Preparing report…' : 'Download Excel (by branch)'}
          </button>
        </div>
        {exportError && <p className="action-feedback error">{exportError}</p>}
      </section>

      <DataState loading={loading} error={error} empty={rows.length === 0}>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Sales ledger</p>
              <h2>All sales in scope</h2>
            </div>
            <p>{formatNumber(data?.pagination?.total || 0)} sales matching the selected filters.</p>
          </div>
          {(actionMessage || actionError) && (
            <p className={actionError ? 'action-feedback error' : 'action-feedback success'}>
              {actionError || actionMessage}
            </p>
          )}
          <div className="table-wrap scroll-panel-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>Branch</th>
                  <th>Terminal</th>
                  <th>Date</th>
                  <th>Payment</th>
                  <th>Amount</th>
                  <th>OE Order</th>
                  <th>Batch Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="table-title">Sale #{row.saleId}</div>
                      <div className="table-subtitle">Receipt {row.receiptNumber || 'N/A'}</div>
                    </td>
                    <td>{row.branchId}</td>
                    <td>{row.terminalId}</td>
                    <td>
                      <div className="table-title">{formatShortDate(row.saleDate)}</div>
                      <div className="table-subtitle">{formatDateTime(row.batchReceivedAt)}</div>
                    </td>
                    <td>{row.paymentMethod || 'N/A'}</td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td>{row.oeOrderNumber || 'Pending'}</td>
                    <td><StatusPill status={row.batchStatus} bucket={row.batchStatusBucket} /></td>
                    <td>
                      <div className="action-cell">
                        <button type="button" className="secondary-button details-button" onClick={() => setSelectedSale(row)}>
                          View details
                        </button>
                        {!row.postedToSage && isAdmin && (
                          <button
                            type="button"
                            className="primary-button details-button"
                            onClick={() => reconcileSale(row)}
                            disabled={reconcilingIds.includes(row.id)}
                          >
                            {reconcilingIds.includes(row.id) ? 'Reconciling...' : 'Reconcile with Sage'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pagination={data?.pagination} onPageChange={(page) => updateFilter('page', page)} />
        </section>
      </DataState>
      <SaleDetailsDialog
        sale={selectedSale}
        onClose={() => setSelectedSale(null)}
        onReconcile={reconcileSale}
        reconciling={selectedSale ? reconcilingIds.includes(selectedSale.id) : false}
        canReconcile={isAdmin}
      />
    </section>
  );
}

function CreditNotesScreen({ token, onUnauthorized }) {
  const [filters, setFilters] = useState({
    branchId: '',
    terminalId: '',
    startDate: '',
    endDate: '',
    page: 1,
    pageSize: 10,
    refreshKey: 0,
  });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const { data, loading, error } = useReconApi('/api/recon/credit-notes', filters, token, true, onUnauthorized);
  const rows = data?.rows || [];
  const filterMeta = data?.filters || {};

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? value : 1,
    }));
  }

  async function downloadCreditNoteReport() {
    setExportError('');
    setExporting(true);

    try {
      await downloadFile('/api/recon/credit-notes/export', {
        token,
        params: {
          branchId: filters.branchId,
          terminalId: filters.terminalId,
          startDate: filters.startDate,
          endDate: filters.endDate,
        },
      });
    } catch (downloadError) {
      if (downloadError.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      setExportError(downloadError.message || 'Failed to download the credit note report.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="page-section">
      <div className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Returned documents</p>
          <h1>Credit Notes</h1>
          <p className="page-copy">List all returned credit notes with branch, terminal, date, reason, value, and Sage posting status.</p>
        </div>
      </div>

      <section className="panel filter-panel">
        <div className="filter-grid four-columns">
          <FilterField label="Branch">
            <select value={filters.branchId} onChange={(event) => updateFilter('branchId', event.target.value)}>
              <option value="">All branches</option>
              {(filterMeta.branchOptions || []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Terminal">
            <select value={filters.terminalId} onChange={(event) => updateFilter('terminalId', event.target.value)}>
              <option value="">All terminals</option>
              {(filterMeta.terminalOptions || []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Start date">
            <input type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
          </FilterField>
          <FilterField label="End date">
            <input type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
          </FilterField>
        </div>
        <div className="toolbar-row compact-toolbar">
          <PageSizeField value={filters.pageSize} onChange={(value) => updateFilter('pageSize', value)} />
          <button
            type="button"
            className="primary-button"
            onClick={downloadCreditNoteReport}
            disabled={exporting}
            title="Download a clean credit note report grouped by branch (Excel)"
          >
            {exporting ? 'Preparing report…' : 'Download Excel (by branch)'}
          </button>
        </div>
        {exportError && <p className="action-feedback error">{exportError}</p>}
      </section>

      <DataState loading={loading} error={error} empty={rows.length === 0}>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Credit note ledger</p>
              <h2>All returned credit notes in scope</h2>
            </div>
            <p>{formatNumber(data?.pagination?.total || 0)} credit notes matching the selected filters.</p>
          </div>
          <div className="table-wrap scroll-panel-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Credit Note</th>
                  <th>Branch</th>
                  <th>Terminal</th>
                  <th>Date</th>
                  <th>Reason</th>
                  <th>Payment</th>
                  <th>Amount</th>
                  <th>Sage Doc</th>
                  <th>Batch Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="table-title">Receipt {row.receiptNumber || 'N/A'}</div>
                      <div className="table-subtitle">{row.originalSaleId ? `From sale #${row.originalSaleId}` : 'No linked sale'}</div>
                    </td>
                    <td>{row.branchId}</td>
                    <td>{row.terminalId}</td>
                    <td>
                      <div className="table-title">{formatShortDate(row.creditNoteDate)}</div>
                      <div className="table-subtitle">{formatDateTime(row.batchReceivedAt)}</div>
                    </td>
                    <td>{row.reason || 'N/A'}</td>
                    <td>{row.paymentMethod || 'N/A'}</td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td>{row.sageDocumentNumber || 'Pending'}</td>
                    <td><StatusPill status={row.batchStatus} bucket={row.batchStatusBucket} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pagination={data?.pagination} onPageChange={(page) => updateFilter('page', page)} />
        </section>
      </DataState>
    </section>
  );
}

function RepostPendingPanel({ token, onUnauthorized }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [limit, setLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function call(dryRun) {
    setBusy(true);
    setError('');
    setMessage('');
    if (dryRun) {
      setResults(null);
    }

    try {
      const payload = await requestJson('/api/recon/batches/repost-pending', {
        method: 'POST',
        token,
        body: { startDate, endDate, dryRun, limit },
      });

      if (dryRun) {
        setScan(payload);
        setMessage(`${payload.totalCandidates} batch(es) completed locally but were never posted to Sage.`);
      } else {
        setResults(payload);
        const ok = (payload.results || []).filter((row) => row.success).length;
        setMessage(`Re-posted ${ok} of ${payload.processed} batch(es). ${payload.remaining} still remaining.`);
      }
    } catch (callError) {
      if (callError.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      setError(callError.message || 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel filter-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Maintenance</p>
          <h2>Re-post unposted batches</h2>
        </div>
        <p>Find day-end batches marked complete locally that never reached Sage, then re-post them.</p>
      </div>
      <div className="filter-grid four-columns">
        <FilterField label="Start date">
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </FilterField>
        <FilterField label="End date">
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </FilterField>
        <FilterField label="Max to re-post">
          <input type="number" min="1" max="200" value={limit} onChange={(event) => setLimit(Number(event.target.value) || 1)} />
        </FilterField>
      </div>
      <div className="correction-actions">
        <button type="button" className="secondary-button" onClick={() => call(true)} disabled={busy}>
          {busy ? 'Working...' : 'Scan'}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => call(false)}
          disabled={busy || !scan || scan.totalCandidates === 0}
        >
          {busy ? 'Working...' : `Re-post ${scan ? Math.min(scan.totalCandidates, limit) : ''}`.trim()}
        </button>
      </div>
      {(message || error) && (
        <p className={error ? 'action-feedback error' : 'action-feedback success'}>{error || message}</p>
      )}
      {scan && scan.candidates && scan.candidates.length > 0 && !results && (
        <div className="table-wrap scroll-panel-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Branch</th>
                <th>Terminal</th>
                <th>Status</th>
                <th>Pending sales</th>
              </tr>
            </thead>
            <tbody>
              {scan.candidates.map((row) => (
                <tr key={row.eventId}>
                  <td>
                    <div className="table-title">#{row.eventId}</div>
                    <div className="table-subtitle">{row.idempotencyKey}</div>
                  </td>
                  <td>{row.branchId}</td>
                  <td>{row.terminalId}</td>
                  <td>{row.status}</td>
                  <td>{formatNumber(row.pendingCount)} / {formatNumber(row.salesCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {results && results.results && results.results.length > 0 && (
        <div className="table-wrap scroll-panel-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Branch</th>
                <th>Result</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {results.results.map((row) => (
                <tr key={row.eventId}>
                  <td>
                    <div className="table-title">#{row.eventId}</div>
                    <div className="table-subtitle">{row.idempotencyKey}</div>
                  </td>
                  <td>{row.branchId}</td>
                  <td>{row.success ? `Posted (${formatNumber(row.reconciledCount)})` : `Failed: ${row.message || ''}`}</td>
                  <td>{row.orderNumber || 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BatchesScreen({ title, eventType, eyebrow, token, onUnauthorized, currentUser }) {
  const [filters, setFilters] = useState(() => createBatchFilters(eventType));
  const { data, loading, error } = useReconApi('/api/recon/batches', filters, token, true, onUnauthorized);
  const rows = data?.rows || [];
  const filterMeta = data?.filters || {};

  useEffect(() => {
    setFilters(createBatchFilters(eventType));
  }, [eventType]);

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? value : 1,
    }));
  }

  return (
    <section className="page-section">
      <div className="page-hero compact-hero">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-copy">Filter and paginate batch activity by branch, terminal, status, and date.</p>
        </div>
      </div>

      {eventType === 'day_end.ready' && currentUser?.role === 'admin' && (
        <RepostPendingPanel token={token} onUnauthorized={onUnauthorized} />
      )}

      <section className="panel filter-panel">
        <div className="filter-grid five-columns">
          <FilterField label="Branch">
            <select value={filters.branchId} onChange={(event) => updateFilter('branchId', event.target.value)}>
              <option value="">All branches</option>
              {(filterMeta.branchOptions || []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Terminal">
            <select value={filters.terminalId} onChange={(event) => updateFilter('terminalId', event.target.value)}>
              <option value="">All terminals</option>
              {(filterMeta.terminalOptions || []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Status">
            <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">All statuses</option>
              {(filterMeta.statusOptions || []).map((option) => (
                <option key={option} value={option}>{slugToTitle(option)}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Start date">
            <input type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
          </FilterField>
          <FilterField label="End date">
            <input type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
          </FilterField>
        </div>
        <div className="toolbar-row compact-toolbar">
          <PageSizeField value={filters.pageSize} onChange={(value) => updateFilter('pageSize', value)} />
        </div>
      </section>

      <DataState loading={loading} error={error} empty={rows.length === 0}>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Batch register</p>
              <h2>{title}</h2>
            </div>
            <p>{formatNumber(data?.pagination?.total || 0)} batches found.</p>
          </div>
          <div className="table-wrap scroll-panel-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Status</th>
                  <th>Branch</th>
                  <th>Terminal</th>
                  <th>Transactions</th>
                  <th>Value</th>
                  <th>Exported</th>
                  <th>Retries</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="table-title">{row.label}</div>
                      <div className="table-subtitle">{row.idempotencyKey}</div>
                    </td>
                    <td><StatusPill status={row.status} bucket={row.statusBucket} /></td>
                    <td>{row.branchId}</td>
                    <td>{row.terminalId}</td>
                    <td>{formatNumber(row.transactionCount)}</td>
                    <td>{formatCurrency(row.totalAmount)}</td>
                    <td>{formatNumber(row.exportedCount)}</td>
                    <td>{formatNumber(row.retryCount)}</td>
                    <td>{formatDateTime(row.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pagination={data?.pagination} onPageChange={(page) => updateFilter('page', page)} />
        </section>
      </DataState>
    </section>
  );
}

function UserManagementScreen({ token, currentUser, onUnauthorized }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'finance',
  });

  useEffect(() => {
    if (currentUser.role !== 'admin') {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();

    async function loadUsers() {
      setLoading(true);
      setError('');

      try {
        const payload = await requestJson('/api/recon/auth/users', {
          token,
          signal: controller.signal,
        });
        setUsers(payload.users || []);
      } catch (loadError) {
        if (loadError.name === 'AbortError') {
          return;
        }

        if (loadError.status === 401 && onUnauthorized) {
          onUnauthorized();
        }

        setError(loadError.message || 'Failed to load users');
      } finally {
        setLoading(false);
      }
    }

    loadUsers();

    return () => controller.abort();
  }, [token, currentUser.role]);

  const paginatedUsers = useMemo(
    () => paginateClientRows(users, page, pageSize),
    [page, pageSize, users]
  );

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  if (currentUser.role !== 'admin') {
    return (
      <section className="page-section">
        <div className="page-hero compact-hero">
          <div>
            <p className="eyebrow">Access control</p>
            <h1>User Management</h1>
            <p className="page-copy">Only recon admins can manage dashboard users.</p>
          </div>
        </div>
        <section className="panel">
          <div className="attention-empty">Your current role does not allow user administration.</div>
        </section>
      </section>
    );
  }

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createUser(event) {
    event.preventDefault();
    setMessage('');
    setError('');

    try {
      const payload = await requestJson('/api/recon/auth/users', {
        method: 'POST',
        token,
        body: form,
      });
      setUsers((current) => [...current, payload.user]);
      setForm({ fullName: '', email: '', password: '', role: 'finance' });
      setMessage('User created.');
    } catch (requestError) {
      if (requestError.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      setError(requestError.message || 'Failed to create user');
    }
  }

  async function toggleActive(targetUser) {
    setMessage('');
    setError('');

    try {
      const payload = await requestJson(`/api/recon/auth/users/${targetUser.id}`, {
        method: 'PATCH',
        token,
        body: { active: !targetUser.active },
      });
      setUsers((current) => current.map((user) => (user.id === payload.user.id ? payload.user : user)));
    } catch (requestError) {
      if (requestError.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      setError(requestError.message || 'Failed to update user');
    }
  }

  async function deleteUser(targetUser) {
    setMessage('');
    setError('');

    try {
      await requestJson(`/api/recon/auth/users/${targetUser.id}`, {
        method: 'DELETE',
        token,
      });
      setUsers((current) => current.filter((user) => user.id !== targetUser.id));
    } catch (requestError) {
      if (requestError.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      setError(requestError.message || 'Failed to delete user');
    }
  }

  return (
    <section className="page-section">
      <div className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Dashboard access</p>
          <h1>User Management</h1>
          <p className="page-copy">Manage sync-server finance users, roles, and activation status.</p>
        </div>
      </div>

      <DataState loading={loading} error={error} empty={false}>
        <section className="content-grid two-columns">
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Create user</p>
                <h2>Add dashboard access</h2>
              </div>
            </div>
            <form className="user-form" onSubmit={createUser}>
              <FilterField label="Full name">
                <input value={form.fullName} onChange={(event) => updateForm('fullName', event.target.value)} required />
              </FilterField>
              <FilterField label="Email">
                <input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} required />
              </FilterField>
              <FilterField label="Temporary password">
                <input type="text" value={form.password} onChange={(event) => updateForm('password', event.target.value)} required />
              </FilterField>
              <FilterField label="Role">
                <select value={form.role} onChange={(event) => updateForm('role', event.target.value)}>
                  <option value="finance">Finance</option>
                  <option value="admin">Admin</option>
                </select>
              </FilterField>
              {message ? <div className="inline-note">{message}</div> : null}
              <button type="submit" className="primary-button">Create user</button>
            </form>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Current users</p>
                <h2>Access register</h2>
              </div>
            </div>
            <div className="toolbar-row compact-toolbar">
              <PageSizeField value={pageSize} onChange={setPageSize} />
            </div>
            <div className="user-list scroll-panel-list">
              {paginatedUsers.rows.map((user) => (
                <article key={user.id} className="user-card">
                  <div>
                    <h3>{user.fullName}</h3>
                    <p>{user.email}</p>
                  </div>
                  <div className="user-meta">
                    <span className="role-pill">{slugToTitle(user.role)}</span>
                    <span className={user.active ? 'status-text active' : 'status-text inactive'}>
                      {user.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="user-actions">
                    <button type="button" className="secondary-button" onClick={() => toggleActive(user)}>
                      {user.active ? 'Deactivate' : 'Activate'}
                    </button>
                    {user.id !== currentUser.id ? (
                      <button type="button" className="secondary-button danger-button" onClick={() => deleteUser(user)}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <Pagination pagination={paginatedUsers.pagination} onPageChange={setPage} />
          </article>
        </section>
      </DataState>
    </section>
  );
}

function ReleaseManagementScreen({ token, currentUser, onUnauthorized }) {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    version: '',
    releaseNotes: '',
    mandatory: false,
    installerFile: null,
  });

  async function loadManifest(signal) {
    setLoading(true);
    setError('');

    try {
      const payload = await requestJson('/updates/version.json', { signal });
      setManifest(payload);
    } catch (loadError) {
      if (loadError.name === 'AbortError') {
        return;
      }

      if (loadError.status === 401 && onUnauthorized) {
        onUnauthorized();
        return;
      }

      if (loadError.status === 404) {
        setManifest(null);
        return;
      }

      setError(loadError.message || 'Failed to load published release');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentUser.role !== 'admin') {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    loadManifest(controller.signal);
    return () => controller.abort();
  }, [token, currentUser.role]);

  if (currentUser.role !== 'admin') {
    return (
      <section className="page-section">
        <div className="page-hero compact-hero">
          <div>
            <p className="eyebrow">Access control</p>
            <h1>Release Management</h1>
            <p className="page-copy">Only recon admins can publish new POS installers.</p>
          </div>
        </div>
        <section className="panel">
          <div className="attention-empty">Your current role does not allow release publishing.</div>
        </section>
      </section>
    );
  }

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handlePublish(event) {
    event.preventDefault();
    setPublishing(true);
    setError('');
    setMessage('');

    if (!form.version.trim()) {
      setPublishing(false);
      setError('Version is required.');
      return;
    }

    if (!form.installerFile) {
      setPublishing(false);
      setError('Choose the setup executable to publish.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/updates/admin/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'x-update-version': form.version.trim(),
          'x-file-name': form.installerFile.name,
          'x-release-notes': form.releaseNotes.trim(),
          'x-update-mandatory': String(form.mandatory),
        },
        body: form.installerFile,
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;

      if (!response.ok) {
        const requestError = new Error(payload?.message || `Request failed with ${response.status}`);
        requestError.status = response.status;
        throw requestError;
      }

      setManifest(payload?.update || null);
      setForm({
        version: '',
        releaseNotes: '',
        mandatory: false,
        installerFile: null,
      });
      setMessage('Release published. POS clients will see it on their next update check.');
    } catch (requestError) {
      if (requestError.status === 401 && onUnauthorized) {
        onUnauthorized();
        return;
      }

      setError(requestError.message || 'Failed to publish release');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="page-section">
      <div className="page-hero compact-hero">
        <div>
          <p className="eyebrow">POS delivery</p>
          <h1>Release Management</h1>
          <p className="page-copy">Upload a new Windows installer and make it available to all POS machines through the existing updater flow.</p>
        </div>
      </div>

      <DataState loading={loading} error={error} empty={false}>
        <section className="content-grid two-columns">
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Publish update</p>
                <h2>Upload installer</h2>
              </div>
            </div>

            <form className="user-form" onSubmit={handlePublish}>
              <FilterField label="Version">
                <input
                  value={form.version}
                  onChange={(event) => updateForm('version', event.target.value)}
                  placeholder="e.g. 1.2.3"
                  required
                />
              </FilterField>
              <FilterField label="Release notes">
                <textarea
                  rows="5"
                  value={form.releaseNotes}
                  onChange={(event) => updateForm('releaseNotes', event.target.value)}
                  placeholder="What changed in this build?"
                />
              </FilterField>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.mandatory}
                  onChange={(event) => updateForm('mandatory', event.target.checked)}
                />
                <span>Force POS terminals to install this update when detected.</span>
              </label>
              <label className="upload-field">
                <span className="upload-label">Installer file</span>
                <input
                  type="file"
                  accept=".exe"
                  onChange={(event) => updateForm('installerFile', event.target.files?.[0] || null)}
                  required
                />
                <span className="upload-meta">
                  {form.installerFile ? `${form.installerFile.name} • ${formatBytes(form.installerFile.size)}` : 'Select the built Windows setup executable.'}
                </span>
              </label>
              {message ? <div className="inline-note">{message}</div> : null}
              <button type="submit" className="primary-button" disabled={publishing}>
                {publishing ? 'Publishing...' : 'Publish release'}
              </button>
            </form>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Current release</p>
                <h2>Published manifest</h2>
              </div>
            </div>

            {manifest ? (
              <div className="release-summary">
                <article className="release-highlight-card">
                  <div>
                    <p className="eyebrow">Live version</p>
                    <h3>{manifest.version}</h3>
                  </div>
                  <span className={manifest.mandatory ? 'status-pill tone-red' : 'status-pill tone-green'}>
                    {manifest.mandatory ? 'Mandatory' : 'Optional'}
                  </span>
                </article>

                <div className="detail-list release-detail-list">
                  <div>
                    <span>Published</span>
                    <strong>{formatDateTime(manifest.publishedAt)}</strong>
                  </div>
                  <div>
                    <span>Installer</span>
                    <strong>{manifest.fileName || 'Unknown'}</strong>
                  </div>
                  <div>
                    <span>Size</span>
                    <strong>{formatBytes(manifest.fileSize)}</strong>
                  </div>
                  <div>
                    <span>Download</span>
                    <strong>
                      <a href={manifest.downloadUrl} target="_blank" rel="noreferrer">Download installer</a>
                    </strong>
                  </div>
                  <div className="detail-list-full">
                    <span>Release notes</span>
                    <strong>{manifest.releaseNotes || 'No release notes provided.'}</strong>
                  </div>
                </div>
              </div>
            ) : (
              <div className="attention-empty">No installer has been published yet. Upload the first release to activate POS auto-updates.</div>
            )}
          </article>
        </section>
      </DataState>
    </section>
  );
}

function AppShell({ activeMenu, onMenuChange, currentUser, onLogout, children }) {
  const currentMenu = MENU_ITEMS.find((item) => item.key === activeMenu);
  const [openGroups, setOpenGroups] = useState(() => ({ [getGroupKeyForMenu(activeMenu)]: true }));

  useEffect(() => {
    const groupKey = getGroupKeyForMenu(activeMenu);
    setOpenGroups((current) => (current[groupKey] ? current : { ...current, [groupKey]: true }));
  }, [activeMenu]);

  function toggleGroup(groupKey) {
    setOpenGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }));
  }

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <p className="eyebrow">Recon Dashboard</p>
          <h2>Finance workspace</h2>
        </div>
        <nav className="sidebar-nav">
          {MENU_GROUPS.map((group) => {
            const isOpen = Boolean(openGroups[group.key]);
            const hasActive = group.items.some((item) => item.key === activeMenu);
            return (
              <div key={group.key} className={`sidebar-group${isOpen ? ' open' : ''}`}>
                <button
                  type="button"
                  className={`sidebar-group-header${hasActive ? ' has-active' : ''}`}
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={isOpen}
                >
                  <span>{group.label}</span>
                  <span className="sidebar-group-caret" aria-hidden="true">{isOpen ? '\u2212' : '+'}</span>
                </button>
                {isOpen && (
                  <div className="sidebar-group-items">
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={item.key === activeMenu ? 'sidebar-link active' : 'sidebar-link'}
                        onClick={() => onMenuChange(item.key)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <strong>{currentUser.fullName}</strong>
          <span>{currentUser.email}</span>
          <button type="button" className="secondary-button" onClick={onLogout}>Logout</button>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Current section</p>
            <h2>{currentMenu?.label || 'Dashboard'}</h2>
          </div>
          <div className="topbar-meta">
            <span>API: {API_BASE_URL}</span>
            <span>Role: {slugToTitle(currentUser.role)}</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(() => readStoredSession());
  const [activeMenu, setActiveMenu] = useState(() => getMenuFromPath(window.location.pathname));
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    function handlePopState() {
      setActiveMenu(getMenuFromPath(window.location.pathname));
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (session) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      if (window.location.pathname === '/' || window.location.pathname === '/login') {
        navigateToPath('/dashboard', true);
        setActiveMenu('dashboard');
      }
      return;
    }

    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    if (window.location.pathname !== '/login') {
      navigateToPath('/login', true);
    }
  }, [session]);

  async function refreshCurrentUser(token) {
    const payload = await requestJson('/api/recon/auth/me', { token });
    return payload.user;
  }

  async function handleLogin(credentials) {
    setLoginLoading(true);

    try {
      const payload = await requestJson('/api/recon/auth/login', {
        method: 'POST',
        body: credentials,
      });
      setSession({ token: payload.token, user: payload.user });
      navigateToPath('/dashboard');
      setActiveMenu('dashboard');
      return { ok: true };
    } catch (loginError) {
      return { error: loginError.message || 'Login failed' };
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    setSession(null);
    setActiveMenu('dashboard');
  }

  function handleUnauthorized() {
    setSession(null);
  }

  useEffect(() => {
    if (!session?.token) {
      return undefined;
    }

    let cancelled = false;

    async function validateSession() {
      try {
        const user = await refreshCurrentUser(session.token);
        if (!cancelled) {
          setSession((current) => current ? { ...current, user } : current);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
        }
      }
    }

    validateSession();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleMenuChange(menuKey) {
    const item = MENU_ITEMS.find((entry) => entry.key === menuKey);
    if (!item) {
      return;
    }

    setActiveMenu(menuKey);
    navigateToPath(item.path);
  }

  function renderActivePage() {
    if (!session?.user) {
      return null;
    }

    switch (activeMenu) {
      case 'sales':
        return <SalesScreen token={session.token} onUnauthorized={handleUnauthorized} currentUser={session.user} />;
      case 'credit-notes':
        return <CreditNotesScreen token={session.token} onUnauthorized={handleUnauthorized} currentUser={session.user} />;
      case 'terminal-visibility':
        return <TerminalVisibilityScreen token={session.token} onUnauthorized={handleUnauthorized} />;
      case 'zra-compliance':
        return <ZraComplianceScreen token={session.token} onUnauthorized={handleUnauthorized} />;
      case 'attention-queue':
        return <AttentionQueueScreen token={session.token} onUnauthorized={handleUnauthorized} currentUser={session.user} />;
      case 'day-end-batches':
        return <BatchesScreen title="Day End Batches" eventType="day_end.ready" eyebrow="Batch operations" token={session.token} onUnauthorized={handleUnauthorized} currentUser={session.user} />;
      case 'credit-note-batches':
        return <BatchesScreen title="Credit Note Returns" eventType="credit_note_batch.ready" eyebrow="Returned document syncs" token={session.token} onUnauthorized={handleUnauthorized} currentUser={session.user} />;
      case 'release-management':
        return <ReleaseManagementScreen token={session.token} currentUser={session.user} onUnauthorized={handleUnauthorized} />;
      case 'user-management':
        return <UserManagementScreen token={session.token} currentUser={session.user} onUnauthorized={handleUnauthorized} />;
      case 'dashboard':
      default:
        return <DashboardScreen token={session.token} onUnauthorized={handleUnauthorized} />;
    }
  }

  if (!session?.user) {
    return <LoginScreen onLogin={handleLogin} loading={loginLoading} />;
  }

  return (
    <AppShell
      activeMenu={activeMenu}
      onMenuChange={handleMenuChange}
      currentUser={session.user}
      onLogout={handleLogout}
    >
      {renderActivePage()}
    </AppShell>
  );
}

export default App;
