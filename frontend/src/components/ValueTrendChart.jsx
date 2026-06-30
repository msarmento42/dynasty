function formatDate(value) {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ValueTrendChart({ history = [] }) {
  const points = history
    .filter((item) => item?.synced_at && Number.isFinite(Number(item.total_value)))
    .map((item) => ({
      date: item.synced_at,
      value: Number(item.total_value),
    }));

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
        <h3 style={{ margin: 0 }}>30-day roster value trend</h3>
        <p style={{ color: '#667085', margin: '8px 0 0' }}>
          Need at least two daily sync snapshots before the trend chart can render.
        </p>
      </section>
    );
  }

  const width = 720;
  const height = 220;
  const padding = 32;
  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;

  const coordinates = points.map((point, index) => {
    const x = padding + (index / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.value - minValue) / valueRange) * (height - padding * 2);
    return { ...point, x, y };
  });

  const path = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const firstPoint = coordinates[0];
  const lastPoint = coordinates[coordinates.length - 1];
  const change = lastPoint.value - firstPoint.value;

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
          <h3 style={{ margin: 0 }}>30-day roster value trend</h3>
          <p style={{ color: '#667085', margin: '6px 0 0', fontSize: 13 }}>
            {formatDate(firstPoint.date)} to {formatDate(lastPoint.date)}
          </p>
        </div>
        <strong style={{ color: change >= 0 ? '#027a48' : '#b42318' }}>
          {change >= 0 ? '+' : ''}
          {Math.round(change).toLocaleString()}
        </strong>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Roster value trend over time"
        style={{ width: '100%', marginTop: 16, overflow: 'visible' }}
      >
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#eaecf0" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#eaecf0" />
        <text x={padding} y={padding - 10} fill="#667085" fontSize="12">
          {Math.round(maxValue).toLocaleString()}
        </text>
        <text x={padding} y={height - 8} fill="#667085" fontSize="12">
          {Math.round(minValue).toLocaleString()}
        </text>
        <path d={path} fill="none" stroke="#2563eb" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {coordinates.map((point) => (
          <circle key={`${point.date}-${point.value}`} cx={point.x} cy={point.y} r="4" fill="#2563eb">
            <title>
              {formatDate(point.date)}: {Math.round(point.value).toLocaleString()}
            </title>
          </circle>
        ))}
      </svg>
    </section>
  );
}
