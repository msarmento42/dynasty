import ConfidenceBadge from './ConfidenceBadge.jsx';

const ACTION_STYLES = {
  add: { bg: '#dcfce7', text: '#166534' },
  sit: { bg: '#fee2e2', text: '#991b1b' },
  hold: { bg: '#e0f2fe', text: '#0369a1' },
  'trade target': { bg: '#fef3c7', text: '#92400e' },
};

function Badge({ children, tone }) {
  return (
    <span
      style={{
        background: tone?.bg || '#f3f4f6',
        borderRadius: 6,
        color: tone?.text || '#374151',
        fontSize: 11,
        fontWeight: 800,
        padding: '4px 7px',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <div style={{ color: '#667085', fontSize: 11, fontWeight: 800, marginBottom: 3, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ color: '#344054', fontSize: 13 }}>{value}</div>
    </div>
  );
}

export default function RecommendationCard({ recommendation }) {
  const action = recommendation.action || 'hold';
  const confidence = recommendation.confidence || { level: 'low', label: 'Low trust' };
  const impact = recommendation.impact || {};
  const risk = recommendation.risk || {};
  const dataUsed = recommendation.data_used || [];
  const isLowConfidence = confidence.level === 'low';

  return (
    <article
      style={{
        background: '#fff',
        border: `1px solid ${isLowConfidence ? '#fca5a5' : '#d9dee7'}`,
        borderRadius: 8,
        boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04)',
        display: 'grid',
        gap: 14,
        padding: 18,
      }}
    >
      <div style={{ alignItems: 'start', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <Badge tone={ACTION_STYLES[action]}>{action}</Badge>
            <Badge>{recommendation.category || 'recommendation'}</Badge>
            <ConfidenceBadge confidence={confidence} />
          </div>
          <h2 style={{ color: '#101828', fontSize: 18, lineHeight: 1.25, margin: 0 }}>
            {recommendation.title}
          </h2>
        </div>
        <div style={{ color: '#475467', fontSize: 12, fontWeight: 800, textAlign: 'right' }}>
          {recommendation.time_horizon || 'next action'}
        </div>
      </div>

      <p style={{ color: '#344054', fontSize: 14, lineHeight: 1.5, margin: 0 }}>
        {recommendation.summary}
      </p>
      <p style={{ color: '#475467', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
        {recommendation.rationale}
      </p>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <DetailRow label="Impact" value={`${impact.tier || 'low'} (${impact.score ?? 0} ${impact.label || 'score'})`} />
        <DetailRow label="Risk" value={`${risk.level || 'low'}${risk.reasons?.length ? ` - ${risk.reasons.join('; ')}` : ''}`} />
        <DetailRow label="Data Used" value={dataUsed.length ? dataUsed.join(', ') : 'No source detail'} />
      </div>
    </article>
  );
}
