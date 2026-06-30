import { useCallback, useMemo, useState, useEffect } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
// import PlayerCard from '../components/PlayerCard.jsx'; // Removed as players are now displayed in a table
import ExportButton from '../components/ExportButton.jsx';
import ValueTrendChart from '../components/ValueTrendChart.jsx';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function formatCacheAge(cacheAgeSeconds) {
  if (cacheAgeSeconds === null || cacheAgeSeconds === undefined) {
    return 'Unknown';
  }

  if (cacheAgeSeconds < 60) {
    return '< 1 min ago';
  }

  const minutes = Math.floor(cacheAgeSeconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  return `${Math.floor(minutes / 60)}h ago`;
}

export default function Roster() {
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [rosterData, setRosterData] = useState(null);
  const [valueHistory, setValueHistory] = useState([]);
  const [leagueSettings, setLeagueSettings] = useState(null);
  const [cacheStatus, setCacheStatus] = useState({ cached_at: null, cache_age_seconds: null });
  const [loading, setLoading] = useState(false);
  const [refreshingValues, setRefreshingValues] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [sortColumn, setSortColumn] = useState('adjusted_value'); // Default sort by value
  const [sortDirection, setSortDirection] = useState('desc'); // Default descending

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  }, []);

  const loadCacheStatus = useCallback(async () => {
    const response = await fetch('/fantasy/cache-status', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Unable to load cache status');
    }
    setCacheStatus(await response.json());
  }, []);

  const loadRoster = useCallback(async (leagueId, options = {}) => {
    setSelectedLeague(leagueId);
    setLoading(!options.silent);
    setError('');
    setLeagueSettings(null);
    setValueHistory([]);

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('league', leagueId);
    window.history.pushState({ path: newUrl.href }, '', newUrl.href);

    try {
      const [rosterRes, settingsRes, cacheRes, historyRes] = await Promise.allSettled([
        fetch(`/fantasy/league/${leagueId}/roster`, { cache: 'no-store' }),
        fetch(`/fantasy/league/${leagueId}/settings`),
        fetch('/fantasy/cache-status', { cache: 'no-store' }),
        fetch(`/fantasy/league/${leagueId}/roster-value-history`, { cache: 'no-store' }),
      ]);

      if (rosterRes.status === 'fulfilled' && rosterRes.value.ok) {
        setRosterData(await rosterRes.value.json());
      } else {
        throw new Error('Unable to load roster');
      }

      if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
        setLeagueSettings(await settingsRes.value.json());
      }

      if (cacheRes.status === 'fulfilled' && cacheRes.value.ok) {
        setCacheStatus(await cacheRes.value.json());
      }

      if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
        const payload = await historyRes.value.json();
        setValueHistory(payload.history || []);
      }
    } catch (err) {
      setRosterData(null);
      setValueHistory([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCacheStatus().catch(() => {});
  }, [loadCacheStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const leagueIdFromUrl = params.get('league');
    if (leagueIdFromUrl && !selectedLeague) {
      loadRoster(leagueIdFromUrl);
    }
  }, [loadRoster, selectedLeague]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Copied!');
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const handleRefreshValues = async () => {
    setRefreshingValues(true);
    setError('');

    try {
      const response = await fetch('/fantasy/refresh-cache', {
        method: 'POST',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 429) {
        showToast(`Refresh on cooldown, try again in ${payload.retry_after_seconds || 60}s`);
        return;
      }

      if (!response.ok) {
        throw new Error('Unable to refresh player values');
      }

      if (selectedLeague) {
        await loadRoster(selectedLeague, { silent: true });
      } else {
        await loadCacheStatus();
      }
      showToast('Values refreshed');
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshingValues(false);
    }
  };

  const handleSort = useCallback((column) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc'); // Default to ascending when changing column
    }
  }, [sortColumn]);

  const sortedPlayers = useMemo(() => {
    if (!rosterData?.players) return [];

    const players = [...rosterData.players]; // Create a shallow copy to avoid mutating original state

    players.sort((a, b) => {
      let valA, valB;

      switch (sortColumn) {
        case 'full_name':
          valA = a.full_name || '';
          valB = b.full_name || '';
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'position':
          const posA = POSITION_ORDER.indexOf(a.position);
          const posB = POSITION_ORDER.indexOf(b.position);
          if (posA !== posB) {
            return sortDirection === 'asc' ? posA - posB : posB - posA;
          }
          // If positions are the same, sort by name
          valA = a.full_name || '';
          valB = b.full_name || '';
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'age':
          valA = Number(a.age || 0);
          valB = Number(b.age || 0);
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        case 'adjusted_value':
        default:
          valA = Number(a.adjusted_value || 0);
          valB = Number(b.adjusted_value || 0);
          return sortDirection === 'asc' ? valA - valB : valB - valA;
      }
    });
    return players;
  }, [rosterData, sortColumn, sortDirection]);

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1120 }}>
        <div style={{ display: 'grid', gap: 18, marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0 }}>Roster</h1>
            <p style={{ color: '#667085', fontSize: 13, margin: '6px 0 0' }}>
              Last updated: {formatCacheAge(cacheStatus.cache_age_seconds)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <LeagueSelector onSelect={loadRoster} initialLeagueId={selectedLeague} />
            <button
              onClick={handleRefreshValues}
              disabled={refreshingValues}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #d0d5dd',
                background: refreshingValues ? '#eef2f7' : '#ffffff',
                cursor: refreshingValues ? 'wait' : 'pointer',
                fontSize: 14,
                fontWeight: 500,
                color: '#344054',
                whiteSpace: 'nowrap',
              }}
            >
              {refreshingValues ? 'Refreshing...' : '⟳ Refresh Values'}
            </button>
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
            {toast && (
              <span style={{ color: '#027a48', fontSize: 14, fontWeight: 500, marginLeft: 8 }}>
                {toast}
              </span>
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

            <ValueTrendChart history={valueHistory} />

            {rosterData.players && rosterData.players.length > 0 && (
              <div style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th
                        onClick={() => handleSort('full_name')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          borderBottom: '1px solid #eaecf0',
                          cursor: 'pointer',
                          fontWeight: 600,
                          color: '#475467',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Player Name{' '}
                        {sortColumn === 'full_name' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('position')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          borderBottom: '1px solid #eaecf0',
                          cursor: 'pointer',
                          fontWeight: 600,
                          color: '#475467',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Position{' '}
                        {sortColumn === 'position' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('age')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          borderBottom: '1px solid #eaecf0',
                          cursor: 'pointer',
                          fontWeight: 600,
                          color: '#475467',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Age{' '}
                        {sortColumn === 'age' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('adjusted_value')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          borderBottom: '1px solid #eaecf0',
                          cursor: 'pointer',
                          fontWeight: 600,
                          color: '#475467',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Value{' '}
                        {sortColumn === 'adjusted_value' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((player) => (
                      <tr key={player.sleeper_id}>
                        <td style={{ padding: '12px 16px', borderBottom: '1px solid #eaecf0', color: '#101828', fontSize: 14 }}>
                          {player.full_name}
                        </td>
                        <td style={{ padding: '12px 16px', borderBottom: '1px solid #eaecf0', color: '#475467', fontSize: 14 }}>
                          {player.position}
                        </td>
                        <td style={{ padding: '12px 16px', borderBottom: '1px solid #eaecf0', color: '#475467', fontSize: 14 }}>
                          {player.age}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', borderBottom: '1px solid #eaecf0', color: '#101828', fontSize: 14, fontWeight: 500 }}>
                          {Number(player.adjusted_value || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <footer style={{ color: '#475467', fontWeight: 700 }}>
              Total roster value: {Number(rosterData.total_adjusted_value || 0).toLocaleString()}
            </footer>
          </div>
        )}
      </section>
    </main>
  );
}
