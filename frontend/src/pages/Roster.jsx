import { useCallback, useMemo, useState, useEffect } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
// import PlayerCard from '../components/PlayerCard.jsx'; // Removed as players are now displayed in a table
import ExportButton from '../components/ExportButton.jsx';
import ValueTrendChart from '../components/ValueTrendChart.jsx';
import ConfidenceBadge from '../components/ConfidenceBadge.jsx';

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

// Helper for localStorage
const localStorageKeys = {
  globalThreshold: 'globalValueAlertThreshold',
  playerThresholds: 'playerValueAlertThresholds',
};

// Function to safely parse JSON from localStorage
const getLocalStorageItem = (key, defaultValue) => {
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`Error parsing localStorage item "${key}":`, error);
    return defaultValue;
  }
};

// Function to safely set JSON to localStorage
const setLocalStorageItem = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error setting localStorage item "${key}":`, error);
  }
};


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

  // New state for alert thresholds
  const [globalThreshold, setGlobalThreshold] = useState(() => getLocalStorageItem(localStorageKeys.globalThreshold, 5)); // Default 5%
  const [playerThresholds, setPlayerThresholds] = useState(() => getLocalStorageItem(localStorageKeys.playerThresholds, {}));
  const [triggeredAlerts, setTriggeredAlerts] = useState([]);

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  }, []);

  // Load/Save thresholds from/to localStorage
  useEffect(() => {
    setLocalStorageItem(localStorageKeys.globalThreshold, globalThreshold);
  }, [globalThreshold]);

  useEffect(() => {
    setLocalStorageItem(localStorageKeys.playerThresholds, playerThresholds);
  }, [playerThresholds]);

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
    setTriggeredAlerts([]); // Clear alerts on new roster load

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

  // Calculate alerts
  useEffect(() => {
    if (!sortedPlayers.length || valueHistory.length < 1) { // Need at least one historical snapshot to compare against current
      setTriggeredAlerts([]);
      return;
    }

    const alerts = [];
    // Get the most recent historical snapshot for comparison
    const latestHistoricalPlayers = valueHistory[valueHistory.length - 1].players;
    const latestHistoricalValuesMap = new Map(latestHistoricalPlayers.map(p => [p.sleeper_id, p.value]));

    sortedPlayers.forEach(player => {
      const current_value = Number(player.adjusted_value || 0);
      const previous_value = latestHistoricalValuesMap.get(player.sleeper_id);

      // Only calculate if both current and previous values are valid and non-zero
      if (previous_value === undefined || previous_value === 0 || current_value === 0) {
        return;
      }

      const percentage_change = ((current_value - previous_value) / previous_value) * 100;
      const effectiveThreshold = Number(playerThresholds[player.sleeper_id] !== undefined
        ? playerThresholds[player.sleeper_id]
        : globalThreshold);

      if (Math.abs(percentage_change) >= effectiveThreshold) {
        alerts.push({
          player,
          current_value,
          previous_value,
          percentage_change,
          threshold: effectiveThreshold,
        });
      }
    });
    setTriggeredAlerts(alerts);
  }, [sortedPlayers, valueHistory, globalThreshold, playerThresholds]);

  const handleGlobalThresholdChange = useCallback((e) => {
    const value = Number(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setGlobalThreshold(value);
    }
  }, []);

  const handlePlayerThresholdChange = useCallback((playerId, e) => {
    const value = Number(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setPlayerThresholds(prev => ({
        ...prev,
        [playerId]: value,
      }));
    }
  }, []);

  const clearPlayerThreshold = useCallback((playerId) => {
    setPlayerThresholds(prev => {
      const newThresholds = { ...prev };
      delete newThresholds[playerId];
      return newThresholds;
    });
  }, []);

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
          {/* Global Alert Threshold Control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <label htmlFor="global-threshold" style={{ fontSize: 14, fontWeight: 500, color: '#344054' }}>
              Global Value Alert Threshold (%):
            </label>
            <input
              id="global-threshold"
              type="number"
              min="0"
              step="1"
              value={globalThreshold}
              onChange={handleGlobalThresholdChange}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #d0d5dd',
                width: 70,
                fontSize: 14,
              }}
            />
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
                {rosterData.data_confidence && (
                  <div style={{ marginTop: 10 }}>
                    <ConfidenceBadge confidence={rosterData.data_confidence} />
                  </div>
                )}
              </div>
              <strong style={{ fontSize: 22 }}>
                {Number(rosterData.total_adjusted_value || 0).toLocaleString()}
              </strong>
            </header>

            {/* Alerts Panel */}
            {triggeredAlerts.length > 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fdb022', borderRadius: 8, padding: 16 }}>
                <h3 style={{ margin: '0 0 10px 0', color: '#b54708', fontSize: 16 }}>
                  🚨 Value Change Alerts ({triggeredAlerts.length})
                </h3>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {triggeredAlerts.map(alert => (
                    <li key={alert.player.sleeper_id} style={{ marginBottom: 6, fontSize: 14, color: '#b54708' }}>
                      <a href={`#player-${alert.player.sleeper_id}`} style={{ color: '#b54708', textDecoration: 'underline' }}>
                        {alert.player.full_name}
                      </a>:{' '}
                      Value changed by{' '}
                      <strong style={{ color: alert.percentage_change >= 0 ? '#027a48' : '#b42318' }}>
                        {alert.percentage_change > 0 ? '+' : ''}{alert.percentage_change.toFixed(1)}%
                      </strong>{' '}
                      (Threshold: {alert.threshold}%)
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          borderBottom: '1px solid #eaecf0',
                          fontWeight: 600,
                          color: '#475467',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Trust
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
                      {/* New column for Alert Threshold */}
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          borderBottom: '1px solid #eaecf0',
                          fontWeight: 600,
                          color: '#475467',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Alert Threshold (%)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((player) => {
                      const effectiveThreshold = playerThresholds[player.sleeper_id] !== undefined
                        ? playerThresholds[player.sleeper_id]
                        : globalThreshold;
                      const isAlerted = triggeredAlerts.some(alert => alert.player.sleeper_id === player.sleeper_id);

                      return (
                        <tr
                          key={player.sleeper_id}
                          id={`player-${player.sleeper_id}`} // Anchor for alerts panel
                          style={{ background: isAlerted ? '#fffbeb' : 'inherit' }}
                        >
                          <td style={{ padding: '12px 16px', borderBottom: '1px solid #eaecf0', color: '#101828', fontSize: 14 }}>
                            {player.full_name}
                          </td>
                          <td style={{ padding: '12px 16px', borderBottom: '1px solid #eaecf0', color: '#475467', fontSize: 14 }}>
                            {player.position}
                          </td>
                          <td style={{ padding: '12px 16px', borderBottom: '1px solid #eaecf0', color: '#475467', fontSize: 14 }}>
                            {player.age}
                          </td>
                          <td style={{ padding: '12px 16px', borderBottom: '1px solid #eaecf0', color: '#475467', fontSize: 14 }}>
                            <ConfidenceBadge confidence={player.data_confidence} />
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', borderBottom: '1px solid #eaecf0', color: '#101828', fontSize: 14, fontWeight: 500 }}>
                            {Number(player.adjusted_value || 0).toLocaleString()}
                          </td>
                          {/* Alert Threshold Input */}
                          <td style={{ padding: '8px 16px', borderBottom: '1px solid #eaecf0', color: '#475467', fontSize: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={effectiveThreshold}
                                onChange={(e) => handlePlayerThresholdChange(player.sleeper_id, e)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  border: '1px solid #d0d5dd',
                                  width: 60,
                                  fontSize: 13,
                                }}
                              />
                              {playerThresholds[player.sleeper_id] !== undefined && (
                                <button
                                  onClick={() => clearPlayerThreshold(player.sleeper_id)}
                                  title="Clear custom threshold and use global default"
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#98a2b3',
                                    fontSize: 16,
                                    padding: 0,
                                    lineHeight: 1,
                                  }}
                                >
                                  &times;
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
