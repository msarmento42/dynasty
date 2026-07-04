import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AgeCurveChart from '../components/AgeCurveChart';
import ValueTrendChart from '../components/ValueTrendChart';

const POSITION_COLORS = {
  QB: '#dc2626',
  RB: '#16a34a',
  WR: '#2563eb',
  TE: '#ca8a04',
  K: '#7c3aed',
  DEF: '#475569',
};

const STAGE_LABELS = {
  rising: '^ Rising',
  prime: '> Prime',
  declining: 'v Declining',
};

function StatRow({ label, value }) {
  if (value === null || value === undefined) return null;
  return (
    <div
      style={{
        alignItems: 'center',
        borderBottom: '1px solid #f1f5f9',
        display: 'flex',
        justifyContent: 'space-between',
        padding: '10px 0',
      }}
    >
      <span style={{ color: '#667085' }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// --- Skeleton Components Start ---
const Skeleton = ({ width, height, borderRadius = 4, style = {} }) => (
  <div
    style={{
      background: '#e2e8f0', // Tailwind's gray-200
      borderRadius,
      width,
      height,
      ...style,
    }}
  />
);

const PlayerHeaderSkeleton = () => (
  <header
    style={{
      alignItems: 'center',
      background: '#ffffff',
      border: '1px solid #d9dee7',
      borderRadius: 10,
      display: 'flex',
      gap: 20,
      padding: 24,
    }}
  >
    <Skeleton width={72} height={72} borderRadius={12} />
    <div style={{ flex: 1 }}>
      <Skeleton width="70%" height={28} style={{ marginBottom: 8 }} />
      <Skeleton width="90%" height={20} />
    </div>
  </header>
);

const KeyMetricsSkeleton = () => (
  <div
    style={{
      display: 'grid',
      gap: 14,
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    }}
  >
    {Array.from({ length: 7 }).map((_, i) => (
      <article
        key={i}
        style={{
          background: '#ffffff',
          border: '1px solid #d9dee7',
          borderRadius: 8,
          padding: 16,
          textAlign: 'center',
        }}
      >
        <Skeleton width="80%" height={16} style={{ margin: '0 auto 6px' }} />
        <Skeleton width="60%" height={24} style={{ margin: '0 auto' }} />
      </article>
    ))}
  </div>
);

const RecentStatsSkeleton = () => (
  <section
    style={{
      background: '#ffffff',
      border: '1px solid #d9dee7',
      borderRadius: 10,
      padding: 20,
    }}
  >
    <Skeleton width="40%" height={24} style={{ marginBottom: 14 }} /> {/* Title */}
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #d9dee7' }}>
          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Date</th>
          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>SF Value</th>
          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Depth</th>
          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 5 }).map((_, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
            <td style={{ padding: '10px 12px' }}><Skeleton width="80%" height={18} /></td>
            <td style={{ padding: '10px 12px' }}><Skeleton width="70%" height={18} /></td>
            <td style={{ padding: '10px 12px' }}><Skeleton width="50%" height={18} /></td>
            <td style={{ padding: '10px 12px' }}><Skeleton width="60%" height={18} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

const ComparablePlayersSkeleton = () => (
  <section
    style={{
      background: '#ffffff',
      border: '1px solid #d9dee7',
      borderRadius: 10,
      padding: 20,
    }}
  >
    <Skeleton width="50%" height={24} style={{ marginBottom: 14 }} /> {/* Title */}
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <article
          key={i}
          style={{
            border: '1px solid #d9dee7',
            borderRadius: 8,
            padding: 14,
            background: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <Skeleton width={100} height={20} style={{ marginBottom: 4 }} />
              <Skeleton width={70} height={16} />
            </div>
            <Skeleton width={60} height={24} borderRadius={999} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
            <Skeleton width={40} height={16} />
            <Skeleton width={60} height={16} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Skeleton width={40} height={16} />
            <Skeleton width={60} height={16} />
          </div>
        </article>
      ))}
    </div>
  </section>
);
// --- Skeleton Components End ---

export default function PlayerProfile() {
  const { playerId } = useParams();
  const [player, setPlayer] = useState(null);
  const [ageProjection, setAgeProjection] = useState(null);
  const [ageProjectionError, setAgeProjectionError] = useState('');
  const [valueTrend, setValueTrend] = useState(null);
  const [valueTrendError, setValueTrendError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!playerId) return;
    setLoading(true);
    setError('');
    setAgeProjection(null);
    setAgeProjectionError('');
    setValueTrend(null);
    setValueTrendError('');
    fetch(`/fantasy/players/${playerId}/profile`)
      .then((res) => {
        if (!res.ok) throw new Error(`Player not found (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setPlayer(data);
        setValueTrend(data.value_trend || null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    fetch(`/fantasy/players/${playerId}/value-trend`)
      .then((res) => {
        if (!res.ok) throw new Error(`Value trend unavailable (${res.status})`);
        return res.json();
      })
      .then((data) => setValueTrend(data))
      .catch((err) => setValueTrendError(err.message));

    fetch(`/fantasy/players/${playerId}/age-curve-projection`)
      .then((res) => {
        if (!res.ok) throw new Error(`Age curve projection unavailable (${res.status})`);
        return res.json();
      })
      .then((data) => setAgeProjection(data))
      .catch((err) => setAgeProjectionError(err.message));
  }, [playerId]);

  const positionColor = player ? (POSITION_COLORS[player.position] || '#475569') : '#475569';
  const sevenDayValueChange = player?.seven_day_value_change;
  const sevenDayDelta = sevenDayValueChange ? Number(sevenDayValueChange.delta || 0) : null;
  const sevenDayDeltaPct = sevenDayValueChange ? Number(sevenDayValueChange.delta_pct || 0) : null;

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 820 }}>
        <Link
          to="/"
          style={{ color: '#1d4ed8', display: 'inline-block', marginBottom: 18, textDecoration: 'none' }}
        >
          ← Back to Roster
        </Link>

        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {loading && (
          <div style={{ display: 'grid', gap: 20 }}>
            <PlayerHeaderSkeleton />
            <KeyMetricsSkeleton />
            <RecentStatsSkeleton />
            <ComparablePlayersSkeleton />
          </div>
        )}

        {player && !loading && (
          <div style={{ display: 'grid', gap: 20 }}>
            {/* Header */}
            <header
              style={{
                alignItems: 'center',
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 10,
                display: 'flex',
                gap: 20,
                padding: 24,
              }}
            >
              <div
                style={{
                  alignItems: 'center',
                  background: positionColor,
                  borderRadius: 12,
                  color: '#ffffff',
                  display: 'flex',
                  fontSize: 22,
                  fontWeight: 900,
                  height: 72,
                  justifyContent: 'center',
                  minWidth: 72,
                }}
              >
                {player.position || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <h1 style={{ margin: 0 }}>{player.name}</h1>
                <div style={{ color: '#667085', marginTop: 4 }}>
                  {player.team || 'FA'} · Age {player.age || 'N/A'} · {STAGE_LABELS[player.career_stage] || player.career_stage}
                  {player.injury_status && (
                    <span
                      style={{
                        background: '#fee2e2',
                        borderRadius: 999,
                        color: '#b42318',
                        fontSize: 12,
                        fontWeight: 700,
                        marginLeft: 10,
                        padding: '2px 8px',
                      }}
                    >
                      {player.injury_status}
                    </span>
                  )}
                </div>
              </div>
            </header>

            {/* Key Metrics */}
            <div
              style={{
                display: 'grid',
                gap: 14,
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              }}
            >
              {[
                {
                  label: 'Dynasty Value',
                  value: Number(player.dynasty_value || 0).toLocaleString(),
                  sevenDayDelta,
                  sevenDayDeltaPct,
                },
                { label: 'Positional Rank', value: `#${player.positional_rank}` },
                { label: 'SF Value', value: Number(player.dynasty_value_sf || 0).toLocaleString() },
                { label: '1QB Value', value: Number(player.dynasty_value_1qb || 0).toLocaleString() },
                { label: '30-Day Trend', value: (player.trend_30d >= 0 ? '+' : '') + player.trend_30d },
                ...(player.years_in_prime_remaining != null
                  ? [{ label: 'Prime Yrs Left', value: player.years_in_prime_remaining }]
                  : []),
                ...(player.breakout_score != null
                  ? [{ label: 'Breakout Score', value: player.breakout_score }]
                  : []),
              ].map(({ label, value, sevenDayDelta, sevenDayDeltaPct }) => {
                const hasSevenDayChange = sevenDayDelta !== null && !Number.isNaN(sevenDayDelta);
                const changeIsPositive = Number(sevenDayDelta) >= 0;
                return (
                <article
                  key={label}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #d9dee7',
                    borderRadius: 8,
                    padding: 16,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ color: '#667085', fontSize: 13, marginBottom: 6 }}>{label}</div>
                  <strong style={{ fontSize: 22 }}>{value}</strong>
                  {hasSevenDayChange && (
                    <div
                      aria-label={`7-day change ${changeIsPositive ? 'positive' : 'negative'} ${sevenDayDelta}`}
                      title={
                        sevenDayValueChange?.snapshot_date
                          ? `Compared with ${sevenDayValueChange.snapshot_date}`
                          : 'Compared with 7 days ago'
                      }
                      style={{
                        alignItems: 'center',
                        background: changeIsPositive ? '#dcfce7' : '#fee2e2',
                        borderRadius: 999,
                        color: changeIsPositive ? '#166534' : '#991b1b',
                        display: 'inline-flex',
                        fontSize: 12,
                        fontWeight: 800,
                        gap: 4,
                        marginTop: 8,
                        padding: '3px 8px',
                      }}
                    >
                      <span>{changeIsPositive ? '▲' : '▼'}</span>
                      <span>
                        {changeIsPositive ? '+' : ''}{Number(sevenDayDelta).toLocaleString()} / {' '}
                        {changeIsPositive ? '+' : ''}{sevenDayDeltaPct}%
                      </span>
                      <span style={{ color: changeIsPositive ? '#15803d' : '#b42318', fontWeight: 700 }}>7d</span>
                    </div>
                  )}
                </article>
                );
              })}
            </div>

            <ValueTrendChart
              history={valueTrend?.window_90d || []}
              title="Player value trend"
              emptyMessage="Need at least two player value snapshots before the BUY/SELL/HOLD signal can render."
              signal={valueTrend?.signal}
              slope30={valueTrend?.slope_30d ?? null}
              slope90={valueTrend?.slope_90d ?? null}
            />
            {valueTrendError && (
              <p style={{ color: '#b42318', margin: '-8px 0 0' }}>{valueTrendError}</p>
            )}

            <AgeCurveChart projection={ageProjection} />
            {ageProjectionError && (
              <p style={{ color: '#b42318', margin: '-8px 0 0' }}>{ageProjectionError}</p>
            )}

            {/* Recent Stats */}
            {player.recent_stats && player.recent_stats.length > 0 && (
              <section
                style={{
                  background: '#ffffff',
                  border: '1px solid #d9dee7',
                  borderRadius: 10,
                  padding: 20,
                }}
              >
                <h2 style={{ margin: '0 0 14px' }}>Recent Snapshots</h2>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #d9dee7' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>SF Value</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Depth</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {player.recent_stats.map((snap) => (
                      <tr key={snap.week} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', color: '#475467' }}>{snap.week}</td>
                        <td style={{ padding: '10px 12px' }}>{snap.value != null ? Number(snap.value).toLocaleString() : '—'}</td>
                        <td style={{ padding: '10px 12px' }}>{snap.depth_chart_order ?? '—'}</td>
                        <td style={{ padding: '10px 12px' }}>{snap.injury_status || 'Active'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Comparable Players */}
            {player.comparable_players && player.comparable_players.length > 0 && (
              <section
                style={{
                  background: '#ffffff',
                  border: '1px solid #d9dee7',
                  borderRadius: 10,
                  padding: 20,
                }}
              >
                <h2 style={{ margin: '0 0 14px' }}>Comparable Players</h2>
                <div
                  style={{
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  }}
                >
                  {player.comparable_players.map((comp) => {
                    const compColor = POSITION_COLORS[comp.position] || '#475569';
                    const trend = Number(comp.trend_30d || 0);
                    return (
                      <Link
                        key={comp.sleeper_id}
                        to={`/players/${comp.sleeper_id}`}
                        style={{ textDecoration: 'none' }}
                      >
                        <article
                          style={{
                            border: '1px solid #d9dee7',
                            borderRadius: 8,
                            cursor: 'pointer',
                            padding: 14,
                            background: '#f8fafc',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontWeight: 800 }}>{comp.name}</div>
                              <div style={{ color: '#667085', fontSize: 13 }}>Age {comp.age || 'N/A'}</div>
                            </div>
                            <span
                              style={{
                                background: compColor,
                                borderRadius: 999,
                                color: '#fff',
                                fontSize: 12,
                                fontWeight: 800,
                                padding: '3px 8px',
                              }}
                            >
                              {comp.position} {comp.team ? `· ${comp.team}` : ''}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                            <span style={{ color: '#475467', fontSize: 13 }}>Value</span>
                            <strong>{Number(comp.dynasty_value || 0).toLocaleString()}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#475467', fontSize: 13 }}>Trend</span>
                            <strong style={{ color: trend >= 0 ? '#15803d' : '#b42318' }}>
                              {trend >= 0 ? '+' : ''}{trend}
                            </strong>
                          </div>
                        </article>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
