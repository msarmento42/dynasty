import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '';

export default function BaseballHome() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  const handleSearch = (value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || value.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API}/api/baseball/players/search?q=${encodeURIComponent(value)}&limit=10`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        setResults(data.players || []);
      } catch (err) {
        setError(err.message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  };

  return (
    <main style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <span style={{ fontSize: 40 }}>⚾</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Baseball Dynasty</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              MLB Stats API · Free · Real-time
            </p>
          </div>
        </div>

        {/* Search */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
          padding: 20,
          marginBottom: 24,
        }}>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Search Players
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name (e.g. Shohei Ohtani, Julio Rodriguez...)"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 7,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: 15,
              boxSizing: 'border-box',
            }}
          />
          {loading && <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>Searching...</p>}
          {error && <p style={{ color: '#b42318', marginTop: 8, fontSize: 13 }}>{error}</p>}

          {results.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {results.map((p) => (
                <div
                  key={p.mlb_id}
                  onClick={() => navigate(`/baseball/players/${p.mlb_id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                >
                  <LevelBadge level={p.level} />
                  <span style={{ fontWeight: 600, minWidth: 180 }}>{p.name}</span>
                  <PosBadge pos={p.position} />
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{p.team || '—'}</span>
                  {p.age && (
                    <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 13 }}>
                      Age {p.age}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick links */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <QuickLink to="/baseball/prospects" icon="📋" title="Prospect Tracker" desc="Browse all active minor leaguers by level" />
          <QuickLink to="/baseball/roster" icon="⭐" title="My Roster" desc="Manage your baseball dynasty roster" />
          <QuickLink to="/baseball/values" icon="↔️" title="Value Tools" desc="Sort values, analyze trades, and find proposals" />
        </div>
      </div>
    </main>
  );
}

function QuickLink({ to, icon, title, desc }) {
  return (
    <Link
      to={to}
      style={{ textDecoration: 'none' }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
          padding: '18px 20px',
          cursor: 'pointer',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(59,130,246,0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-color)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 6 }}>{icon}</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{desc}</div>
      </div>
    </Link>
  );
}

export function LevelBadge({ level }) {
  const colors = {
    MLB:    { bg: '#1a365d', color: '#bee3f8' },
    AAA:    { bg: '#744210', color: '#fefcbf' },
    AA:     { bg: '#1e3a8a', color: '#bfdbfe' },
    'A+':   { bg: '#14532d', color: '#bbf7d0' },
    A:      { bg: '#374151', color: '#d1d5db' },
    Rookie: { bg: '#4c1d95', color: '#ddd6fe' },
  };
  const style = colors[level] || colors['A'];
  return (
    <span style={{
      background: style.bg,
      color: style.color,
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 7px',
      borderRadius: 999,
      letterSpacing: '0.03em',
      whiteSpace: 'nowrap',
    }}>
      {level || '—'}
    </span>
  );
}

export function PosBadge({ pos }) {
  if (!pos) return null;
  const pitcher = ['SP', 'RP', 'P'].includes(pos);
  return (
    <span style={{
      background: pitcher ? '#fce7f3' : '#eff6ff',
      color: pitcher ? '#9d174d' : '#1d4ed8',
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 7px',
      borderRadius: 6,
      minWidth: 28,
      textAlign: 'center',
    }}>
      {pos}
    </span>
  );
}
