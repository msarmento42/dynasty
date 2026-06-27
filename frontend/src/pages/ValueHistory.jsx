import { useState, useEffect, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  defs,
  linearGradient,
  stop,
  Area,
  AreaChart,
} from 'recharts';

function fmtVal(v) {
  if (!v && v !== 0) return '—';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${m}/${day}`;
}

const POS_COLORS = {
  QB: '#0369a1',
  RB: '#065f46',
  WR: '#92400e',
  TE: '#5b21b6',
};

function StatCard({ label, value, sub, color }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        flex: '1 1 160px',
        minWidth: 140,
        padding: '16px 20px',
      }}
    >
      <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ color: color || '#1e293b', fontSize: 22, fontWeight: 700, marginTop: 4 }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const prev = d._prev_value;
  const change = prev != null ? d.total_value - prev : null;
  const pct = prev && prev !== 0 ? ((change / prev) * 100).toFixed(1) : null;

  return (
    <div
      style={{
        background: '#1e293b',
        borderRadius: 8,
        color: '#f8fafc',
        fontSize: 13,
        padding: '10px 14px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div>
        Total Value: <strong>{fmtVal(d.total_value)}</strong>
      </div>
      <div style={{ color: '#94a3b8', fontSize: 12 }}>
        {d.player_count} players
      </div>
      {change != null && (
        <div
          style={{
            color: change >= 0 ? '#4ade80' : '#f87171',
            fontWeight: 600,
            marginTop: 4,
          }}
        >
          {change >= 0 ? '+' : ''}{fmtVal(change)} ({pct != null ? (change >= 0 ? '+' : '') + pct + '%' : ''})
        </div>
      )}
    </div>
  );
}

export default function ValueHistory() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/fantasy/leagues')
      .then((r) => r.json())
      .then(setLeagues)
      .catch(() => {});
  }, []);

  const load = useCallback(async (leagueId) => {
    setLoading(true);
    setError('');
    try {
      const url = leagueId
        ? `/fantasy/portfolio/value-history?league_id=${leagueId}`
        : '/fantasy/portfolio/value-history';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load value history');
      const raw = await res.json();
      // Annotate each point with the previous value for tooltip delta
      const enriched = raw.map((pt, i) => ({
        ...pt,
        _prev_value: i > 0 ? raw[i - 1].total_value : null,
        label: fmtDate(pt.date),
      }));
      setData(enriched);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedLeague);
  }, [selectedLeague, load]);

  const currentValue = data.length ? data[data.length - 1].total_value : null;
  const peakValue = data.length ? Math.max(...data.map((d) => d.total_value)) : null;
  const peakDate = peakValue != null
    ? data.find((d) => d.total_value === peakValue)?.date
    : null;
  const thirtyDaysAgo = data.length > 30 ? data[data.length - 31] : data[0];
  const change30d =
    currentValue != null && thirtyDaysAgo
      ? currentValue - thirtyDaysAgo.total_value
      : null;
  const pct30d =
    change30d != null && thirtyDaysAgo?.total_value
      ? ((change30d / thirtyDaysAgo.total_value) * 100).toFixed(1)
      : null;

  const hasData = data.length > 0;

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1100 }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: 16, marginBottom: 24 }}>
          <h1 style={{ margin: 0 }}>Value History</h1>
          <select
            value={selectedLeague}
            onChange={(e) => setSelectedLeague(e.target.value)}
            style={{
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              color: '#1e293b',
              fontSize: 14,
              padding: '6px 12px',
            }}
          >
            <option value="">All Leagues</option>
            {leagues.map((l) => (
              <option key={l.league_id} value={l.league_id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {loading && <p style={{ color: '#64748b' }}>Loading...</p>}
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}

        {!loading && !hasData && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '48px 24px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>📈</div>
            <h3 style={{ color: '#1e293b', margin: '0 0 8px' }}>No History Yet</h3>
            <p style={{ color: '#64748b', margin: 0 }}>
              Value history builds up over time as daily syncs run. Check back after the first sync completes.
            </p>
          </div>
        )}

        {hasData && (
          <>
            {/* Summary stats */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
              <StatCard
                label="Current Value"
                value={fmtVal(currentValue)}
              />
              <StatCard
                label="30-Day Change"
                value={
                  change30d != null
                    ? `${change30d >= 0 ? '+' : ''}${fmtVal(change30d)}`
                    : '—'
                }
                sub={pct30d != null ? `${change30d >= 0 ? '+' : ''}${pct30d}%` : ''}
                color={
                  change30d == null ? '#1e293b' : change30d >= 0 ? '#16a34a' : '#dc2626'
                }
              />
              <StatCard
                label="All-Time Peak"
                value={fmtVal(peakValue)}
                sub={peakDate ? `on ${peakDate}` : ''}
              />
              <StatCard
                label="Data Points"
                value={data.length}
                sub="daily snapshots"
              />
            </div>

            {/* Chart */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '24px 8px 16px',
              }}
            >
              <ResponsiveContainer width="100%" height={340}>
                <AreaChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    interval={Math.max(0, Math.floor(data.length / 8) - 1)}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    tickLine={false}
                    axisLine={false}
                    width={45}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {currentValue != null && (
                    <ReferenceLine
                      y={currentValue}
                      stroke="#6366f1"
                      strokeDasharray="4 4"
                      strokeWidth={1}
                      label={{ value: 'Now', position: 'right', fontSize: 11, fill: '#6366f1' }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="total_value"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    fill="url(#valueGrad)"
                    dot={false}
                    activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
