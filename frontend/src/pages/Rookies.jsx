import { useCallback, useEffect, useMemo, useState } from 'react';

const FORMAT_OPTIONS = [
  { label: 'SF', numQbs: 2 },
  { label: '1QB', numQbs: 1 },
];

function formatValue(value) {
  return Number(value || 0).toLocaleString();
}

function trendText(value) {
  const trend = Number(value || 0);
  return trend > 0 ? `+${trend}` : String(trend);
}

function PlayerCard({ player }) {
  const trend = Number(player.trend_30d || 0);
  const trendColor = trend >= 0 ? '#15803d' : '#b42318';

  return (
    <article
      style={{
        background: '#ffffff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        display: 'grid',
        gap: 12,
        padding: 14,
      }}
    >
      <div style={{ alignItems: 'start', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: '#667085', fontSize: 13, fontWeight: 800 }}>#{player.rookie_rank}</div>
          <h2 style={{ fontSize: 18, margin: '2px 0' }}>{player.name}</h2>
          <div style={{ color: '#667085', fontSize: 13 }}>
            {player.position || 'FA'} {player.team ? `- ${player.team}` : ''}
          </div>
        </div>
        <span
          style={{
            background: '#eef2ff',
            borderRadius: 999,
            color: '#3730a3',
            fontSize: 12,
            fontWeight: 800,
            padding: '4px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {player.career_stage || 'rookie'}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>Dynasty value</span>
          <strong>{formatValue(player.adjusted_value)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>30-day trend</span>
          <strong style={{ color: trendColor }}>{trendText(player.trend_30d)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#475467' }}>Trajectory</span>
          <strong>{player.trajectory || '='}</strong>
        </div>
      </div>
    </article>
  );
}

export default function Rookies() {
  const [format, setFormat] = useState(2);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadRookies = useCallback(async (numQbs) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/fantasy/rookies?num_qbs=${numQbs}`);
      if (!response.ok) {
        throw new Error('Unable to load rookie rankings');
      }
      const data = await response.json();
      setPlayers(data);
    } catch (err) {
      setPlayers([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRookies(format);
  }, [format, loadRookies]);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => Number(b.adjusted_value || 0) - Number(a.adjusted_value || 0)),
    [players],
  );

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 24, margin: '0 auto', maxWidth: 1120 }}>
        <header style={{ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0 }}>Rookies</h1>
            <p style={{ color: '#536176', margin: '8px 0 0' }}>
              2026 rookie class ranked by current dynasty value.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {FORMAT_OPTIONS.map((option) => (
              <button
                key={option.numQbs}
                type="button"
                onClick={() => setFormat(option.numQbs)}
                style={{
                  background: format === option.numQbs ? '#111827' : '#ffffff',
                  border: '1px solid #d0d5dd',
                  borderRadius: 6,
                  color: format === option.numQbs ? '#ffffff' : '#344054',
                  cursor: 'pointer',
                  fontWeight: 800,
                  minHeight: 38,
                  padding: '8px 14px',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        {loading && <p>Loading...</p>}
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {!loading && !error && sortedPlayers.length > 0 && (
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            }}
          >
            {sortedPlayers.map((player) => (
              <PlayerCard key={player.sleeper_id} player={player} />
            ))}
          </div>
        )}

        {!loading && !error && sortedPlayers.length === 0 && (
          <p>No rookie rankings available yet.</p>
        )}
      </section>
    </main>
  );
}
