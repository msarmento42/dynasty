import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function formatDate(value) {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }
  return Math.round(Number(value)).toLocaleString();
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0].payload;
  const rows = payload.filter((item) => item.value !== null && item.value !== undefined);
  return (
    <div
      style={{
        background: '#111827',
        borderRadius: 8,
        color: '#f8fafc',
        fontSize: 13,
        padding: '10px 12px',
      }}
    >
      <div style={{ color: '#cbd5e1', marginBottom: 3 }}>{formatDate(label || point.date)}</div>
      {rows.map((item) => (
        <div
          key={item.dataKey}
          style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between', minWidth: 150 }}
        >
          <span style={{ color: item.color || '#cbd5e1' }}>{item.name}</span>
          <strong>{formatValue(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

const SIGNAL_STYLES = {
  BUY: { background: '#dcfce7', color: '#166534' },
  SELL: { background: '#fee2e2', color: '#991b1b' },
  HOLD: { background: '#e0f2fe', color: '#075985' },
};

export default function ValueTrendChart({
  history = [],
  compTrajectories = [],
  title = '30-day roster value trend',
  emptyMessage = 'Need at least two daily sync snapshots before the trend chart can render.',
  signal = null,
  slope30 = null,
  slope90 = null,
}) {
  const points = history
    .filter((item) => {
      const date = item?.synced_at || item?.snapshot_date || item?.date;
      const value = item?.total_value ?? item?.value;
      return date && Number.isFinite(Number(value));
    })
    .map((item) => ({
      date: item.synced_at || item.snapshot_date || item.date,
      value: Number(item.total_value ?? item.value),
    }));

  const compSeries = compTrajectories
    .filter((comp) => comp?.trajectory?.length)
    .slice(0, 3)
    .map((comp, index) => ({
      key: `comp_${index}`,
      name: comp.name || `Comp ${index + 1}`,
      color: ['#7c3aed', '#0891b2', '#ea580c'][index] || '#64748b',
      points: comp.trajectory
        .filter((item) => {
          const date = item?.synced_at || item?.snapshot_date || item?.date;
          const value = item?.total_value ?? item?.value;
          return date && Number.isFinite(Number(value));
        })
        .map((item) => ({
          date: item.synced_at || item.snapshot_date || item.date,
          value: Number(item.total_value ?? item.value),
        })),
    }))
    .filter((comp) => comp.points.length >= 2);

  const pointsByDate = new Map(points.map((point) => [point.date, { ...point }]));
  for (const comp of compSeries) {
    for (const point of comp.points) {
      if (!pointsByDate.has(point.date)) {
        pointsByDate.set(point.date, { date: point.date, value: null });
      }
      pointsByDate.get(point.date)[comp.key] = point.value;
    }
  }
  const chartPoints = Array.from(pointsByDate.values()).sort((a, b) => new Date(a.date) - new Date(b.date));

  if (points.length < 2) {
    return (
      <section
        style={{
          background: '#ffffff',
          border: '1px solid #d9dee7',
          borderRadius: 8,
          padding: 18,
        }}
      >
        <h3 style={{ margin: 0 }}>{title}</h3>
        <p style={{ color: '#667085', margin: '8px 0 0' }}>
          {emptyMessage}
        </p>
      </section>
    );
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const change = lastPoint.value - firstPoint.value;
  const signalStyle = SIGNAL_STYLES[signal] || SIGNAL_STYLES.HOLD;

  return (
    <section
      style={{
        background: '#ffffff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        padding: 18,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <p style={{ color: '#667085', margin: '6px 0 0', fontSize: 13 }}>
            {formatDate(firstPoint.date)} to {formatDate(lastPoint.date)}
          </p>
        </div>
        <div style={{ alignItems: 'flex-end', display: 'grid', gap: 6, justifyItems: 'end' }}>
          {signal && (
            <span
              style={{
                ...signalStyle,
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 900,
                padding: '4px 10px',
              }}
            >
              {signal}
            </span>
          )}
          <strong style={{ color: change >= 0 ? '#027a48' : '#b42318' }}>
            {change >= 0 ? '+' : ''}
            {Math.round(change).toLocaleString()}
          </strong>
        </div>
      </div>

      <div style={{ height: 240, marginTop: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartPoints} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="playerValueTrendGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#667085', fontSize: 11 }}
              tickFormatter={formatDate}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: '#667085', fontSize: 11 }}
              tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip content={<TrendTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              name="Current player"
              fill="url(#playerValueTrendGradient)"
              stroke="#2563eb"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 5, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
            />
            <Line type="monotone" dataKey="value" name="Current player" stroke="#1d4ed8" strokeWidth={2} dot={false} />
            {compSeries.map((comp) => (
              <Line
                key={comp.key}
                type="monotone"
                dataKey={comp.key}
                name={comp.name}
                stroke={comp.color}
                strokeDasharray="4 4"
                strokeOpacity={0.58}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {compSeries.length > 0 && (
        <div style={{ color: '#667085', display: 'flex', gap: 10, marginTop: 8, fontSize: 13, flexWrap: 'wrap' }}>
          {compSeries.map((comp) => (
            <span key={comp.key} style={{ alignItems: 'center', display: 'inline-flex', gap: 5 }}>
              <span style={{ background: comp.color, borderRadius: 999, display: 'inline-block', height: 8, width: 8 }} />
              {comp.name}
            </span>
          ))}
        </div>
      )}
      {(slope30 !== null || slope90 !== null) && (
        <div style={{ color: '#667085', display: 'flex', gap: 14, marginTop: 8, fontSize: 13, flexWrap: 'wrap' }}>
          {slope30 !== null && <span>30d slope: {Number(slope30).toFixed(2)}/day</span>}
          {slope90 !== null && <span>90d slope: {Number(slope90).toFixed(2)}/day</span>}
        </div>
      )}
    </section>
  );
}
