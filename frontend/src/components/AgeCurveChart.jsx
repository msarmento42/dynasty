const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE'];
const MIN_AGE = 20;
const MAX_AGE = 36;
const WIDTH = 760;
const HEIGHT = 300;
const PADDING = { top: 28, right: 24, bottom: 42, left: 54 };

const STAGE_COLORS = {
  rising: '#16a34a',
  prime: '#2563eb',
  declining: '#f97316',
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ageToX(age) {
  const boundedAge = clamp(Number(age || MIN_AGE), MIN_AGE, MAX_AGE);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  return PADDING.left + ((boundedAge - MIN_AGE) / (MAX_AGE - MIN_AGE)) * plotWidth;
}

function positionToY(position) {
  const index = POSITION_ORDER.indexOf(position);
  const safeIndex = index >= 0 ? index : POSITION_ORDER.length - 1;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  if (POSITION_ORDER.length === 1) {
    return PADDING.top + plotHeight / 2;
  }
  return PADDING.top + (safeIndex / (POSITION_ORDER.length - 1)) * plotHeight;
}

function primeRange(position) {
  if (position === 'RB') {
    return [22, 27];
  }
  return [24, 29];
}

function isVisiblePlayer(player) {
  return POSITION_ORDER.includes(player.position) && Number(player.age || 0) > 0;
}

function valueShare(players) {
  const totalValue = players.reduce((sum, player) => sum + Number(player.adjusted_value || 0), 0);
  if (!totalValue) {
    return 0;
  }

  const primeOrRisingValue = players
    .filter((player) => ['prime', 'rising'].includes(player.career_stage))
    .reduce((sum, player) => sum + Number(player.adjusted_value || 0), 0);

  return Math.round((primeOrRisingValue / totalValue) * 100);
}

export default function AgeCurveChart({ players = [] }) {
  const visiblePlayers = players.filter(isVisiblePlayer);
  const primeOrRisingPct = valueShare(players);
  const ages = [20, 24, 28, 32, 36];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <strong>{primeOrRisingPct}% of value is in prime or rising players.</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {Object.entries(STAGE_COLORS).map(([stage, color]) => (
            <span key={stage} style={{ alignItems: 'center', display: 'inline-flex', gap: 6 }}>
              <span style={{ background: color, borderRadius: 999, display: 'inline-block', height: 10, width: 10 }} />
              <span style={{ color: '#475467', fontSize: 13 }}>{stage}</span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <svg
          aria-label="Roster age curve by position"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, minWidth: 680, width: '100%' }}
        >
          <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="#ffffff" rx="8" />

          {POSITION_ORDER.map((position) => {
            const [primeStart, primeEnd] = primeRange(position);
            const y = positionToY(position);
            const primeX = ageToX(primeStart);
            const primeWidth = ageToX(primeEnd) - primeX;

            return (
              <g key={position}>
                <rect
                  x={primeX}
                  y={y - 22}
                  width={primeWidth}
                  height="44"
                  fill={position === 'RB' ? '#dcfce7' : '#dbeafe'}
                  opacity="0.65"
                  rx="6"
                />
                <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} stroke="#e4e7ec" />
                <text x="16" y={y + 5} fill="#344054" fontSize="14" fontWeight="700">
                  {position}
                </text>
              </g>
            );
          })}

          {ages.map((age) => {
            const x = ageToX(age);
            return (
              <g key={age}>
                <line x1={x} x2={x} y1={PADDING.top - 12} y2={HEIGHT - PADDING.bottom + 8} stroke="#f0f2f5" />
                <text x={x} y={HEIGHT - 16} fill="#667085" fontSize="12" textAnchor="middle">
                  {age}
                </text>
              </g>
            );
          })}

          <text x={(WIDTH + PADDING.left - PADDING.right) / 2} y={HEIGHT - 4} fill="#667085" fontSize="12" textAnchor="middle">
            Age
          </text>

          {visiblePlayers.map((player, index) => {
            const sameAgeIndex = visiblePlayers
              .slice(0, index)
              .filter((other) => other.position === player.position && Math.round(Number(other.age)) === Math.round(Number(player.age)))
              .length;
            const x = ageToX(player.age) + (sameAgeIndex % 3) * 7 - 7;
            const y = positionToY(player.position) + Math.floor(sameAgeIndex / 3) * 7 - 4;
            const color = STAGE_COLORS[player.career_stage] || STAGE_COLORS.prime;

            return (
              <g key={`${player.sleeper_id}-${index}`}>
                <circle cx={x} cy={y} r="7" fill={color} stroke="#ffffff" strokeWidth="2" />
                <title>{`${player.name} - age ${player.age} - ${player.career_stage || 'prime'}`}</title>
              </g>
            );
          })}

          {visiblePlayers.length === 0 && (
            <text x={WIDTH / 2} y={HEIGHT / 2} fill="#667085" fontSize="14" textAnchor="middle">
              No age data available for QB, RB, WR, or TE.
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
