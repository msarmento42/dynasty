import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import Roster from './pages/Roster.jsx';
import TradeBuilder from './pages/TradeBuilder.jsx';
import Proposals from './pages/Proposals.jsx';
import Playoffs from './pages/Playoffs.jsx';
import PlayerProfile from './pages/PlayerProfile.jsx';
import PickCalculator from './pages/PickCalculator.jsx';
import TeamNeeds from './pages/TeamNeeds.jsx';
import Exposure from './pages/Exposure.jsx';
import News from './pages/News.jsx';
import Movers from './pages/Movers.jsx';
import StartSit from './pages/StartSit.jsx';
import WaiverWire from './pages/WaiverWire.jsx';
import PowerRankings from './pages/PowerRankings.jsx';
import TradeHistory from './pages/TradeHistory.jsx';
import BaseballHome from './pages/baseball/BaseballHome.jsx';
import Prospects from './pages/baseball/Prospects.jsx';
import PlayerPage from './pages/baseball/PlayerPage.jsx';
import BaseballRoster from './pages/baseball/Roster.jsx';
import BaseballDraft from './pages/baseball/BaseballDraft.jsx';import BaseballPlayerComparison from './pages/baseball/BaseballPlayerComparison.jsx';
import ValueHistory from './pages/ValueHistory.jsx';
import Rookies from './pages/Rookies.jsx';
import MockDraft from './pages/MockDraft.jsx';
import DataDoctor from './pages/DataDoctor.jsx';
import Dashboard from './pages/Dashboard.jsx';
import SimulationLab from './pages/SimulationLab.jsx';

const POS_COLORS = {
  QB: { bg: '#e0f2fe', text: '#0369a1' },
  RB: { bg: '#d1fae5', text: '#065f46' },
  WR: { bg: '#fef3c7', text: '#92400e' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
};

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const allResults = results
    ? [
        ...results.football.map((r) => ({ ...r, _sport: 'football' })),
        ...results.baseball.map((r) => ({ ...r, _sport: 'baseball' })),
      ]
    : [];

  const search = useCallback((q) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.length < 2) {
      setResults(null);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/fantasy/players/search?q=${encodeURIComponent(q)}&sport=all`);
        if (!res.ok) throw new Error('search failed');
        const data = await res.json();
        setResults(data);
        setOpen(true);
        setActiveIndex(-1);
      } catch (_) {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    search(val);
  };

  const handleKeyDown = (e) => {
    if (!open || allResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectResult(allResults[activeIndex]);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const selectResult = (player) => {
    if (player._sport === 'football') {
      navigate(`/players/${player.id}`);
    } else {
      navigate(`/baseball/players/${player.id}`);
    }
    close();
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    setResults(null);
    setActiveIndex(-1);
  };

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  const hasResults =
    results && (results.football.length > 0 || results.baseball.length > 0);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', marginLeft: 'auto', flexShrink: 0 }}
    >
      <div
        style={{
          alignItems: 'center',
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: 7,
          display: 'flex',
          gap: 6,
          padding: '5px 10px',
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results && hasResults) setOpen(true); }}
          placeholder="Search players... (⌘K)"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: 13,
            outline: 'none',
            width: 160,
          }}
        />
        {loading && (
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>...</span>
        )}
        {query && (
          <button
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e4e7ec',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
            maxHeight: 440,
            overflowY: 'auto',
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 360,
            zIndex: 1000,
          }}
        >
          {!hasResults && !loading && (
            <p style={{ color: '#9ca3af', fontSize: 13, padding: '14px 16px', margin: 0 }}>
              No results for &ldquo;{query}&rdquo;
            </p>
          )}

          {results && results.football.length > 0 && (
            <div>
              <div
                style={{
                  background: '#f9fafb',
                  borderBottom: '1px solid #f3f4f6',
                  color: '#667085',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  padding: '8px 14px 6px',
                  textTransform: 'uppercase',
                }}
              >
                Football
              </div>
              {results.football.map((player, idx) => {
                const globalIdx = idx;
                const isActive = activeIndex === globalIdx;
                const posColors =
                  POS_COLORS[player.position] || { bg: '#f3f4f6', text: '#374151' };
                return (
                  <div
                    key={player.id}
                    onClick={() => selectResult({ ...player, _sport: 'football' })}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                    style={{
                      alignItems: 'center',
                      background: isActive ? '#eff6ff' : '#fff',
                      borderBottom: '1px solid #f9fafb',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 10,
                      padding: '9px 14px',
                    }}
                  >
                    <span
                      style={{
                        background: posColors.bg,
                        borderRadius: 4,
                        color: posColors.text,
                        fontSize: 10,
                        fontWeight: 700,
                        minWidth: 28,
                        padding: '2px 6px',
                        textAlign: 'center',
                      }}
                    >
                      {player.position || '—'}
                    </span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{player.name}</span>
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>{player.team}</span>
                    {player.value > 0 && (
                      <span style={{ color: '#667085', fontSize: 12, marginLeft: 4 }}>
                        {Number(player.value).toLocaleString()}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {results && results.baseball.length > 0 && (
            <div>
              <div
                style={{
                  background: '#f9fafb',
                  borderBottom: '1px solid #f3f4f6',
                  borderTop: results.football.length > 0 ? '1px solid #e4e7ec' : undefined,
                  color: '#667085',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  padding: '8px 14px 6px',
                  textTransform: 'uppercase',
                }}
              >
                Baseball
              </div>
              {results.baseball.map((player, idx) => {
                const globalIdx = (results.football.length) + idx;
                const isActive = activeIndex === globalIdx;
                return (
                  <div
                    key={player.id}
                    onClick={() => selectResult({ ...player, _sport: 'baseball' })}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                    style={{
                      alignItems: 'center',
                      background: isActive ? '#eff6ff' : '#fff',
                      borderBottom: '1px solid #f9fafb',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 10,
                      padding: '9px 14px',
                    }}
                  >
                    {player.level && (
                      <span
                        style={{
                          background: '#1a365d',
                          borderRadius: 999,
                          color: '#bee3f8',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {player.level}
                      </span>
                    )}
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{player.name}</span>
                    <span
                      style={{
                        background: '#eff6ff',
                        borderRadius: 4,
                        color: '#1d4ed8',
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                      }}
                    >
                      {player.position || '—'}
                    </span>
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>{player.team}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ACTIVITY_TYPE_STYLES = {
  trade: { bg: '#ede9fe', text: '#5b21b6', label: 'Trade' },
  waiver: { bg: '#d1fae5', text: '#065f46', label: 'Waiver' },
  roster_move: { bg: '#e0f2fe', text: '#0369a1', label: 'Roster Move' },
};

function formatActivityTime(value) {
  if (!value) return 'Unknown time';
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function ActivityBadge({ type }) {
  const style = ACTIVITY_TYPE_STYLES[type] || ACTIVITY_TYPE_STYLES.roster_move;
  return (
    <span
      style={{
        background: style.bg,
        borderRadius: 4,
        color: style.text,
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 7px',
        textTransform: 'uppercase',
      }}
    >
      {style.label}
    </span>
  );
}

function ActivityCard({ item }) {
  const teams = item.teams_involved?.map((team) => team.name).join(' / ') || 'League activity';
  const players = item.players_involved || [];

  return (
    <article
      style={{
        background: '#fff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <ActivityBadge type={item.activity_type} />
        <strong style={{ color: '#344054', fontSize: 14 }}>{item.league_name}</strong>
      </div>
      <h2 style={{ fontSize: 17, margin: '0 0 4px' }}>{teams}</h2>
      <p style={{ color: '#667085', fontSize: 13, margin: 0 }}>
        {formatActivityTime(item.timestamp)}
        {item.week ? ` · Week ${item.week}` : ''}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {players.length === 0 && <span style={{ color: '#98a2b3' }}>No players listed</span>}
        {players.map((player) => (
          <span
            key={`${player.action}-${player.player_id}-${player.roster_id}`}
            style={{
              background: player.action === 'add' ? '#ecfdf3' : '#fef3f2',
              border: `1px solid ${player.action === 'add' ? '#abefc6' : '#fecdca'}`,
              borderRadius: 6,
              color: player.action === 'add' ? '#067647' : '#b42318',
              fontSize: 12,
              fontWeight: 650,
              padding: '4px 8px',
            }}
          >
            {player.action === 'add' ? '+' : '-'} {player.name}
          </span>
        ))}
      </div>

      {item.draft_picks?.length > 0 && (
        <p style={{ color: '#667085', fontSize: 13, margin: '12px 0 0' }}>
          Draft picks involved: {item.draft_picks.length}
        </p>
      )}
    </article>
  );
}

function Activity() {
  const [items, setItems] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadActivity = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ weeks: '4' });
      if (selectedLeague) params.set('league_id', selectedLeague);
      if (selectedType) params.set('activity_type', selectedType);
      const res = await fetch(`/fantasy/activity?${params.toString()}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
      setWarnings(data.warnings || []);
      if (!selectedLeague || leagues.length === 0) {
        setLeagues(data.leagues || []);
      }
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [leagues.length, selectedLeague, selectedType]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  const counts = items.reduce(
    (acc, item) => {
      acc[item.activity_type] = (acc[item.activity_type] || 0) + 1;
      return acc;
    },
    { trade: 0, waiver: 0, roster_move: 0 },
  );

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 980 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 4px' }}>League Activity</h1>
          <p style={{ color: '#667085', margin: 0 }}>
            Trades, waiver claims, and roster moves across Marcus&apos;s Sleeper leagues.
          </p>
        </div>

        <div
          style={{
            alignItems: 'end',
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            marginBottom: 18,
          }}
        >
          <label style={{ display: 'grid', fontWeight: 700, gap: 6 }}>
            League
            <select
              value={selectedLeague}
              onChange={(event) => setSelectedLeague(event.target.value)}
              style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: '9px 10px' }}
            >
              <option value="">All leagues</option>
              {leagues.map((league) => (
                <option key={league.league_id} value={league.league_id}>
                  {league.name}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', fontWeight: 700, gap: 6 }}>
            Type
            <select
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
              style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: '9px 10px' }}
            >
              <option value="">All activity</option>
              <option value="trade">Trades</option>
              <option value="waiver">Waiver claims</option>
              <option value="roster_move">Roster moves</option>
            </select>
          </label>

          <div
            style={{
              background: '#fff',
              border: '1px solid #d9dee7',
              borderRadius: 8,
              display: 'flex',
              gap: 12,
              justifyContent: 'space-between',
              padding: '10px 12px',
            }}
          >
            <span style={{ color: '#667085', fontSize: 13 }}>Trades {counts.trade}</span>
            <span style={{ color: '#667085', fontSize: 13 }}>Waivers {counts.waiver}</span>
            <span style={{ color: '#667085', fontSize: 13 }}>Moves {counts.roster_move}</span>
          </div>
        </div>

        {warnings.length > 0 && (
          <div
            style={{
              background: '#fffaeb',
              border: '1px solid #fedf89',
              borderRadius: 8,
              color: '#93370d',
              marginBottom: 16,
              padding: 14,
            }}
          >
            Some leagues could not be refreshed from Sleeper.
          </div>
        )}

        {loading && <p style={{ color: '#667085' }}>Loading activity...</p>}

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

        {!loading && !error && items.length === 0 && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #d9dee7',
              borderRadius: 10,
              padding: 32,
              textAlign: 'center',
            }}
          >
            <p style={{ color: '#667085', fontSize: 15, margin: 0 }}>
              No recent league activity found.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((item) => (
              <ActivityCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function DigestPlayerRow({ player, valueKey = 'value_sf' }) {
  const value = Number(player[valueKey] ?? player.value ?? player.adjusted_value ?? 0);
  return (
    <li
      style={{
        alignItems: 'center',
        borderBottom: '1px solid #eef2f6',
        display: 'grid',
        gap: 8,
        gridTemplateColumns: '1fr auto',
        padding: '9px 0',
      }}
    >
      <span>
        <strong>{player.name || player.player_name || 'Unknown player'}</strong>
        <span style={{ color: '#667085', fontSize: 13 }}>
          {' '}· {player.position || '—'} {player.team ? `· ${player.team}` : ''}
        </span>
      </span>
      <span style={{ color: '#344054', fontSize: 13, fontWeight: 700 }}>
        {value ? value.toLocaleString() : '—'}
      </span>
    </li>
  );
}

function DigestSection({ title, children, empty }) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        padding: 18,
      }}
    >
      <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>{title}</h2>
      {children || <p style={{ color: '#667085', margin: 0 }}>{empty}</p>}
    </section>
  );
}

function DigestLeague({ league }) {
  const trades = league.trade_opportunities || [];
  const waivers = league.waiver_targets || [];
  const byes = league.upcoming_byes || [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ fontSize: 22, margin: '10px 0 0' }}>{league.name}</h2>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <DigestSection title="Trade Opportunities" empty="No trade opportunities surfaced yet.">
          {trades.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {trades.slice(0, 4).map((trade, index) => (
                <li
                  key={`${league.league_id}-trade-${trade.id || index}`}
                  style={{ borderBottom: '1px solid #eef2f6', padding: '9px 0' }}
                >
                  <strong>{trade.summary || trade.rationale || 'Trade idea'}</strong>
                  <p style={{ color: '#667085', fontSize: 13, margin: '4px 0 0' }}>
                    {trade.partner_name || trade.other_manager || 'Potential partner'}
                    {trade.delta ? ` · Delta ${Number(trade.delta).toLocaleString()}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DigestSection>

        <DigestSection title="Waiver Targets" empty="No waiver targets found for this league.">
          {waivers.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {waivers.slice(0, 6).map((player) => (
                <DigestPlayerRow key={`${league.league_id}-waiver-${player.sleeper_id}`} player={player} />
              ))}
            </ul>
          )}
        </DigestSection>

        <DigestSection title="Upcoming Bye Weeks" empty="No roster bye weeks in the next four weeks.">
          {byes.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {byes.map((player) => (
                <li
                  key={`${league.league_id}-bye-${player.sleeper_id}-${player.week}`}
                  style={{ borderBottom: '1px solid #eef2f6', padding: '9px 0' }}
                >
                  <strong>Week {player.week}</strong>
                  <span style={{ color: '#667085', fontSize: 13 }}>
                    {' '}· {player.name} · {player.position || '—'} {player.team ? `· ${player.team}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DigestSection>
      </div>
    </div>
  );
}

function Digest() {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDigest() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/fantasy/digest');
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        setDigest(await res.json());
      } catch (err) {
        setError(err.message);
        setDigest(null);
      } finally {
        setLoading(false);
      }
    }
    loadDigest();
  }, []);

  const gainers = digest?.movers?.gainers || [];
  const losers = digest?.movers?.losers || [];
  const leagues = digest?.leagues || [];

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1120 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 4px' }}>Weekly Digest</h1>
          <p style={{ color: '#667085', margin: 0 }}>
            Biggest movers, bye-week pressure, trade ideas, and waiver targets in one view.
          </p>
        </div>

        {loading && <p style={{ color: '#667085' }}>Loading digest...</p>}

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

        {!loading && !error && digest && (
          <div style={{ display: 'grid', gap: 18 }}>
            {digest.warnings?.length > 0 && (
              <div
                style={{
                  background: '#fffaeb',
                  border: '1px solid #fedf89',
                  borderRadius: 8,
                  color: '#93370d',
                  padding: 14,
                }}
              >
                Some digest sections could not be refreshed.
              </div>
            )}

            <DigestSection title="Biggest Value Movers" empty="Not enough snapshot history for value movers yet.">
              {(gainers.length > 0 || losers.length > 0) && (
                <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                  <div>
                    <h3 style={{ color: '#067647', fontSize: 15, margin: '0 0 6px' }}>Risers</h3>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {gainers.slice(0, 5).map((player) => (
                        <DigestPlayerRow key={`gainer-${player.sleeper_id}`} player={player} valueKey="delta" />
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 style={{ color: '#b42318', fontSize: 15, margin: '0 0 6px' }}>Fallers</h3>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {losers.slice(0, 5).map((player) => (
                        <DigestPlayerRow key={`loser-${player.sleeper_id}`} player={player} valueKey="delta" />
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </DigestSection>

            {leagues.length === 0 && (
              <DigestSection title="League Digest" empty="No synced leagues found. Run daily sync first." />
            )}
            {leagues.map((league) => (
              <DigestLeague key={league.league_id} league={league} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  const [valueMode, setValueMode] = useState('dynasty');

  useEffect(() => {
    fetch('/api/dynasty/preferences')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.value_mode) setValueMode(data.value_mode);
      })
      .catch(() => {});
  }, []);

  const toggleValueMode = () => {
    const next = valueMode === 'dynasty' ? 'redraft' : 'dynasty';
    setValueMode(next);
    fetch('/api/dynasty/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value_mode: next }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  return (
    <BrowserRouter>
      <nav style={{ flexWrap: 'wrap', gap: '4px 0' }}>
        <Link to="/">Roster</Link>
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/digest">Digest</Link>
        <Link to="/trade">Trade Builder</Link>
        <Link to="/proposals">Proposals</Link>
        <Link to="/playoffs">Playoffs</Link>
        <Link to="/picks">Pick Calculator</Link>
        <Link to="/team-needs">Team Needs</Link>
        <Link to="/power-rankings">Power Rankings</Link>
        <Link to="/exposure">Exposure</Link>
        <Link to="/news">News</Link>
        <Link to="/activity">Activity</Link>
        <Link to="/movers">Movers</Link>
        <Link to="/start-sit">Start/Sit</Link>
        <Link to="/waiver">Waiver Wire</Link>
        <Link to="/trade-history">Trade History</Link>
        <Link to="/value-history">Value History</Link>
        <Link to="/rookies">Rookies</Link>
        <Link to="/mock-draft">Mock Draft</Link>
        <Link to="/data-doctor">Data Doctor</Link>
        <Link to="/simulation-lab">Simulation Lab</Link>
        <span style={{ color: 'var(--border-color)', margin: '0 4px' }}>|</span>
        <Link to="/baseball">⚾ Baseball</Link>
        <Link to="/baseball/draft">⚾ Draft Board</Link>        <Link to="/baseball/compare">⚾ Compare Players</Link>
        <GlobalSearch />
        <button
          className="dark-mode-toggle"
          onClick={toggleValueMode}
          aria-label="Toggle dynasty/redraft value mode"
          title={
            valueMode === 'dynasty'
              ? 'Dynasty values shown. Redraft mode is not yet wired to real ADP data — switching persists your preference but values will not change yet.'
              : 'Redraft mode selected (not yet wired to real ADP-based values — this is a placeholder preference, not live data).'
          }
        >
          {valueMode === 'dynasty' ? '🏆 Dynasty' : '🔁 Redraft*'}
        </button>
        <button
          className="dark-mode-toggle"
          onClick={() => setDarkMode((prev) => !prev)}
          aria-label="Toggle dark mode"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
      </nav>
      <Routes>
        <Route path="/" element={<Roster />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/digest" element={<Digest />} />
        <Route path="/trade" element={<TradeBuilder />} />
        <Route path="/proposals" element={<Proposals />} />
        <Route path="/playoffs" element={<Playoffs />} />
        <Route path="/players/:playerId" element={<PlayerProfile />} />
        <Route path="/picks" element={<PickCalculator />} />
        <Route path="/team-needs" element={<TeamNeeds />} />
        <Route path="/power-rankings" element={<PowerRankings />} />
        <Route path="/exposure" element={<Exposure />} />
        <Route path="/news" element={<News />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/movers" element={<Movers />} />
        <Route path="/start-sit" element={<StartSit />} />
        <Route path="/waiver" element={<WaiverWire />} />
        <Route path="/trade-history" element={<TradeHistory />} />
        <Route path="/value-history" element={<ValueHistory />} />
        <Route path="/rookies" element={<Rookies />} />
        <Route path="/mock-draft" element={<MockDraft />} />
        <Route path="/data-doctor" element={<DataDoctor />} />
        <Route path="/simulation-lab" element={<SimulationLab />} />
        <Route path="/baseball" element={<BaseballHome />} />
        <Route path="/baseball/prospects" element={<Prospects />} />
        <Route path="/baseball/players/:mlbId" element={<PlayerPage />} />
        <Route path="/baseball/roster" element={<BaseballRoster />} />
        <Route path="/baseball/draft" element={<BaseballDraft />} />        <Route path="/baseball/compare" element={<BaseballPlayerComparison />} />
      </Routes>
    </BrowserRouter>
  );
}
