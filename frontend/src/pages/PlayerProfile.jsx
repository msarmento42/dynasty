import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

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

export default function PlayerProfile() {
  const { playerId } = useParams();
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!playerId) return;
    setLoading(true);
    setError('');
    fetch(`/fantasy/players/${playerId}/profile`)
      .then((res) => {
        if (!res.ok) throw new Error(`Player not found (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setPlayer(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [playerId]);

  const positionColor = player ? (POSITION_COLORS[player.position] || '#475569') : '#475569';

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 820 }}>
        <Link
          to="/"
          style={{ color: '#1d4ed8', display: 'inline-block', marginBottom: 18, textDecoration: 'none' }}
        >
          ← Back to Roster
        </Link>

        {loading && <p>Loading player profile…</p>}
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

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
                { label: 'Dynasty Value', value: Number(player.dynasty_value || 0).toLocaleString() },
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
              ].map(({ label, value }) => (
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
                </article>
              ))}
            </div>

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
