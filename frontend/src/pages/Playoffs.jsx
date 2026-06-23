import { useCallback, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';

const POSITION_COLORS = {
  QB: '#dc2626',
  RB: '#16a34a',
  WR: '#2563eb',
  TE: '#ca8a04',
};

function probabilityColor(pct) {
  if (pct >= 75) return '#15803d';
  if (pct >= 50) return '#ca8a04';
  return '#b42318';
}

function probabilityBg(pct) {
  if (pct >= 75) return '#dcfce7';
  if (pct >= 50) return '#fef9c3';
  return '#fee2e2';
}

export default function Playoffs() {
  const [leagueId, setLeagueId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runSimulation = useCallback(async (lid) => {
    const targetLeague = lid || leagueId;
    if (!targetLeague) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ simulations: 10000 });
      if (targetLeague) params.set('league_id', targetLeague);
      const res = await fetch(`/api/playoff/simulate?${params}`);
      if (!res.ok) throw new Error('Simulation failed');
      setData(await res.json());
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  function handleLeagueSelect(lid) {
    setLeagueId(lid);
    runSimulation(lid);
  }

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 900 }}>
        <div style={{ display: 'grid', gap: 18, marginBottom: 24 }}>
          <h1 style={{ margin: 0 }}>Playoff Odds Simulator</h1>
          <p style={{ color: '#667085', margin: 0 }}>
            Monte Carlo simulation — 10,000 seasons to estimate each team's playoff probability.
          </p>
          <LeagueSelector onSelect={handleLeagueSelect} />
          <button
            disabled={loading || !leagueId}
            onClick={() => runSimulation()}
            style={{
              background: '#1d4ed8',
              border: 0,
              borderRadius: 8,
              color: '#ffffff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 800,
              opacity: loading ? 0.7 : 1,
              padding: '10px 20px',
              width: 200,
            }}
          >
            {loading ? 'Simulating…' : 'Run Simulation'}
          </button>
        </div>

        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {data && !loading && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 8,
                display: 'flex',
                gap: 24,
                flexWrap: 'wrap',
                padding: '14px 18px',
              }}
            >
              <span style={{ color: '#475467' }}>
                Teams: <strong>{data.n_teams}</strong>
              </span>
              <span style={{ color: '#475467' }}>
                Playoff spots: <strong>{data.playoff_spots}</strong>
              </span>
              <span style={{ color: '#475467' }}>
                Weeks remaining: <strong>{data.weeks_remaining}</strong>
              </span>
              <span style={{ color: '#475467' }}>
                Simulations: <strong>{data.simulations.toLocaleString()}</strong>
              </span>
            </div>

            <table style={{ background: '#ffffff', border: '1px solid #d9dee7', borderCollapse: 'collapse', borderRadius: 8, overflow: 'hidden', width: '100%' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #d9dee7' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700 }}>#</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700 }}>Team</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700 }}>Record</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700 }}>Avg Wins</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700 }}>Playoff Odds</th>
                </tr>
              </thead>
              <tbody>
                {data.teams.map((team, idx) => {
                  const pct = team.playoff_probability;
                  const color = probabilityColor(pct);
                  const bg = probabilityBg(pct);
                  const isPlayoffSpot = idx < data.playoff_spots;
                  return (
                    <tr
                      key={team.roster_id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isPlayoffSpot ? '#f0fdf4' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '12px 16px', color: '#667085', fontWeight: 600 }}>{idx + 1}</td>
                      <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                        {team.team_name}
                        {isPlayoffSpot && (
                          <span
                            style={{
                              background: '#dcfce7',
                              borderRadius: 999,
                              color: '#15803d',
                              fontSize: 11,
                              fontWeight: 700,
                              marginLeft: 8,
                              padding: '2px 8px',
                            }}
                          >
                            IN
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#475467' }}>{team.current_record}</td>
                      <td style={{ padding: '12px 16px', color: '#475467' }}>{team.avg_wins}</td>
                      <td style={{ padding: '12px 16px', minWidth: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                            <div
                              style={{
                                background: color,
                                borderRadius: 999,
                                height: '100%',
                                width: `${pct}%`,
                                transition: 'width 0.4s ease',
                              }}
                            />
                          </div>
                          <span
                            style={{
                              background: bg,
                              borderRadius: 6,
                              color,
                              fontSize: 13,
                              fontWeight: 800,
                              minWidth: 52,
                              padding: '3px 8px',
                              textAlign: 'right',
                            }}
                          >
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p style={{ color: '#94a3b8', fontSize: 12, margin: 0 }}>
              Probabilities based on {data.simulations.toLocaleString()} simulated seasons.
              Win probability each week weighted by roster dynasty value.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
