import { memo } from 'react';

function trendText(value) {
  const trend = Number(value || 0);
  return trend > 0 ? `+${trend}` : String(trend);
}

function positionBadge(position, team) {
  return [position || 'FA', team].filter(Boolean).join(' / ');
}

const BreakoutCard = memo(function BreakoutCard({ player }) {
  const trend = Number(player.trend_30d || 0);
  const trendColor = trend > 0 ? '#15803d' : '#b42318';
  const arrow = trend > 0 ? '↑' : '↓';

  return (
    <article
      style={{
        background: '#ffffff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        display: 'grid',
        gap: 10,
        padding: 14,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <div>
          <strong style={{ fontSize: 15 }}>{player.name}</strong>
          <div style={{ color: '#667085', fontSize: 13, marginTop: 2 }}>
            {positionBadge(player.position, player.team)}
            {player.age ? ` · Age ${player.age}` : ''}
          </div>
        </div>
        <span
          style={{
            background: '#dcfce7',
            border: '1px solid #86efac',
            borderRadius: 999,
            color: '#166534',
            fontSize: 11,
            fontWeight: 800,
            padding: '3px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          BUY LOW
        </span>
      </div>

      <div style={{ alignItems: 'center', display: 'flex', gap: 16 }}>
        <div>
          <div style={{ color: '#475467', fontSize: 12 }}>SF Value</div>
          <strong>{Number(player.value_sf || player.adjusted_value || 0).toLocaleString()}</strong>
        </div>
        <div>
          <div style={{ color: '#475467', fontSize: 12 }}>30d Trend</div>
          <strong style={{ color: trendColor }}>
            {arrow} {trendText(player.trend_30d)}
          </strong>
        </div>
      </div>
    </article>
  );
});

export default BreakoutCard;
