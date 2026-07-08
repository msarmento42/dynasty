import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AgeCurveChart from '../components/AgeCurveChart';
import ValueTrendChart from '../components/ValueTrendChart';
import LoadingSkeleton from '../components/LoadingSkeleton';

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

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `${Math.round(Number(value) * 100)}%`;
}

function sosColor(score) {
  if (score === null || score === undefined) return { background: '#f2f4f7', color: '#475467' };
  if (Number(score) >= 70) return { background: '#dcfce7', color: '#166534' };
  if (Number(score) >= 45) return { background: '#fef9c3', color: '#854d0e' };
  return { background: '#fee2e2', color: '#991b1b' };
}

function buyerScoreColor(score) {
  if (Number(score) >= 65) return { background: '#dcfce7', color: '#166534' };
  if (Number(score) >= 35) return { background: '#fef9c3', color: '#854d0e' };
  return { background: '#f2f4f7', color: '#475467' };
}



export default function PlayerProfile() {
  const { playerId } = useParams();
  const [player, setPlayer] = useState(null);
  const [ageProjection, setAgeProjection] = useState(null);
  const [ageProjectionError, setAgeProjectionError] = useState('');
  const [valueTrend, setValueTrend] = useState(null);
  const [valueTrendError, setValueTrendError] = useState('');
  const [careerComps, setCareerComps] = useState(null);
  const [careerCompsError, setCareerCompsError] = useState('');
  const [usageTrend, setUsageTrend] = useState(null);
  const [usageTrendError, setUsageTrendError] = useState('');
  const [scheduleSos, setScheduleSos] = useState(null);
  const [scheduleSosError, setScheduleSosError] = useState('');
  const [potentialBuyers, setPotentialBuyers] = useState(null);
  const [potentialBuyersError, setPotentialBuyersError] = useState('');
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
    setCareerComps(null);
    setCareerCompsError('');
    setUsageTrend(null);
    setUsageTrendError('');
    setScheduleSos(null);
    setScheduleSosError('');
    setPotentialBuyers(null);
    setPotentialBuyersError('');
    fetch(`/fantasy/players/${playerId}/profile`)
      .then((res) => {
        if (!res.ok) throw new Error(`Player not found (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setPlayer(data);
        setValueTrend(data.value_trend || null);
        setCareerComps(data.career_comps ? { comps: data.career_comps } : null);
        setUsageTrend(data.usage_trend || null);
        setScheduleSos(data.schedule_sos || null);
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

    fetch(`/fantasy/players/${playerId}/career-comps?limit=3`)
      .then((res) => {
        if (!res.ok) throw new Error(`Career comps unavailable (${res.status})`);
        return res.json();
      })
      .then((data) => setCareerComps(data))
      .catch((err) => setCareerCompsError(err.message));

    fetch(`/fantasy/players/${playerId}/usage`)
      .then((res) => {
        if (!res.ok) throw new Error(`Usage trend unavailable (${res.status})`);
        return res.json();
      })
      .then((data) => setUsageTrend(data))
      .catch((err) => setUsageTrendError(err.message));

    fetch(`/fantasy/players/${playerId}/schedule-sos?weeks=8`)
      .then((res) => {
        if (!res.ok) throw new Error(`Schedule SOS unavailable (${res.status})`);
        return res.json();
      })
      .then((data) => setScheduleSos(data))
      .catch((err) => setScheduleSosError(err.message));

    fetch(`/fantasy/players/${playerId}/potential-buyers?limit=8`)
      .then((res) => {
        if (!res.ok) throw new Error(`Potential buyers unavailable (${res.status})`);
        return res.json();
      })
      .then((data) => setPotentialBuyers(data))
      .catch((err) => setPotentialBuyersError(err.message));

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
            {/* Player Header Skeleton */}
            <LoadingSkeleton avatar={true} badge={false} rows={2} style={{ padding: 24 }} />

            {/* Key Metrics Skeleton */}
            <div
              style={{
                display: 'grid',
                gap: 14,
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              }}
            >
              {Array.from({ length: 7 }).map((_, i) => (
                <LoadingSkeleton key={i} avatar={false} badge={false} rows={2} style={{ padding: 16, textAlign: 'center' }} />
              ))}
            </div>

            {/* Recent Stats Skeleton */}
            <section
              style={{
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <LoadingSkeleton rows={1} badge={false} style={{ width: '40%', marginBottom: 14 }} /> {/* Title */}
              <LoadingSkeleton rows={5} badge={false} avatar={false} style={{ height: 'auto' }} /> {/* Table content as a block */}
            </section>

            {/* Comparable Players Skeleton */}
            <section
              style={{
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <LoadingSkeleton rows={1} badge={false} style={{ width: '50%', marginBottom: 14 }} /> {/* Title */}
              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                }}
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <LoadingSkeleton key={i} avatar={false} badge={true} rows={1} metrics={2} style={{ padding: 14, background: '#f8fafc' }} />
                ))}
              </div>
            </section>
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
              compTrajectories={careerComps?.comps || []}
              title="Player value trend"
              emptyMessage="Need at least two player value snapshots before the BUY/SELL/HOLD signal can render."
              signal={valueTrend?.signal}
              slope30={valueTrend?.slope_30d ?? null}
              slope90={valueTrend?.slope_90d ?? null}
            />
            {valueTrendError && (
              <p style={{ color: '#b42318', margin: '-8px 0 0' }}>{valueTrendError}</p>
            )}
            {careerCompsError && (
              <p style={{ color: '#b42318', margin: '-8px 0 0' }}>{careerCompsError}</p>
            )}

            <AgeCurveChart projection={ageProjection} />
            {ageProjectionError && (
              <p style={{ color: '#b42318', margin: '-8px 0 0' }}>{ageProjectionError}</p>
            )}

            <section
              style={{
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <div
                style={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginBottom: 14,
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>Schedule Difficulty</h2>
                  <p style={{ color: '#667085', margin: '4px 0 0' }}>
                    Next eight opponents scored from defensive fantasy points allowed to {player.position}.
                  </p>
                </div>
                <span
                  style={{
                    ...sosColor(scheduleSos?.sos_score),
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    padding: '5px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {scheduleSos?.sos_score != null
                    ? `${scheduleSos.sos_score}/100 ${scheduleSos.sos_label}`
                    : 'Unavailable'}
                </span>
              </div>
              {scheduleSosError && <p style={{ color: '#b42318' }}>{scheduleSosError}</p>}
              {scheduleSos?.opponents?.length > 0 ? (
                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))',
                  }}
                >
                  {scheduleSos.opponents.map((matchup) => {
                    const colors = sosColor(matchup.matchup_score);
                    return (
                      <article
                        key={`${matchup.season}-${matchup.week}-${matchup.opponent}`}
                        style={{
                          ...colors,
                          borderRadius: 8,
                          padding: 12,
                          textAlign: 'center',
                        }}
                        title={
                          matchup.avg_points_allowed != null
                            ? `${matchup.avg_points_allowed} points allowed to ${player.position}`
                            : 'No defensive sample yet'
                        }
                      >
                        <div style={{ fontSize: 12, fontWeight: 700 }}>W{matchup.week}</div>
                        <strong style={{ display: 'block', fontSize: 18, marginTop: 4 }}>
                          {matchup.opponent || 'BYE'}
                        </strong>
                        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                          {matchup.matchup_score != null ? matchup.matchup_score : '--'}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p style={{ color: '#667085', margin: 0 }}>
                  {scheduleSos?.reason || 'Upcoming schedule data is not available yet.'}
                </p>
              )}
            </section>

            <section
              style={{
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <div
                style={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginBottom: 14,
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>Usage Trend</h2>
                  <p style={{ color: '#667085', margin: '4px 0 0' }}>
                    Weekly target share and snap rate from Sleeper stats.
                  </p>
                </div>
                <span
                  style={{
                    background: usageTrend?.rising_target_share ? '#dcfce7' : '#f2f4f7',
                    borderRadius: 999,
                    color: usageTrend?.rising_target_share ? '#166534' : '#475467',
                    fontSize: 12,
                    fontWeight: 800,
                    padding: '5px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {usageTrend?.rising_target_share ? 'Rising target share' : 'Stable target share'}
                </span>
              </div>
              {usageTrendError && <p style={{ color: '#b42318' }}>{usageTrendError}</p>}
              {usageTrend?.history?.length > 0 ? (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      marginBottom: 14,
                    }}
                  >
                    <StatRow label="Latest target share" value={formatPercent(usageTrend.latest?.target_share)} />
                    <StatRow label="Latest snap rate" value={formatPercent(usageTrend.latest?.snap_pct)} />
                    <StatRow
                      label="4-week target avg"
                      value={formatPercent(usageTrend.rolling_4_week_avg_target_share)}
                    />
                    <StatRow
                      label="Target share delta"
                      value={usageTrend.rolling_delta != null ? formatPercent(usageTrend.rolling_delta) : 'N/A'}
                    />
                  </div>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #d9dee7' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Week</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Team</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Targets</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Target Share</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Snap Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageTrend.history.map((week) => (
                        <tr key={`${week.season}-${week.week}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 12px', color: '#475467' }}>
                            {week.season} W{week.week}
                          </td>
                          <td style={{ padding: '10px 12px' }}>{week.team || 'N/A'}</td>
                          <td style={{ padding: '10px 12px' }}>
                            {week.targets != null ? Number(week.targets).toLocaleString() : 'N/A'}
                          </td>
                          <td style={{ padding: '10px 12px' }}>{formatPercent(week.target_share)}</td>
                          <td style={{ padding: '10px 12px' }}>{formatPercent(week.snap_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p style={{ color: '#667085', margin: 0 }}>
                  No weekly usage stats have been synced for this player yet.
                </p>
              )}
            </section>

            <section
              style={{
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <div
                style={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginBottom: 14,
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>Potential Buyers</h2>
                  <p style={{ color: '#667085', margin: '4px 0 0' }}>
                    Managers with below-average {player.position} depth and value across synced leagues.
                  </p>
                </div>
                <span
                  style={{
                    background: '#eff6ff',
                    borderRadius: 999,
                    color: '#1d4ed8',
                    fontSize: 12,
                    fontWeight: 800,
                    padding: '5px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {potentialBuyers?.buyers?.length || 0} matches
                </span>
              </div>
              {potentialBuyersError && <p style={{ color: '#b42318' }}>{potentialBuyersError}</p>}
              {!potentialBuyers && !potentialBuyersError && (
                <p style={{ color: '#667085', margin: 0 }}>Checking league rosters...</p>
              )}
              {potentialBuyers?.buyers?.length > 0 ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {potentialBuyers.buyers.map((buyer) => {
                    const scoreColors = buyerScoreColor(buyer.score);
                    return (
                      <article
                        key={`${buyer.league_id}-${buyer.roster_id}`}
                        style={{
                          border: '1px solid #d9dee7',
                          borderRadius: 8,
                          padding: 14,
                          background: '#f8fafc',
                        }}
                      >
                        <div
                          style={{
                            alignItems: 'flex-start',
                            display: 'flex',
                            gap: 12,
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 800 }}>{buyer.manager}</div>
                            <div style={{ color: '#667085', fontSize: 13, marginTop: 2 }}>
                              {buyer.league_name || buyer.league_id}
                            </div>
                          </div>
                          <span
                            style={{
                              ...scoreColors,
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 800,
                              padding: '4px 9px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {buyer.score}/100 fit
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gap: 10,
                            gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                            marginTop: 12,
                          }}
                        >
                          <StatRow
                            label={`${buyer.position} value gap`}
                            value={Number(buyer.value_gap || 0).toLocaleString()}
                          />
                          <StatRow
                            label={`${buyer.position} depth`}
                            value={`${buyer.position_count} vs ${buyer.league_avg_position_count}`}
                          />
                        </div>
                        <p style={{ color: '#475467', margin: '10px 0 0' }}>{buyer.reason}</p>
                        {buyer.top_position_players?.length > 0 && (
                          <div style={{ color: '#667085', fontSize: 13, marginTop: 8 }}>
                            Current {buyer.position}: {' '}
                            {buyer.top_position_players
                              .map((slot) => `${slot.name} (${Number(slot.value || 0).toLocaleString()})`)
                              .join(', ')}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                potentialBuyers && !potentialBuyersError && (
                  <p style={{ color: '#667085', margin: 0 }}>
                    No strong buyer matches found for this position in synced rosters.
                  </p>
                )
              )}
            </section>

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
