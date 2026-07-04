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
import BaseballDraft from './pages/baseball/BaseballDraft.jsx';
import ValueHistory from './pages/ValueHistory.jsx';
import Rookies from './pages/Rookies.jsx';
import MockDraft from './pages/MockDraft.jsx';
import DataDoctor from './pages/DataDoctor.jsx';
import Dashboard from './pages/Dashboard.jsx';
import SimulationLab from './pages/SimulationLab.jsx';
import Arbitrage from './pages/Arbitrage.jsx';

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
        <Link to="/trade">Trade Builder</Link>
        <Link to="/proposals">Proposals</Link>
        <Link to="/arbitrage">Arbitrage</Link>
        <Link to="/playoffs">Playoffs</Link>
        <Link to="/picks">Pick Calculator</Link>
        <Link to="/team-needs">Team Needs</Link>
        <Link to="/power-rankings">Power Rankings</Link>
        <Link to="/exposure">Exposure</Link>
        <Link to="/news">News</Link>
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
        <Link to="/baseball/draft">⚾ Draft Board</Link>
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
        <Route path="/trade" element={<TradeBuilder />} />
        <Route path="/proposals" element={<Proposals />} />
        <Route path="/arbitrage" element={<Arbitrage />} />
        <Route path="/playoffs" element={<Playoffs />} />
        <Route path="/players/:playerId" element={<PlayerProfile />} />
        <Route path="/picks" element={<PickCalculator />} />
        <Route path="/team-needs" element={<TeamNeeds />} />
        <Route path="/power-rankings" element={<PowerRankings />} />
        <Route path="/exposure" element={<Exposure />} />
        <Route path="/news" element={<News />} />
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
        <Route path="/baseball/draft" element={<BaseballDraft />} />
      </Routes>
    </BrowserRouter>
  );
}
