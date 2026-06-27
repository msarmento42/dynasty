import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LevelBadge, PosBadge } from './BaseballHome.jsx';

const API = import.meta.env.VITE_API_URL || '';

const POSITIONS = ['All', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH'];
const LEVELS = ['All', 'AAA', 'AA', 'A+', 'A', 'Rookie'];

export default function Prospects() {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [posFilter, setPosFilter] = useState('All');
  const [levelFilter, setLevelFilter] = useState('All');
  const [nameFilter, setNameFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API}/api/baseball/prospects?limit=500`);
        if (!res.ok) throw new Error(`Failed to load prospects (${res.status})`);
        const data = await res.json();
        setProspects(data.prospects || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    return prospects.filter((p) => {
      if (levelFilter !== 'All' && p.level !== levelFilter) return false;
      if (posFilter !== 'All') {
        const pos = (p.position || '').toUpperCase();
        if (posFilter === 'OF') {
          if (!['LF', 'CF', 'RF', 'OF'].includes(pos)) return false;
        } else if (pos !== posFilter) return false;
      }
      if (nameFilter && !p.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
      return true;
    });
  }, [prospects, posFilter, levelFilter, nameFilter]);

  return (
    <main style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <span style={{ fontSize: 28 }}>⚾</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>Prospect Tracker</h1>
            <p style={{ margin: '3px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              Active minor leaguers · MLB Stats API · 2025 season
            </p>
          </div>
        </div>

        {/* Filters */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          padding: '14px 16px',
          marginBottom: 18,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
        }}>
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="Filter by name..."
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              minWidth: 180,
            }}
          />
          <FilterGroup label="Level" options={LEVELS} value={levelFilter} onChange={setLevelFilter} />
          <FilterGroup label="Position" options={POSITIONS} value={posFilter} onChange={setPosFilter} />
          {prospects.length > 0 && (
            <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 13 }}>
              {filtered.length} / {prospects.length} prospects
            </span>
          )}
        </div>

        {/* Content */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>
            Loading prospects from MLB API... (may take a few seconds)
          </div>
        )}
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {!loading && !error && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                  {['Name', 'Pos', 'Team', 'Level', 'Age'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 14px',
                      textAlign: 'left',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr
                    key={`${p.mlb_id}-${i}`}
                    onClick={() => navigate(`/baseball/players/${p.mlb_id}`)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border-color)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '9px 14px', fontWeight: 600 }}>{p.name}</td>
                    <td style={{ padding: '9px 14px' }}><PosBadge pos={p.position} /></td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>{p.team || '—'}</td>
                    <td style={{ padding: '9px 14px' }}><LevelBadge level={p.level} /></td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>{p.age || '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No prospects match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}:</span>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '3px 9px',
              borderRadius: 5,
              border: '1px solid var(--border-color)',
              background: value === opt ? 'var(--accent)' : 'var(--bg-secondary)',
              color: value === opt ? '#fff' : 'var(--text-primary)',
              fontSize: 12,
              fontWeight: value === opt ? 700 : 400,
              cursor: 'pointer',
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
