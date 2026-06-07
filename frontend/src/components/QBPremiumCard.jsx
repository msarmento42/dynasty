const LABEL_STYLES = {
  '4QB Target': {
    background: '#dcfce7',
    border: '#86efac',
    color: '#166534',
  },
  'Format Neutral': {
    background: '#eff6ff',
    border: '#bfdbfe',
    color: '#1d4ed8',
  },
  'Overvalued in 4QB': {
    background: '#fef3c7',
    border: '#fde68a',
    color: '#92400e',
  },
};

function formatValue(value) {
  return Number(value || 0).toLocaleString();
}

export default function QBPremiumCard({ player }) {
  const premium = player.qb_premium || {};
  const label = premium.label || 'Format Neutral';
  const labelStyle = LABEL_STYLES[label] || LABEL_STYLES['Format Neutral'];

  return (
    <article
      style={{
        background: '#ffffff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        display: 'grid',
        gap: 12,
        padding: 16,
      }}
    >
      <div style={{ alignItems: 'start', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <strong>{player.name || 'Unknown QB'}</strong>
          <span style={{ color: '#667085', fontSize: 13 }}>
            {[player.position || 'QB', player.team].filter(Boolean).join(' / ')}
          </span>
        </div>
        <span
          style={{
            background: labelStyle.background,
            border: `1px solid ${labelStyle.border}`,
            borderRadius: 999,
            color: labelStyle.color,
            fontSize: 12,
            fontWeight: 800,
            padding: '4px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>SF value</span>
          <strong>{formatValue(premium.value_sf ?? player.value_sf)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>1QB value</span>
          <strong>{formatValue(premium.value_1qb ?? player.value_1qb)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>Premium multiplier</span>
          <strong>{Number(premium.premium_multiplier || 0).toFixed(2)}x</strong>
        </div>
      </div>
    </article>
  );
}
