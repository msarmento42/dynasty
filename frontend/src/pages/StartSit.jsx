import { useState, useEffect, useCallback } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
import LoadingSkeleton from '../components/LoadingSkeleton.jsx';

const POS_COLORS = {
  QB: { bg: '#fef3c7', text: '#92400e' },
  RB: { bg: '#dcfce7', text: '#166534' },
  WR: { bg: '#dbeafe', text: '#1e40af' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
};

function InjuryBadge({ status }) {
  if (!status) return <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 12 }}>Healthy</span>;
  const s = status.toUpperCase();
  let color = '#6b7280';
  if (s === 'OUT') color = '#dc2626';
  else if (s === 'DOUBTFUL') color = '#ea580c';
  else if (s === 'QUESTIONABLE') color = '#ca8a04';
  else if (s === 'PROBABLE') color = '#16a34a';
  return (
    <span style={{
      background: color + '20',
      border: `1px solid ${color}60`,
      borderRadius: 4,
      color,
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 6px',
    }}>
      {status}
    </span>
  );
}

function PosBadge({ pos }) {
  const c = POS_COLORS[pos] || { bg: '#f3f4f6', text: '#374151' };
  return (
    <span style={{
      background: c.bg,
      borderRadius: 4,
      color: c.text,
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 6px',
    }}>
      {pos}
    </span>
  );
}

function PlayerCard({ player, compact }) {
  if (!player) return null;
  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <PosBadge pos={player.position} />
      <strong style={{ fontSize: compact ? 13 : 15 }}>{player.name}</strong>
      {player.team && <span style={{ color: '#6b7280', fontSize: 12 }}>{player.team}</span>}
      <InjuryBadge status={player.injury_status} />
      <span style={{ color: '#9ca3af', fontSize: 12 }}>Score: {player.score}</span>
    </div>
  );
}

const POS_ORDER = ['QB', 'RB', 'WR', 'TE'];

export default function StartSit() {
  const [leagueId, setLeagueId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePos, setActivePos] = useState('ALL');

  const load = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/fantasy/startsit/${id}`);
      if (!res.ok) throw new Error('Unable to load start/sit data');
      setData(await res.json());
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSelect(id) {
    setLeagueId(id);
    load(id);
  }

  const recs = data
    ? (activePos === 'ALL'
        ? data.recommendations
        : data.recommendations.filter(
            (r) =>
              r.player_in?.position === activePos ||
              r.player_out?.position === activePos
          ))
    : [];

  const lineupPositions = data ? POS_ORDER.filter((p) => data.optimal_lineup?.[p]?.length) : [];

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 22, margin: '0 auto', maxWidth: 1040 }}>
        <h1 style={{ margin: 0 }}>Start / Sit</h1>
        <LeagueSelector onSelect={handleSelect} />

        {error && <p style={{ color: '#b42318' }}>{error}</p>}
        {loading && !data && (
          <div style={{ display: 'grid', gap: 12 }}>
            <LoadingSkeleton rows={3} metrics={2} />
            <LoadingSkeleton rows={3} metrics={2} />
            <LoadingSkeleton rows={3} metrics={2} />
          </div>
        )}

        {data && (
          <>
            {/* Optimal Lineup Card */}
            <article style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 10, padding: 20 }}>
              <h2 style={{ fontSize: 16, margin: '0 0 16px' }}>Optimal Lineup</h2>
              <div style={{ display: 'grid', gap: 12 }}>
                {lineupPositions.map((pos) => (
                  <div key={pos}>
                    <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
                      {pos}
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {data.optimal_lineup[pos].map((p) => (
                        <div key={p.sleeper_id} style={{
                          alignItems: 'center',
                          background: '#f9fafb',
                          borderRadius: 6,
                          display: 'flex',
                          gap: 10,
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                        }}>
                          <PlayerCard player={p} />
                          <span style={{ color: '#374151', fontWeight: 700 }}>{p.value_sf.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>

            {/* Recommendations */}
            <div>
              <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Recommendations</h2>

              {/* Position tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {['ALL', 'QB', 'RB', 'WR', 'TE'].map((p) => (
                  <button
                    key={p}
                    onClick={() => setActivePos(p)}
                    style={{
                      background: activePos === p ? '#3b82f6' : '#fff',
                      border: '1px solid ' + (activePos === p ? '#3b82f6' : '#d1d5db'),
                      borderRadius: 6,
                      color: activePos === p ? '#fff' : '#374151',
                      cursor: 'pointer',
                      fontWeight: 600,
                      padding: '6px 14px',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {recs.length === 0 ? (
                <div style={{
                  background: '#dcfce7',
                  border: '1px solid #86efac',
                  borderRadius: 10,
                  color: '#166534',
                  fontWeight: 700,
                  padding: 20,
                  textAlign: 'center',
                }}>
                  Your lineup looks great this week! ✓
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {recs.map((rec, i) => {
                    const isStart = rec.action === 'START';
                    const borderColor = isStart ? '#22c55e' : '#ef4444';
                    const bgColor = isStart ? '#f0fdf4' : '#fef2f2';
                    return (
                      <article
                        key={i}
                        style={{
                          background: bgColor,
                          border: `2px solid ${borderColor}`,
                          borderRadius: 10,
                          padding: 16,
                        }}
                      >
                        <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 10 }}>
                          <span style={{
                            background: borderColor,
                            borderRadius: 4,
                            color: '#fff',
                            fontSize: 12,
                            fontWeight: 800,
                            padding: '2px 8px',
                          }}>
                            {rec.action}
                          </span>
                          {rec.value_diff > 0 && (
                            <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 700 }}>
                              +{rec.value_diff} pts
                            </span>
                          )}
                        </div>

                        {rec.action === 'START' && rec.player_in && rec.player_out ? (
                          <div style={{ display: 'grid', gap: 8 }}>
                            <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                              <span style={{ color: '#16a34a', fontWeight: 700, width: 28, flexShrink: 0 }}>IN</span>
                              <PlayerCard player={rec.player_in} />
                            </div>
                            <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                              <span style={{ color: '#dc2626', fontWeight: 700, width: 28, flexShrink: 0 }}>OUT</span>
                              <PlayerCard player={rec.player_out} />
                            </div>
                          </div>
                        ) : (
                          <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                            <span style={{ color: '#dc2626', fontWeight: 700, width: 28, flexShrink: 0 }}>SIT</span>
                            <PlayerCard player={rec.player_out} />
                          </div>
                        )}

                        {rec.reason && (
                          <p style={{ color: '#374151', fontSize: 13, margin: '10px 0 0' }}>{rec.reason}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
