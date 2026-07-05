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

function VerdictBadge({ trade }) {
  const classification = trade.classification || trade.verdict || 'FAIR';
  const delta = trade.value_delta || 0;
  if (classification === 'FAIR') {
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
  const winner = classification === 'WINNER' ? trade.side_a.owner_name : trade.side_b.owner_name;
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
      {winner} won by {Number(Math.abs(delta)).toLocaleString()}
    </span>
  );
}

function ClassificationBadge({ classification }) {
  const palette = {
    WINNER: { bg: '#d1fae5', color: '#065f46', label: 'WINNER' },
    LOSER: { bg: '#fee2e2', color: '#991b1b', label: 'LOSER' },
    FAIR: { bg: '#f3f4f6', color: '#374151', label: 'FAIR' },
  }[classification || 'FAIR'];

  return (
    <span
      style={{
        background: palette.bg,
        borderRadius: 4,
        color: palette.color,
        fontSize: 10,
        fontWeight: 800,
        marginLeft: 8,
        padding: '2px 6px',
      }}
    >
      {palette.label}
    </span>
  );
}

function oppositeClassification(classification) {
  if (classification === 'WINNER') return 'LOSER';
  if (classification === 'LOSER') return 'WINNER';
  return 'FAIR';
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
        <VerdictBadge trade={trade} />
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
            <ClassificationBadge classification={trade.side_a_classification || trade.classification} />
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
            <ClassificationBadge classification={trade.side_b_classification || oppositeClassification(trade.classification)} />
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

function LeaderboardColumn({ title, trades, emptyText }) {
  return (
    <div
      style={{
        background: 'var(--bg-card, #fff)',
        border: '1px solid var(--border-color, #d9dee7)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h2 style={{ color: 'var(--text-primary, #1a1a2e)', fontSize: 16, margin: '0 0 12px' }}>
        {title}
      </h2>
      {trades.length === 0 ? (
        <p style={{ color: '#667085', fontSize: 13, margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {trades.map((trade) => {
            const winner = trade.classification === 'WINNER' ? trade.side_a.owner_name : trade.side_b.owner_name;
            const loser = trade.classification === 'WINNER' ? trade.side_b.owner_name : trade.side_a.owner_name;
            return (
              <div
                key={`${title}-${trade.transaction_id}`}
                style={{
                  borderBottom: '1px solid var(--border-color, #eef0f4)',
                  paddingBottom: 10,
                }}
              >
                <p style={{ color: '#111827', fontSize: 13, fontWeight: 700, margin: '0 0 4px' }}>
                  {winner} over {loser}
                </p>
                <p style={{ color: '#667085', fontSize: 12, margin: 0 }}>
                  Delta {Number(Math.abs(trade.value_delta || 0)).toLocaleString()}
                  {trade.week ? ` · Week ${trade.week}` : ''}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TradeLeaderboard({ leaderboard }) {
  if (!leaderboard) return null;
  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginBottom: 16 }}>
      <LeaderboardColumn
        title="Biggest Steals"
        trades={leaderboard.biggest_steals || []}
        emptyText="No decisive winner trades yet."
      />
      <LeaderboardColumn
        title="Biggest Blunders"
        trades={leaderboard.biggest_blunders || []}
        emptyText="No decisive losing trades yet."
      />
    </div>
  );
}

export default function TradeHistory() {
  const [trades, setTrades] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
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
      const payload = await res.json();
      setTrades(Array.isArray(payload) ? payload : payload.trades || []);
      setLeaderboard(Array.isArray(payload) ? null : payload.leaderboard || null);
    } catch (err) {
      setError(err.message);
      setTrades(null);
      setLeaderboard(null);
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
    const teams = new Set();
    trades.forEach((trade) => {
      if (trade.side_a?.owner_name) teams.add(trade.side_a.owner_name);
      if (trade.side_b?.owner_name) teams.add(trade.side_b.owner_name);
    });
    return [...teams].sort();
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
        trade.side_a.owner_name === selectedTeam || trade.side_b.owner_name === selectedTeam
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
    if (verdict === 'FAIR') {
      return 'FAIR';
    }
    return `${verdict} by ${Number(Math.abs(delta)).toLocaleString()}`;
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
        classification: getClassification(trade.classification || trade.verdict, trade.value_delta),
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
          <>
            <TradeLeaderboard leaderboard={leaderboard} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {filteredTrades.map((trade) => (
                <TradeCard key={trade.transaction_id} trade={trade} />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
