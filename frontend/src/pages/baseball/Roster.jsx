import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfidenceBadge from '../../components/ConfidenceBadge.jsx';
import { LevelBadge, PosBadge } from './BaseballHome.jsx';

const API = import.meta.env.VITE_API_URL || '';

const POSITION_GROUP_ORDER = ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH', 'TWP', 'Other'];

function groupByPosition(players) {
  const groups = {};
  for (const p of players) {
    const pos = p.position || 'Other';
    if (!groups[pos]) groups[pos] = [];
    groups[pos].push(p);
  }
  return groups;
}

export default function BaseballRoster() {
  const [players, setPlayers] = useState([]);
  const [confidence, setConfidence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [editingNotes, setEditingNotes] = useState(null);
  const [notesValue, setNotesValue] = useState('');
  const [valueMode, setValueMode] = useState('dynasty');
  const [editingValues, setEditingValues] = useState(null);
  const [valueForm, setValueForm] = useState({
    dynasty_value: '',
    redraft_value: '',
    redraft_rank: '',
    value_trend: '',
  });
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  const loadRoster = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/baseball/roster`);
      if (!res.ok) throw new Error('Failed to load roster');
      const data = await res.json();
      setPlayers(data.players || []);
      setConfidence(data.data_confidence || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRoster(); }, []);

  const handleSearch = (value) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || value.length < 2) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`${API}/api/baseball/players/search?q=${encodeURIComponent(value)}&limit=8`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        setSearchResults(data.players || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 350);
  };

  const handleAdd = async (player) => {
    setSearchQuery('');
    setSearchResults([]);
    try {
      const res = await fetch(`${API}/api/baseball/roster/${player.mlb_id}`, { method: 'POST' });
      if (res.status === 409) {
        alert(`${player.name} is already on your roster.`);
        return;
      }
      if (!res.ok) throw new Error('Failed to add');
      await loadRoster();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleRemove = async (mlbId, name) => {
    if (!confirm(`Remove ${name} from your roster?`)) return;
    setRemoving(mlbId);
    try {
      const res = await fetch(`${API}/api/baseball/roster/${mlbId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove');
      await loadRoster();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setRemoving(null);
    }
  };

  const handleSaveNotes = async (mlbId) => {
    try {
      const res = await fetch(
        `${API}/api/baseball/roster/${mlbId}/notes?notes=${encodeURIComponent(notesValue)}`,
        { method: 'PATCH' },
      );
      if (!res.ok) throw new Error('Failed to save notes');
      setEditingNotes(null);
      await loadRoster();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleSaveValues = async (mlbId) => {
    const payload = {};
    for (const [key, value] of Object.entries(valueForm)) {
      if (value !== '') payload[key] = Number(value);
    }
    try {
      const res = await fetch(`${API}/api/baseball/players/${mlbId}/values`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save values');
      setEditingValues(null);
      await loadRoster();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const sortedPlayers = useMemo(() => {
    const key = valueMode === 'redraft' ? 'redraft_value' : 'dynasty_value';
    return [...players].sort((a, b) => (Number(b[key] || 0) - Number(a[key] || 0)) || a.name.localeCompare(b.name));
  }, [players, valueMode]);
  const grouped = useMemo(() => groupByPosition(sortedPlayers), [sortedPlayers]);

  return (
    <main style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <span style={{ fontSize: 28 }}>⭐</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>My Baseball Roster</h1>
            <p style={{ margin: '3px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              Dynasty roster · {players.length} player{players.length !== 1 ? 's' : ''} · sorting by {valueMode} value
            </p>
            {confidence && (
              <div style={{ marginTop: 8 }}>
                <ConfidenceBadge confidence={confidence} />
              </div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {['dynasty', 'redraft'].map((mode) => (
              <button
                key={mode}
                onClick={() => setValueMode(mode)}
                style={{
                  background: valueMode === mode ? 'var(--accent)' : 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 7,
                  color: valueMode === mode ? '#fff' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '7px 10px',
                  textTransform: 'capitalize',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* Add player search */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
          padding: '16px 18px',
          marginBottom: 20,
          position: 'relative',
        }}>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 8, fontSize: 14 }}>
            Add Player
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name..."
            style={{
              width: '100%',
              padding: '9px 13px',
              borderRadius: 7,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
          {searchLoading && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>Searching...</p>
          )}
          {searchResults.length > 0 && (
            <div style={{
              position: 'absolute',
              left: 18,
              right: 18,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 7,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              zIndex: 100,
              overflow: 'hidden',
            }}>
              {searchResults.map((p) => (
                <div
                  key={p.mlb_id}
                  onClick={() => handleAdd(p)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border-color)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontWeight: 600, flex: 1 }}>{p.name}</span>
                  <PosBadge pos={p.position} />
                  <LevelBadge level={p.level} />
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{p.team || '—'}</span>
                  <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>+ Add</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {/* Roster grouped by position */}
        {loading ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 32 }}>Loading roster...</p>
        ) : players.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            padding: 48,
            textAlign: 'center',
            color: 'var(--text-secondary)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚾</div>
            <p style={{ margin: 0, fontWeight: 600 }}>Your roster is empty</p>
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>Search for players above to add them</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {POSITION_GROUP_ORDER.filter((pos) => grouped[pos]?.length > 0).map((pos) => (
              <PositionGroup
                key={pos}
                pos={pos}
                players={grouped[pos]}
                onRemove={handleRemove}
                removing={removing}
                onNavigate={(id) => navigate(`/baseball/players/${id}`)}
                editingNotes={editingNotes}
                notesValue={notesValue}
                onEditNotes={(id, current) => { setEditingNotes(id); setNotesValue(current || ''); }}
                onSaveNotes={handleSaveNotes}
                onCancelNotes={() => setEditingNotes(null)}
                onNotesChange={setNotesValue}
                valueMode={valueMode}
                editingValues={editingValues}
                valueForm={valueForm}
                onEditValues={(player) => {
                  setEditingValues(player.mlb_id);
                  setValueForm({
                    dynasty_value: player.dynasty_value || '',
                    redraft_value: player.redraft_value || '',
                    redraft_rank: player.redraft_rank || '',
                    value_trend: player.value_trend || '',
                  });
                }}
                onSaveValues={handleSaveValues}
                onCancelValues={() => setEditingValues(null)}
                onValueFormChange={setValueForm}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function PositionGroup({
  pos,
  players,
  onRemove,
  removing,
  onNavigate,
  editingNotes,
  notesValue,
  onEditNotes,
  onSaveNotes,
  onCancelNotes,
  onNotesChange,
  valueMode,
  editingValues,
  valueForm,
  onEditValues,
  onSaveValues,
  onCancelValues,
  onValueFormChange,
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <PosBadge pos={pos} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{pos}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>({players.length})</span>
      </div>
      {players.map((p) => (
        <div key={p.mlb_id}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 16px',
            borderBottom: '1px solid var(--border-color)',
          }}>
            <div
              style={{ flex: 1, cursor: 'pointer' }}
              onClick={() => onNavigate(p.mlb_id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                <LevelBadge level={p.level} />
                <ConfidenceBadge confidence={p.data_confidence} />
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                {[p.team, p.age ? `Age ${p.age}` : null].filter(Boolean).join(' · ')}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>
                <span>Dynasty: <strong>{p.dynasty_value ? Number(p.dynasty_value).toLocaleString() : 'Missing'}</strong></span>
                <span>Redraft: <strong>{p.redraft_value ? Number(p.redraft_value).toLocaleString() : 'Missing'}</strong></span>
                {p.is_prospect && <span style={{ color: '#92400e', fontWeight: 700 }}>Prospect</span>}
                {!p.is_prospect && <span style={{ color: '#166534', fontWeight: 700 }}>MLB contributor</span>}
              </div>
            </div>
            <button
              onClick={() => onEditValues(p)}
              style={{
                background: (valueMode === 'dynasty' ? p.dynasty_value : p.redraft_value) ? 'none' : '#fff7ed',
                border: '1px solid var(--border-color)',
                borderRadius: 5,
                padding: '3px 8px',
                fontSize: 11,
                cursor: 'pointer',
                color: (valueMode === 'dynasty' ? p.dynasty_value : p.redraft_value) ? 'var(--text-secondary)' : '#9a3412',
              }}
            >
              Values
            </button>
            <button
              onClick={() => onEditNotes(p.mlb_id, p.notes)}
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: 5,
                padding: '3px 8px',
                fontSize: 11,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              {p.notes ? '✏️ Notes' : '+ Notes'}
            </button>
            <button
              onClick={() => onRemove(p.mlb_id, p.name)}
              disabled={removing === p.mlb_id}
              style={{
                background: 'none',
                border: '1px solid #fca5a5',
                borderRadius: 5,
                padding: '3px 8px',
                fontSize: 11,
                cursor: removing === p.mlb_id ? 'wait' : 'pointer',
                color: '#dc2626',
              }}
            >
              {removing === p.mlb_id ? '...' : 'Remove'}
            </button>
          </div>
          {editingNotes === p.mlb_id && (
            <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
              <textarea
                value={notesValue}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="Add notes about this player..."
                rows={3}
                style={{
                  width: '100%',
                  padding: 8,
                  borderRadius: 6,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button
                  onClick={() => onSaveNotes(p.mlb_id)}
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 14px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
                <button
                  onClick={onCancelNotes}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    padding: '5px 14px',
                    fontSize: 12,
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {editingValues === p.mlb_id && (
            <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                {[
                  ['dynasty_value', 'Dynasty value'],
                  ['redraft_value', 'Redraft value'],
                  ['redraft_rank', 'Redraft rank'],
                  ['value_trend', 'Trend'],
                ].map(([key, label]) => (
                  <label key={key} style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}>
                    {label}
                    <input
                      type="number"
                      value={valueForm[key]}
                      onChange={(event) => onValueFormChange({ ...valueForm, [key]: event.target.value })}
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 6,
                        boxSizing: 'border-box',
                        color: 'var(--text-primary)',
                        display: 'block',
                        fontSize: 13,
                        marginTop: 4,
                        padding: 7,
                        width: '100%',
                      }}
                    />
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => onSaveValues(p.mlb_id)}
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Save
                </button>
                <button
                  onClick={onCancelValues}
                  style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 6, padding: '5px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {p.notes && editingNotes !== p.mlb_id && (
            <div style={{
              padding: '6px 16px 10px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
              borderBottom: '1px solid var(--border-color)',
            }}>
              {p.notes}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
