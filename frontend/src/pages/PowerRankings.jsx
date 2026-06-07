import { useCallback, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';

function formatValue(value) {
  return Number(value || 0).toLocaleString();
}

function deltaText(value) {
  const delta = Number(value || 0);
  if (delta === 0) {
    return 'Leader';
  }
  return delta.toLocaleString();
}

function tierStyle(rank, totalTeams) {
  if (rank <= 3) {
    return {
      background: '#fffbeb',
      borderLeft: '4px solid #f59e0b',
    };
  }

  if (rank > Math.max(totalTeams - 3, 3)) {
    return {
      background: '#fef2f2',
      borderLeft: '4px solid #dc2626',
    };
  }

  return {
    background: '#ffffff',
    borderLeft: '4px solid #d9dee7',
  };
}

function SparklinePlaceholder() {
  return (
    <span
      aria-label="Trend pending"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        height: '16px',
      }}
    >
      {[6, 10, 7, 12, 9].map((height, index) => (
        <span
          key={index}
          style={{
            width: '4px',
            height: `${height}px`,
            borderRadius: '999px',
            background: '#b7c0d1',
            display: 'inline-block',
          }}
        />
      ))}
    </span>
  );
}

export default function PowerRankings() {
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadRankings = useCallback(async (league) => {
    if (!league?.league_id) {
      return;
    }

    setSelectedLeague(league);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/fantasy/league/${league.league_id}/power-rankings`);
      if (!response.ok) {
        throw new Error('Unable to load power rankings.');
      }
      const data = await response.json();
      setRankings(data);
    } catch (err) {
      setError(err.message || 'Unable to load power rankings.');
      setRankings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <main style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 8px' }}>Power Rankings</h1>
        <p style={{ margin: 0, color: '#536176' }}>
          Ranked dynasty value by starters, bench depth, and draft capital.
        </p>
      </header>

      <LeagueSelector onSelect={loadRankings} />

      {selectedLeague && (
        <section style={{ marginTop: '24px' }}>
          <h2 style={{ margin: '0 0 16px' }}>{selectedLeague.name}</h2>

          {loading && <p>Loading power rankings...</p>}
          {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

          {!loading && !error && rankings.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px' }}>
                <thead>
                  <tr style={{ color: '#536176', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px' }}>Rank</th>
                    <th style={{ padding: '8px 12px' }}>Team</th>
                    <th style={{ padding: '8px 12px' }}>Total</th>
                    <th style={{ padding: '8px 12px' }}>Starters</th>
                    <th style={{ padding: '8px 12px' }}>Bench</th>
                    <th style={{ padding: '8px 12px' }}>Picks</th>
                    <th style={{ padding: '8px 12px' }}>Delta from #1</th>
                    <th style={{ padding: '8px 12px' }}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((team) => (
                    <tr key={team.roster_id} style={tierStyle(team.rank, rankings.length)}>
                      <td style={{ padding: '14px 12px', fontWeight: 700 }}>#{team.rank}</td>
                      <td style={{ padding: '14px 12px' }}>
                        <strong>{team.owner_display_name}</strong>
                        {team.is_mine && (
                          <span
                            style={{
                              marginLeft: '8px',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              background: '#dbeafe',
                              color: '#1d4ed8',
                              fontSize: '12px',
                              fontWeight: 700,
                            }}
                          >
                            My team
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px 12px', fontWeight: 700 }}>{formatValue(team.total_value)}</td>
                      <td style={{ padding: '14px 12px' }}>{formatValue(team.starter_value)}</td>
                      <td style={{ padding: '14px 12px' }}>{formatValue(team.bench_value)}</td>
                      <td style={{ padding: '14px 12px' }}>{formatValue(team.pick_value)}</td>
                      <td style={{ padding: '14px 12px' }}>{deltaText(team.delta_from_1)}</td>
                      <td style={{ padding: '14px 12px' }}><SparklinePlaceholder /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && rankings.length === 0 && (
            <p>No rankings available for this league yet.</p>
          )}
        </section>
      )}
    </main>
  );
}
