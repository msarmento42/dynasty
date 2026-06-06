const SIGNAL_STYLES = {
  BUY_LOW: {
    label: 'Buy Low',
    border: '#15803d',
    background: '#dcfce7',
    color: '#166534',
  },
  SELL_HIGH: {
    label: 'Sell High',
    border: '#b42318',
    background: '#fee2e2',
    color: '#991b1b',
  },
};

function formatValue(value) {
  return Number(value || 0).toLocaleString();
}

export default function DivergenceCard({ divergence }) {
  const style = SIGNAL_STYLES[divergence.signal] || SIGNAL_STYLES.BUY_LOW;

  return (
    <article
      style={{
        background: '#ffffff',
        border: `1px solid ${style.border}`,
        borderRadius: 8,
        display: 'grid',
        gap: 12,
        padding: 16,
      }}
    >
      <div style={{ alignItems: 'start', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <strong>{divergence.name}</strong>
          <div style={{ color: '#667085', fontSize: 13 }}>
            {[divergence.position || 'FA', divergence.team].filter(Boolean).join(' / ')}
          </div>
        </div>
        <span
          style={{
            background: style.background,
            borderRadius: 999,
            color: style.color,
            fontSize: 12,
            fontWeight: 800,
            padding: '4px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {style.label}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>FantasyCalc value</span>
          <strong>{formatValue(divergence.fantasyCalcValue)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>FantasyCalc roster rank</span>
          <strong>#{divergence.fantasyCalcRank}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>KTC rank</span>
          <strong>#{divergence.ktcRank}</strong>
        </div>
      </div>

      <p style={{ color: '#475467', margin: 0 }}>
        {Math.abs(divergence.rankDelta)} spot divergence between KTC and FantasyCalc ordering.
      </p>
    </article>
  );
}
