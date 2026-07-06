import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LevelBadge, PosBadge } from './BaseballHome.jsx';
import StatcastPercentileChart from '../../components/StatcastPercentileChart.jsx';

const API = import.meta.env.VITE_API_URL || '';

// Key stats to display per type
const HITTING_KEYS = ['gamesPlayed', 'avg', 'obp', 'slg', 'ops', 'homeRuns', 'rbi', 'stolenBases', 'strikeOuts', 'atBats'];
const PITCHING_KEYS = ['gamesStarted', 'era', 'whip', 'strikeOuts', 'inningsPitched', 'wins', 'losses', 'saves', 'strikeoutsPer9Inn', 'walksPer9Inn'];

const STAT_LABELS = {
  gamesPlayed: 'G', avg: 'AVG', obp: 'OBP', slg: 'SLG', ops: 'OPS',
  homeRuns: 'HR', rbi: 'RBI', stolenBases: 'SB', strikeOuts: 'K', atBats: 'AB',
  gamesStarted: 'GS', era: 'ERA', whip: 'WHIP', inningsPitched: 'IP',
  wins: 'W', losses: 'L', saves: 'SV', strikeoutsPer9Inn: 'K/9', walksPer9Inn: 'BB/9',
};

function isPitcher(pos) {
  return ['SP', 'RP', 'P', 'TWP'].includes((pos || '').toUpperCase());
}

export default function PlayerPage() {
  const { mlbId } = useParams();
  const navigate = useNavigate();
  const [player, setPlayer] = useState(null);
  const [career, setCareer] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addStatus, setAddStatus] = useState('');
  const [adding, setAdding] = useState(false);

  // Dummy Statcast data for demonstration
  const dummyStatcastData = [
    { metricName: 'xwOBA', percentileValue: 85 },
    { metricName: 'Barrel%', percentileValue: 70 },
    { metricName: 'Sprint Speed', percentileValue: 92 },
    { metricName: 'Hard Hit%', percentileValue: 65 },
    { metricName: 'K%', percentileValue: 40 },
    { metricName: 'BB%', percentileValue: 75 },
  ];

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API}/api/baseball/players/${mlbId}`);
        if (!res.ok) throw new Error(`Player not found (${res.status})`);
        const data = await res.json();
        setPlayer(data.player);
        setCareer(data.career || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [mlbId]);

  const handleAddToRoster = async () => {
    setAdding(true);
    setAddStatus('');
    try {
      const res = await fetch(`${API}/api/baseball/roster/${mlbId}`, { method: 'POST' });
      if (res.status === 409) {
        setAddStatus('Already on your roster');
        return;
      }
      if (!res.ok) throw new Error('Failed to add');
      setAddStatus('Added to roster!');
    } catch (err) {
      setAddStatus(`Error: ${err.message}`);
    } finally {
      setAdding(false);
    }
  };

  if (loading) return (
    <main style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: 40, textAlign: 'center' }}>
      <p style={{ color: 'var(--text-secondary)' }}>Loading player profile...</p>
    </main>
  );

  if (error) return (
    <main style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: 40 }}>
      <p style={{ color: '#b42318' }}>{error}</p>
      <button onClick={() => navigate(-1)} style={{ marginTop: 12 }}>Back</button>
    </main>
  );

  if (!player) return null;

  const pitching = isPitcher(player.position);
  const statKeys = pitching ? PITCHING_KEYS : HITTING_KEYS;
  const statGroup = pitching ? 'pitching' : 'hitting';

  // Build level progression (unique levels in career, ordered)
  const LEVEL_ORDER = ['Rookie', 'A', 'A+', 'AA', 'AAA', 'MLB'];
  const levelsReached = [...new Set(career.map((r) => r.level))];
  const progressionLevels = LEVEL_ORDER.filter((l) => levelsReached.includes(l));

  return (
    <main style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 13,
            padding: '0 0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          ← Back
        </button>

        {/* Player header */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
          padding: 22,
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <h1 style={{ margin: 0, fontSize: 26 }}>{player.name}</h1>
                <PosBadge pos={player.position} />
                <LevelBadge level={player.level} />
              </div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: 13 }}>
                {player.team && <span>Team: <strong style={{ color: 'var(--text-primary)' }}>{player.team}</strong></span>}
                {player.age && <span>Age: <strong style={{ color: 'var(--text-primary)' }}>{player.age}</strong></span>}
                {player.bats && <span>Bats/Throws: <strong style={{ color: 'var(--text-primary)' }}>{player.bats}/{player.throws}</strong></span>}
                {player.birth_date && <span>Born: <strong style={{ color: 'var(--text-primary)' }}>{player.birth_date}</strong></span>}
                {player.draft_year && <span>Draft: <strong style={{ color: 'var(--text-primary)' }}>{player.draft_year}</strong></span>}
                {player.debut_year && <span>Debut: <strong style={{ color: 'var(--text-primary)' }}>{player.debut_year}</strong></span>}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <button
                onClick={handleAddToRoster}
                disabled={adding}
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 7,
                  padding: '9px 18px',
                  fontWeight: 700,
                  cursor: adding ? 'wait' : 'pointer',
                  fontSize: 13,
                }}
              >
                {adding ? 'Adding...' : '+ Add to Roster'}
              </button>
              {addStatus && (
                <span style={{ fontSize: 12, color: addStatus.startsWith('Error') ? '#b42318' : '#16a34a' }}>
                  {addStatus}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Statcast Percentiles */}
        <StatcastPercentileChart metrics={dummyStatcastData} />

        {/* Level progression */}
        {progressionLevels.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            padding: '16px 20px',
            marginBottom: 20,
          }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Level Progression
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
              {progressionLevels.map((level, i) => (
                <div key={level} style={{ display: 'flex', alignItems: 'center' }}>
                  <LevelBadge level={level} />
                  {i < progressionLevels.length - 1 && (
                    <span style={{ color: 'var(--text-secondary)', margin: '0 6px', fontSize: 14 }}>→</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Career stats table */}
        {career.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Career Stats</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={thStyle}>Season</th>
                    <th style={thStyle}>Level</th>
                    <th style={thStyle}>Team</th>
                    {statKeys.map((k) => (
                      <th key={k} style={{ ...thStyle, textAlign: 'right' }}>{STAT_LABELS[k] || k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {career.map((row, i) => {
                    const stats = row[statGroup] || {};
                    const hasStats = Object.keys(stats).length > 0;
                    return (
                      <tr
                        key={i}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          opacity: hasStats ? 1 : 0.5,
                        }}
                      >
                        <td style={tdStyle}>{row.season}</td>
                        <td style={tdStyle}><LevelBadge level={row.level} /></td>
                        <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{row.team || '—'}</td>
                        {statKeys.map((k) => (
                          <td key={k} style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {formatStat(k, stats[k])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {career.length === 0 && !loading && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            padding: 32,
            textAlign: 'center',
            color: 'var(--text-secondary)',
          }}>
            No career stats available for this player.
          </div>
        )}
      </div>
    </main>
  );
}

const thStyle = {
  padding: '9px 12px',
  textAlign: 'left',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '8px 12px',
  whiteSpace: 'nowrap',
};

function formatStat(key, val) {
  if (val === undefined || val === null || val === '') return '—';
  const ratios = ['avg', 'obp', 'slg', 'ops', 'era', 'whip', 'strikeoutsPer9Inn', 'walksPer9Inn'];
  if (ratios.includes(key)) {
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    if (['avg', 'obp', 'slg', 'ops'].includes(key)) return n.toFixed(3);
    return n.toFixed(2);
  }
  return val;
}
