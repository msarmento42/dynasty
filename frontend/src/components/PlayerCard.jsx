import { Link } from 'react-router-dom';

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

function UsageSparkline({ usage }) {
  const points = usage?.history
    ?.filter((item) => item.target_share !== null && item.target_share !== undefined)
    .slice(-4) || [];

  if (points.length < 2) {
    return <span style={{ color: '#98a2b3', fontSize: 12 }}>No target data</span>;
  }

  const values = points.map((item) => Number(item.target_share || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.01;
  const width = 88;
  const height = 30;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 6) - 3;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg aria-label="Recent target share trend" role="img" viewBox={`0 0 ${width} ${height}`} style={{ width, height }}>
      <path d={path} fill="none" stroke={usage?.rising_target_share ? '#15803d' : '#475467'} strokeWidth="3" />
    </svg>
  );
}

export default function PlayerCard({ player }) {
  const trend = Number(player.trend_30d || 0);
  const trendText = trend > 0 ? `+${trend}` : String(trend);
  const trendColor = trend >= 0 ? '#15803d' : '#b42318';
  const positionColor = POSITION_COLORS[player.position] || '#475569';
  const stageIcon = STAGE_ICONS[player.career_stage] || '>';
  const usage = player.usage_trend;
  const latestTargetShare = usage?.latest?.target_share;
  const targetShareLabel = latestTargetShare != null ? `${Math.round(Number(latestTargetShare) * 100)}%` : 'N/A';

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
          <Link
            to={`/players/${player.sleeper_id}`}
            style={{ color: '#1d4ed8', fontWeight: 800, textDecoration: 'none' }}
          >
            {player.name}
          </Link>
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
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <span style={{ color: '#475467', display: 'block' }}>Target share</span>
          <strong style={{ color: usage?.rising_target_share ? '#15803d' : '#344054' }}>
            {targetShareLabel}{usage?.rising_target_share ? ' rising' : ''}
          </strong>
        </div>
        <UsageSparkline usage={usage} />
      </div>
    </article>
  );
}
