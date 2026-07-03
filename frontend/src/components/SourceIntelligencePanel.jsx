function statusColor(status) {
  if (status === 'fresh') return '#027a48';
  if (status === 'stale') return '#b54708';
  return '#667085';
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return Number(value).toLocaleString();
  return String(value);
}

export default function SourceIntelligencePanel({ intelligence, compact = false }) {
  const metrics = intelligence?.metrics || [];
  const summary = intelligence?.summary || {};

  if (!metrics.length) {
    return (
      <section style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: compact ? 16 : 20, margin: '0 0 8px' }}>Source Intelligence</h2>
        <p style={{ color: '#667085', margin: 0 }}>No source detail is available for this player yet.</p>
      </section>
    );
  }

  return (
    <section style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
      <div style={{ alignItems: 'start', display: 'flex', gap: 16, justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: compact ? 16 : 20, margin: 0 }}>Source Intelligence</h2>
          <p style={{ color: '#667085', margin: '4px 0 0' }}>
            {summary.source_count || 0} sources / confidence {Math.round((summary.confidence_score || 0) * 100)}%
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#667085', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
            Blended score
          </div>
          <strong style={{ fontSize: compact ? 20 : 26 }}>{formatValue(summary.blended_score)}</strong>
        </div>
      </div>

      {summary.warnings?.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fedf89', borderRadius: 7, marginTop: 12, padding: 10 }}>
          {summary.warnings.map((warning) => (
            <div key={warning} style={{ color: '#92400e', fontSize: 13 }}>{warning}</div>
          ))}
        </div>
      )}

      {!compact && (
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {metrics.map((metric, index) => (
            <article
              key={`${metric.source}-${metric.metric_type}-${metric.scoring_format}-${index}`}
              style={{
                border: '1px solid #eef2f6',
                borderRadius: 7,
                display: 'grid',
                gap: 8,
                gridTemplateColumns: 'minmax(160px, 1fr) minmax(100px, auto) minmax(90px, auto)',
                padding: 10,
              }}
            >
              <div>
                <strong>{metric.source}</strong>
                <div style={{ color: '#667085', fontSize: 13 }}>
                  {metric.metric_type.replaceAll('_', ' ')} / {metric.scoring_format || 'overall'}
                </div>
                {metric.detail && <div style={{ color: '#475467', fontSize: 12, marginTop: 3 }}>{metric.detail}</div>}
              </div>
              <div>
                <div style={{ color: '#667085', fontSize: 12 }}>Value</div>
                <strong>{formatValue(metric.value)}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: statusColor(metric.freshness?.status), fontSize: 12, fontWeight: 800 }}>
                  {metric.freshness?.status || 'unknown'}
                </div>
                <div style={{ color: '#667085', fontSize: 12 }}>
                  {metric.freshness?.age_hours == null ? 'No timestamp' : `${metric.freshness.age_hours}h old`}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
