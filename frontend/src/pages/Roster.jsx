import { useCallback, useMemo, useState } from 'react';
import AgeCurveChart from '../components/AgeCurveChart.jsx';
import LeagueSelector from '../components/LeagueSelector.jsx';
import PlayerCard from '../components/PlayerCard.jsx';
import RosterGrade from '../components/RosterGrade.jsx';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export default function Roster() {
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [rosterData, setRosterData] = useState(null);
  const [rosterGrade, setRosterGrade] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadRoster = useCallback(async (leagueId) => {
    setSelectedLeague(leagueId);
    setLoading(true);
    setError('');

    try {
      const [rosterResponse, gradesResponse] = await Promise.all([
        fetch(`/fantasy/league/${leagueId}/roster`),
        fetch(`/fantasy/league/${leagueId}/grades`),
      ]);
      if (!rosterResponse.ok) {
        throw new Error('Unable to load roster');
      }
      if (!gradesResponse.ok) {
        throw new Error('Unable to load roster grade');
      }

      const nextRosterData = await rosterResponse.json();
      const grades = await gradesResponse.json();
      const mine = grades.find((grade) => grade.is_mine || grade.roster_id === nextRosterData.my_roster_id);

      setRosterData(nextRosterData);
      setRosterGrade(mine || null);
    } catch (err) {
      setRosterData(null);
      setRosterGrade(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const groupedPlayers = useMemo(() => {
    const players = rosterData?.players || [];
    return players.reduce((groups, player) => {
      const position = player.position || 'Other';
      const currentGroup = groups[position] || [];
      return { ...groups, [position]: [...currentGroup, player] };
    }, {});
  }, [rosterData]);

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1120 }}>
        <div style={{ display: 'grid', gap: 18, marginBottom: 24 }}>
          <h1 style={{ margin: 0 }}>Roster</h1>
          <LeagueSelector onSelect={loadRoster} />
        </div>

        {loading && <p>Loading...</p>}
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {rosterData && !loading && (
          <div style={{ display: 'grid', gap: 24 }}>
            <header
              style={{
                alignItems: 'center',
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 8,
                display: 'flex',
                gap: 16,
                justifyContent: 'space-between',
                padding: 18,
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>{rosterData.league_name}</h2>
                <p style={{ color: '#667085', margin: '4px 0 0' }}>Selected league: {selectedLeague}</p>
              </div>
              <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'end' }}>
                <RosterGrade grade={rosterGrade} />
                <strong style={{ fontSize: 22 }}>
                  {Number(rosterData.total_adjusted_value || 0).toLocaleString()}
                </strong>
              </div>
            </header>

            {POSITION_ORDER.map((position) => {
              const players = [...(groupedPlayers[position] || [])].sort(
                (a, b) => Number(b.adjusted_value || 0) - Number(a.adjusted_value || 0),
              );
              if (players.length === 0) {
                return null;
              }

              return (
                <section key={position} style={{ display: 'grid', gap: 12 }}>
                  <h3 style={{ margin: 0 }}>{position}</h3>
                  <div
                    style={{
                      display: 'grid',
                      gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    }}
                  >
                    {players.map((player) => (
                      <PlayerCard key={player.sleeper_id} player={player} />
                    ))}
                  </div>
                </section>
              );
            })}

            <details
              open
              style={{
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 8,
                padding: 18,
              }}
            >
              <summary style={{ cursor: 'pointer', fontSize: 18, fontWeight: 800 }}>
                Age Profile
              </summary>
              <div style={{ marginTop: 16 }}>
                <AgeCurveChart players={rosterData.players || []} />
              </div>
            </details>

            <footer style={{ color: '#475467', fontWeight: 700 }}>
              Total roster value: {Number(rosterData.total_adjusted_value || 0).toLocaleString()}
            </footer>
          </div>
        )}
      </section>
    </main>
  );
}
