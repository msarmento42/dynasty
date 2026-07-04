const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE'];
const MIN_AGE = 20;
const MAX_AGE = 36;
const WIDTH = 760;
const HEIGHT = 300;
const PADDING = { top: 28, right: 24, bottom: 42, left: 54 };
const PROJECTION_HEIGHT = 260;

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

function formatValue(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

function projectionPointToX(index, count) {
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  if (count <= 1) {
    return PADDING.left + plotWidth / 2;
  }
  return PADDING.left + (index / (count - 1)) * plotWidth;
}

function projectionPointToY(value, minValue, maxValue) {
  const plotHeight = PROJECTION_HEIGHT - PADDING.top - PADDING.bottom;
  if (maxValue <= minValue) {
    return PADDING.top + plotHeight / 2;
  }
  return PADDING.top + ((maxValue - value) / (maxValue - minValue)) * plotHeight;
}

function ProjectionChart({ projection }) {
  const projectionRows = Array.isArray(projection?.projections) ? projection.projections : [];
  const points = [
    {
      label: 'Now',
      age: projection?.current_age,
      year: 0,
      value: Number(projection?.current_value || 0),
    },
    ...projectionRows.map((item) => ({
      label: `+${item.year}y`,
      age: item.age,
      year: item.year,
      value: Number(item.projected_value || 0),
    })),
  ].filter((point) => Number.isFinite(point.value));

  if (!projection || points.length < 2) {
    return (
      <section
        style={{
          background: '#ffffff',
          border: '1px solid #d9dee7',
          borderRadius: 8,
          padding: 18,
        }}
      >
        <h3 style={{ margin: 0 }}>Age curve projection</h3>
        <p style={{ color: '#667085', margin: '8px 0 0' }}>
          Need a current player value before projections can render.
        </p>
      </section>
    );
  }

  const rawValues = points.map((point) => point.value);
  const low = Math.min(...rawValues);
  const high = Math.max(...rawValues);
  const rangePadding = Math.max(150, (high - low) * 0.18);
  const minValue = Math.max(0, low - rangePadding);
  const maxValue = high + rangePadding;
  const svgPoints = points.map((point, index) => ({
    ...point,
    x: projectionPointToX(index, points.length),
    y: projectionPointToY(point.value, minValue, maxValue),
  }));
  const currentPoint = svgPoints[0];
  const projectedPolyline = svgPoints.map((point) => `${point.x},${point.y}`).join(' ');
  const lastPoint = svgPoints[svgPoints.length - 1];
  const totalDelta = lastPoint.value - currentPoint.value;
  const deltaColor = totalDelta >= 0 ? '#15803d' : '#b42318';

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
          <h3 style={{ margin: 0 }}>Age curve projection</h3>
          <p style={{ color: '#667085', margin: '6px 0 0', fontSize: 13 }}>
            {projection.position || 'Player'} peak age {projection.peak_age}; current age {projection.current_age || 'N/A'}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#667085', fontSize: 13 }}>5-year delta</div>
          <strong style={{ color: deltaColor }}>
            {totalDelta >= 0 ? '+' : ''}{formatValue(totalDelta)}
          </strong>
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <svg
          aria-label="Projected dynasty value by age curve"
          role="img"
          viewBox={`0 0 ${WIDTH} ${PROJECTION_HEIGHT}`}
          style={{ background: '#ffffff', minWidth: 680, width: '100%' }}
        >
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={PADDING.top}
            y2={PADDING.top}
            stroke="#eef2f7"
          />
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={PROJECTION_HEIGHT - PADDING.bottom}
            y2={PROJECTION_HEIGHT - PADDING.bottom}
            stroke="#d9dee7"
          />
          <text x="12" y={PADDING.top + 4} fill="#667085" fontSize="12">
            {formatValue(maxValue)}
          </text>
          <text x="12" y={PROJECTION_HEIGHT - PADDING.bottom + 4} fill="#667085" fontSize="12">
            {formatValue(minValue)}
          </text>

          <polyline
            fill="none"
            points={projectedPolyline}
            stroke="#1d4ed8"
            strokeDasharray="7 7"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />

          {svgPoints.map((point, index) => (
            <g key={`${point.label}-${point.value}`}>
              <line
                x1={point.x}
                x2={point.x}
                y1={PADDING.top}
                y2={PROJECTION_HEIGHT - PADDING.bottom + 8}
                stroke="#f0f2f5"
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={index === 0 ? 6 : 5}
                fill={index === 0 ? '#111827' : '#2563eb'}
                stroke="#ffffff"
                strokeWidth="2"
              />
              <text x={point.x} y={point.y - 12} fill="#344054" fontSize="12" fontWeight="700" textAnchor="middle">
                {formatValue(point.value)}
              </text>
              <text x={point.x} y={PROJECTION_HEIGHT - 16} fill="#667085" fontSize="12" textAnchor="middle">
                {point.label}{point.age ? ` / age ${point.age}` : ''}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

export default function AgeCurveChart({ players = [], projection = null }) {
  if (projection) {
    return <ProjectionChart projection={projection} />;
  }

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
