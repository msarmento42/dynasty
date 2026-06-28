import { useCallback, useMemo, useState, useEffect } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
import PlayerCard from '../components/PlayerCard.jsx';
import ExportButton from '../components/ExportButton.jsx'; // New import

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export default function Roster() {
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [rosterData, setRosterData] = useState(null);
  const [leagueSettings, setLeagueSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCopiedToast, setShowCopiedToast] = useState(false); // New state for toast

  // Effect to read leagueId from URL on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const leagueIdFromUrl = params.get('league');
    if (leagueIdFromUrl && !selectedLeague) {
      loadRoster(leagueIdFromUrl);
    }
  }, [loadRoster, selectedLeague]);

  const loadRoster = useCallback(async (leagueId) => {
    setSelectedLeague(leagueId);
    setLoading(true);
    setError('');
    setLeagueSettings(null);

    // Update URL query parameter
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('league', leagueId);
    window.history.pushState({ path: newUrl.href }, '', newUrl.href);

    try {
      const [rosterRes, settingsRes] = await Promise.allSettled([
        fetch(`/fantasy/league/${leagueId}/roster`),
        fetch(`/fantasy/league/${leagueId}/settings`),
      ]);

      if (rosterRes.status === 'fulfilled' && rosterRes.value.ok) {
        setRosterData(await rosterRes.value.json());
      } else {
        throw new Error('Unable to load roster');
      }

      if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
        setLeagueSettings(await settingsRes.value.json());
      }
    } catch (err) {
      setRosterData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShowCopiedToast(true);
      setTimeout(() => setShowCopiedToast(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
      // Optionally show an error toast to the user
    }
  };

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
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}> {/* Wrapper for selector and buttons */}
            <LeagueSelector onSelect={loadRoster} initialLeagueId={selectedLeague} /> {/* Pass selectedLeague as initial value */}
            {rosterData && (
              <>
                <button
                  onClick={handleShare}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: '1px solid #d0d5dd',
                    background: '#ffffff',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#344054',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Share
                </button>
                {rosterData.players && rosterData.players.length > 0 && (
                  <ExportButton players={rosterData.players} />
                )}
              </>
            )}
            {showCopiedToast && (
              <span style={{ color: '#027a48', fontSize: 14, fontWeight: 500, marginLeft: 8 }}>Copied!</span>
            )}
          </div>
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
                justifyContent: 'space-between',
                padding: 18,
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>{rosterData.league_name}</h2>
                <p style={{ color: '#667085', margin: '4px 0 0' }}>Selected league: {selectedLeague}</p>
                {leagueSettings && (
                  <p style={{ color: '#6b7280', fontSize: 13, margin: '6px 0 0' }}>
                    Values shown for{' '}
                    <strong>{leagueSettings.format_label}</strong> format
                    {leagueSettings.is_te_premium && ' · TE Premium'}
                    {' · '}{leagueSettings.rec_format}
                  </p>
                )}
              </div>
              <strong style={{ fontSize: 22 }}>
                {Number(rosterData.total_adjusted_value || 0).toLocaleString()}
              </strong>
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

            <footer style={{ color: '#475467', fontWeight: 700 }}>
              Total roster value: {Number(rosterData.total_adjusted_value || 0).toLocaleString()}
            </footer>
          </div>
        )}
      </section>
    </main>
  );
}
