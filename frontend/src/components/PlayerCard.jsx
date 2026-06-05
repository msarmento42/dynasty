const POSITION_COLORS = {
  QB: '#dc2626',
  RB: '#16a34a',
  WR: '#2563eb',
  TE: '#ca8a04',
  K: '#7c3aed',
  DEF: '#475569',
};

const STAGE_ICONS = {
  rising: '^',
  prime: '>',
  declining: 'v',
};

export default function PlayerCard({ player }) {
  const trend = Number(player.trend_30d || 0);
  const trendText = trend > 0 ? `+${trend}` : String(trend);
  const trendColor = trend >= 0 ? '#15803d' : '#b42318';
  const positionColor = POSITION_COLORS[player.position] || '#475569';
  const stageIcon = STAGE_ICONS[player.career_stage] || '>';

  return (
    <article
      style={{
        border: '1px solid #d9dee7',
        borderRadius: 8,
        padding: 14,
        display: 'grid',
        gap: 10,
        background: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800 }}>{player.name}</div>
          <div style={{ color: '#667085', fontSize: 13 }}>
            Age {player.age || 'N/A'} - {stageIcon} {player.career_stage || 'prime'}
          </div>
        </div>
        <span
          style={{
            alignSelf: 'flex-start',
            background: positionColor,
            borderRadius: 999,
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 800,
            padding: '4px 8px',
          }}
        >
          {player.position || 'FA'} {player.team ? `- ${player.team}` : ''}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: '#475467' }}>Adjusted value</span>
        <strong>{Number(player.adjusted_value || 0).toLocaleString()}</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: '#475467' }}>30-day trend</span>
        <strong style={{ color: trendColor }}>{trendText}</strong>
      </div>
    </article>
  );
}
