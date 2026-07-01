import { useCallback, useState, useMemo } from 'react';
import ExportButton from '../components/ExportButton.jsx';
import LeagueSelector from '../components/LeagueSelector.jsx';

const CURRENT_YEAR = new Date().getFullYear();
const SEASONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

const POS_COLORS = {
  QB: { bg: '#e0f2fe', text: '#0369a1' },
  RB: { bg: '#d1fae5', text: '#065f46' },
  WR: { bg: '#fef3c7', text: '#92400e' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
};

function PosBadge({ pos }) {
  if (!pos) return null;
  const colors = POS_COLORS[pos] || { bg: '#f3f4f6', text: '#374151' };
  return (
    <span
      style={{
        background: colors.bg,
        borderRadius: 4,
        color: colors.text,
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 6px',
        marginRight: 4,
        whiteSpace: 'nowrap',
      }}
    >
      {pos}
    </span>
  );
}

function VerdictBadge({ verdict, delta }) {
  if (verdict === 'FAIR' || Math.abs(delta) < 100) {
    return (
      <span
        style={{
          background: '#f3f4f6',
          borderRadius: 6,
          color: '#374151',
          fontSize: 12,
          fontWeight: 600,
          padding: '4px 10px',
        }}
      >
        Even
      </span>
    );
  }
  const aWon = verdict === 'A_WON';
  return (
    <span
      style={{
        background: '#d1fae5',
        borderRadius: 6,
        color: '#065f46',
        fontSize: 12,
        fontWeight: 700,
        padding: '4px 10px',
      }}
    >
      {aWon ? 'A' : 'B'} won by {Number(Math.abs(delta)).toLocaleString()}
    </span>
  );
}

function PlayerList({ players, picks }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {players.map((p) => (
        <div key={p.sleeper_id} style={{ alignItems: 'center', display: 'flex', gap: 6, fontSize: 13 }}>
          <PosBadge pos={p.position} />
          <span style={{ fontWeight: 500 }}>{p.name}</span>
          {p.value > 0 && (
            <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 'auto' }}>
              {Number(p.value).toLocaleString()}
            </span>
          )}
        </div>
      ))}
      {picks.map((pk, i) => (
        <div key={i} style={{ alignItems: 'center', display: 'flex', gap: 6, fontSize: 13 }}>
          <span
            style={{
              background: '#f3f4f6',
              borderRadius: 4,
              color: '#374151',
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 6px',
              marginRight: 4,
            }}
          >
            PICK
          </span>
          <span style={{ color: '#667085' }}>
            {pk.year ? `${pk.year} ` : ''}{pk.round ? `Round ${pk.round}` : 'Draft Pick'}
          </span>
          {pk.value > 0 && (
            <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 'auto' }}>
              {Number(pk.value).toLocaleString()}
            </span>
          )}
        </div>
      ))}
      {players.length === 0 && picks.length === 0 && (
        <span style={{ color: '#9ca3af', fontSize: 13 }}>No assets</span>
      )}
    </div>
  );
}

function TradeCard({ trade }) {
  const dateStr = trade.created_at
    ? new Date(trade.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';

  return (
    <div
      style={{
        background: 'var(--bg-card, #fff)',
        border: '1px solid var(--border-color, #d9dee7)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          alignItems: 'center',
          background: '#f9fafb',
          borderBottom: '1px solid var(--border-color, #e4e7ec)',
          display: 'flex',
          gap: 12,
          justifyContent: 'space-between',
          padding: '10px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#667085', fontSize: 12 }}>
            {trade.season ? `${trade.season} Season` : ''}{trade.week ? ` · Week ${trade.week}` : ''}
          </span>
          <span style={{ color: '#d1d5db' }}>·</span>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>{dateStr}</span>
        </div>
        <VerdictBadge verdict={trade.verdict} delta={trade.value_delta} />
      </div>

      {/* Sides */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 0 }}>
        {/* Side A */}
        <div style={{ padding: '14px 16px' }}>
          <p
            style={{
              color: '#374151',
              fontSize: 13,
              fontWeight: 700,
              margin: '0 0 10px',
            }}
          >
            {trade.side_a.owner_name}
            <span
              style={{
                background: '#e0f2fe',
                borderRadius: 4,
                color: '#0369a1',
                fontSize: 10,
                fontWeight: 700,
                marginLeft: 8,
                padding: '2px 6px',
              }}
            >
              RECEIVED
            </span>
          </p>
          <PlayerList players={trade.side_a.players} picks={trade.side_a.picks} />
          <p style={{ color: '#6b7280', fontSize: 12, fontWeight: 600, margin: '10px 0 0' }}>
            Total: {Number(trade.side_a.total_value).toLocaleString()}
          </p>
        </div>

        {/* VS divider */}
        <div
          style={{
            alignItems: 'center',
            borderLeft: '1px solid var(--border-color, #e4e7ec)',
            borderRight: '1px solid var(--border-color, #e4e7ec)',
            color: '#9ca3af',
            display: 'flex',
            fontSize: 11,
            fontWeight: 700,
            padding: '0 12px',
          }}
        >
          VS
        </div>

        {/* Side B */}
        <div style={{ padding: '14px 16px' }}>
          <p
            style={{
              color: '#374151',
              fontSize: 13,
              fontWeight: 700,
              margin: '0 0 10px',
            }}
          >
            {trade.side_b.owner_name}
            <span
              style={{
                background: '#e0f2fe',
                borderRadius: 4,
                color: '#0369a1',
                fontSize: 10,
                fontWeight: 700,
                marginLeft: 8,
                padding: '2px 6px',
              }}
            >
              RECEIVED
            </span>
          </p>
          <PlayerList players={trade.side_b.players} picks={trade.side_b.picks} />
          <p style={{ color: '#6b7280', fontSize: 12, fontWeight: 600, margin: '10px 0 0' }}>
            Total: {Number(trade.side_b.total_value).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function TradeHistory() {
  const [trades, setTrades] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Renamed 'search' to 'playerSearch' for client-side filtering
  const [playerSearch, setPlayerSearch] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [season, setSeason] = useState(''); // This remains server-side
  const [leagueId, setLeagueId] = useState('');

  // Add sort state
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const load = useCallback(async (selectedLeagueId, seasonVal) => { // Removed searchVal parameter
    if (!selectedLeagueId) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      // Removed server-side search parameter
      if (seasonVal) params.set('season', seasonVal);
      params.set('limit', '100');
      const res = await fetch(`/fantasy/league/${selectedLeagueId}/trade-history?${params}`);
      if (!res.ok) throw new Error('Unable to load trade history');
      setTrades(await res.json());
    } catch (err) {
      setError(err.message);
      setTrades(null);
    } finally {
      setLoading(false);
    }
  }, []); // Dependencies updated

  const handleLeagueSelect = useCallback(
    (id) => {
      setLeagueId(id);
      load(id, season); // Removed search
    },
    [load, season],
  );

  // handleSearch is no longer needed as playerSearch is client-side
  // const handleSearch = (val) => {
  //   setSearch(val);
  //   load(leagueId, val, season);
  // };

  const handleSeason = (val) => {
    setSeason(val);
    load(leagueId, val);
  };

  // Handle sort click
  const handleSortClick = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc'); // Default to descending when changing field
    }
  };

  // Derive unique team names for the team filter
  const uniqueTeams = useMemo(() => {
    if (!trades) return [];
    // Assuming 'team_name' exists on each trade object as per instructions
    const teams = [...new Set(trades.map(t => t.team_name))];
    return teams.filter(Boolean).sort(); // Filter out any null/undefined team names
  }, [trades]);

  // Sort the trades array
  const sortedTrades = useMemo(() => {
    if (!trades) return null;

    const sortableTrades = [...trades]; // Create a shallow copy to avoid mutating state directly

    sortableTrades.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        // Ensure created_at exists and is a valid date string
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        comparison = dateA - dateB;
      } else if (sortField === 'valueDelta') {
        comparison = (a.value_delta || 0) - (b.value_delta || 0);
      }
      return sortDir === 'asc' ? comparison : -comparison; // Reverse if sortDir is 'desc'
    });

    return sortableTrades;
  }, [trades, sortField, sortDir]);

  // Apply client-side filters to sorted trades
  const filteredTrades = useMemo(() => {
    if (!sortedTrades) return null;

    let currentFiltered = sortedTrades;

    // Player name filter (case-insensitive substring match)
    if (playerSearch) {
      const searchLower = playerSearch.toLowerCase();
      currentFiltered = currentFiltered.filter(trade => {
        const playersA = trade.side_a.players.some(p => p.name.toLowerCase().includes(searchLower));
        const playersB = trade.side_b.players.some(p => p.name.toLowerCase().includes(searchLower));
        return playersA || playersB;
      });
    }

    // Team filter
    if (selectedTeam) {
      currentFiltered = currentFiltered.filter(trade =>
        trade.team_name === selectedTeam // Assuming trade object has team_name
      );
    }

    // Date range filter (inclusive)
    if (dateFrom || dateTo) {
      currentFiltered = currentFiltered.filter(trade => {
        const tradeDate = trade.created_at ? new Date(trade.created_at) : null;
        if (!tradeDate) return false; // Trade must have a valid date to be filtered

        const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null; // Start of the 'from' day
        const to = dateTo ? new Date(dateTo + 'T23:59:59.999') : null;   // End of the 'to' day

        let passesFrom = true;
        if (from) {
          passesFrom = tradeDate >= from;
        }

        let passesTo = true;
        if (to) {
          passesTo = tradeDate <= to;
        }

        return passesFrom && passesTo;
      });
    }

    return currentFiltered;
  }, [sortedTrades, playerSearch, selectedTeam, dateFrom, dateTo]);

  // Function to clear all client-side filters
  const handleClearFilters = useCallback(() => {
    setPlayerSearch('');
    setSelectedTeam('');
    setDateFrom('');
    setDateTo('');
  }, []);

  // Function to format players and picks for CSV
  const formatAssetsForCsv = (players, picks) => {
    const playerNames = players.map(p => `${p.name} (${p.position})`);
    const pickNames = picks.map(pk => {
      let pickStr = '';
      if (pk.year) pickStr += `${pk.year} `;
      if (pk.round) pickStr += `Round ${pk.round}`;
      else pickStr += 'Draft Pick';
      return pickStr;
    });
    return [...playerNames, ...pickNames].join('; '); // Use semicolon to separate assets within a cell
  };

  // Function to determine classification string
  const getClassification = (verdict, delta) => {
    if (verdict === 'FAIR' || Math.abs(delta) < 100) {
      return 'Even';
    }
    const aWon = verdict === 'A_WON';
    return `${aWon ? 'A' : 'B'} won by ${Number(Math.abs(delta)).toLocaleString()}`;
  };

  // Prepare data for CSV export
  const csvData = useMemo(() => {
    if (!filteredTrades) return [];

    return filteredTrades.map(trade => {
      const dateStr = trade.created_at
        ? new Date(trade.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';

      return {
        date: dateStr,
        league: leagueId, // Using leagueId as league name is not readily available
        'players/picks sent': formatAssetsForCsv(trade.side_b.players, trade.side_b.picks), // Side A received, so Side B sent
        'players/picks received': formatAssetsForCsv(trade.side_a.players, trade.side_a.picks), // Side A received
        'value delta': trade.value_delta,
        classification: getClassification(trade.verdict, trade.value_delta),
      };
    });
  }, [filteredTrades, leagueId]);

  const csvHeaders = [
    'date',
    'league',
    'players/picks sent',
    'players/picks received',
    'value delta',
    'classification',
  ];

  const anyFilterActive = playerSearch || selectedTeam || dateFrom || dateTo;

  return (
    <main style={{ background: 'var(--bg-primary, #f6f7fb)', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1000 }}>
        <div style={{ display: 'grid', gap: 18, marginBottom: 24 }}>
          <h1 style={{ margin: 0, color: 'var(--text-primary, #1a1a2e)' }}>Trade History</h1>
          <p style={{ color: 'var(--text-secondary, #667085)', margin: 0 }}>
            Browse all trades in this league with dynasty value analysis.
          </p>
          <LeagueSelector onSelect={handleLeagueSelect} />
        </div>

        {/* Filters */}
        <div
          style={{
            alignItems: 'center',
            background: 'var(--bg-card, #fff)',
            border: '1px solid var(--border-color, #d9dee7)',
            borderRadius: 8,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 10,
            padding: '12px 16px',
          }}
        >
          {/* Player name search */}
          <input
            type="text"
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Search player..."
            style={{
              background: 'var(--bg-secondary, #f9fafb)',
              border: '1px solid var(--border-color, #d1d5db)',
              borderRadius: 6,
              color: 'var(--text-primary, #111)',
              fontSize: 14,
              flex: '1 1 220px',
              padding: '8px 12px',
            }}
          />

          {/* Team filter */}
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            style={{
              background: 'var(--bg-secondary, #f9fafb)',
              border: '1px solid var(--border-color, #d1d5db)',
              borderRadius: 6,
              color: 'var(--text-primary, #111)',
              fontSize: 14,
              padding: '8px 12px',
              flex: '0 0 auto',
              minWidth: '120px',
            }}
          >
            <option value="">All Teams</option>
            {uniqueTeams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>

          {/* Date range - From */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="date-from" style={{ fontSize: 14, color: 'var(--text-secondary, #667085)', whiteSpace: 'nowrap' }}>From:</label>
            <input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                background: 'var(--bg-secondary, #f9fafb)',
                border: '1px solid var(--border-color, #d1d5db)',
                borderRadius: 6,
                color: 'var(--text-primary, #111)',
                fontSize: 14,
                padding: '8px 12px',
              }}
            />
          </div>

          {/* Date range - To */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="date-to" style={{ fontSize: 14, color: 'var(--text-secondary, #667085)', whiteSpace: 'nowrap' }}>To:</label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                background: 'var(--bg-secondary, #f9fafb)',
                border: '1px solid var(--border-color, #d1d5db)',
                borderRadius: 6,
                color: 'var(--text-primary, #111)',
                fontSize: 14,
                padding: '8px 12px',
              }}
            />
          </div>

          {/* Existing Season filter (server-side) */}
          <select
            value={season}
            onChange={(e) => handleSeason(e.target.value)}
            style={{
              background: 'var(--bg-secondary, #f9fafb)',
              border: '1px solid var(--border-color, #d1d5db)',
              borderRadius: 6,
              color: 'var(--text-primary, #111)',
              fontSize: 14,
              padding: '8px 12px',
              flex: '0 0 auto',
              minWidth: '120px',
            }}
          >
            <option value="">All Seasons</option>
            {SEASONS.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>
        </div>

        {/* Clear filters button and row count */}
        {trades && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            {anyFilterActive && (
              <button
                onClick={handleClearFilters}
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: 6,
                  color: '#dc2626',
                  fontSize: 14,
                  fontWeight: 600,
                  padding: '8px 12px',
                  cursor: 'pointer',
                }}
              >
                Clear filters
              </button>
            )}
            <span style={{ color: '#9ca3af', fontSize: 13, marginLeft: anyFilterActive ? 'auto' : '0' }}>
              Showing {filteredTrades ? filteredTrades.length : 0} of {trades.length} trades
            </span>            {/* Add ExportButton here */}
            {filteredTrades && filteredTrades.length > 0 && (
              <ExportButton
                data={csvData}
                headers={csvHeaders}
                filename={`trade_history_${leagueId}_${season || 'all'}.csv`}
              />
            )}
          </div>
        )}

        {loading && <p style={{ color: 'var(--text-secondary, #667085)' }}>Loading trades...</p>}
        {error && (
          <div
            style={{
              background: '#fef3f2',
              border: '1px solid #fda29b',
              borderRadius: 8,
              color: '#b42318',
              padding: 16,
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Sort controls for Trade List */}
        {filteredTrades && filteredTrades.length > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
              padding: '8px 16px',
              background: 'var(--bg-card, #fff)',
              border: '1px solid var(--border-color, #d9dee7)',
              borderRadius: 8,
            }}
          >
            <div>
              <button
                style={{ background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary, #1a1a2e)' }}
                onClick={() => handleSortClick('date')}
              >
                Date {sortField === 'date' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </div>
            <div>
              <button
                style={{ background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary, #1a1a2e)' }}
                onClick={() => handleSortClick('valueDelta')}
              >
                Value Delta {sortField === 'valueDelta' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </div>
          </div>
        )}

        {filteredTrades && !loading && filteredTrades.length === 0 && (
          <p style={{ color: '#667085', textAlign: 'center', marginTop: 40 }}>
            No trades found with current filters.
          </p>
        )}

        {filteredTrades && !loading && filteredTrades.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filteredTrades.map((trade) => (
              <TradeCard key={trade.transaction_id} trade={trade} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
