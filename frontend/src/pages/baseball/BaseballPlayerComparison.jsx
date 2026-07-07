import { useState, useRef, useEffect } from 'react';
import BaseballPlayerComparisonCard from '../../components/BaseballPlayerComparisonCard';
import { LevelBadge, PosBadge } from './BaseballHome'; // Reusing badges

const API = import.meta.env.VITE_API_URL || '';

export default function BaseballPlayerComparison() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const debounceRef = useRef(null);

  const MAX_PLAYERS = 4; // Limit the number of players for comparison

  const handleSearch = (value) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || value.length < 2) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API}/api/baseball/players/search?q=${encodeURIComponent(value)}&limit=5`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        setSearchResults(data.players || []);
      } catch (err) {
        setError(err.message);
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  };

  const addPlayerToComparison = (player) => {
    if (selectedPlayers.length >= MAX_PLAYERS) {
      setError(`You can compare a maximum of ${MAX_PLAYERS} players.`);
      return;
    }
    if (!selectedPlayers.some(p => p.mlb_id === player.mlb_id)) {
      setSelectedPlayers([...selectedPlayers, player]);
      setSearchQuery(''); // Clear search after adding
      setSearchResults([]);
      setError('');
    } else {
      setError('Player already added to comparison.');
    }
  };

  const removePlayerFromComparison = (mlb_id) => {
    setSelectedPlayers(selectedPlayers.filter(p => p.mlb_id !== mlb_id));
    setError(''); // Clear any previous errors
  };

  return (
    <main style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <span style={{ fontSize: 40 }}>📊</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Player Comparison</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              Compare baseball players side-by-side
            </p>
          </div>
        </div>

        {/* Player Search and Selection */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
          padding: 20,
          marginBottom: 24,
        }}>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Add Player to Comparison ({selectedPlayers.length}/{MAX_PLAYERS})
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name (e.g. Ronald Acuña Jr., Spencer Strider...)"
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
            disabled={selectedPlayers.length >= MAX_PLAYERS}
          />
          {loading && <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>Searching...</p>}
          {error && <p style={{ color: '#b42318', marginTop: 8, fontSize: 13 }}>{error}</p>}

          {searchResults.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {searchResults.map((p) => (
                <div
                  key={p.mlb_id}
                  onClick={() => addPlayerToComparison(p)}
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

        {/* Player Comparison Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`,
          gap: 20,
          marginTop: 20,
        }}>
          {selectedPlayers.map(player => (
            <BaseballPlayerComparisonCard
              key={player.mlb_id}
              player={player}
              onRemove={removePlayerFromComparison}
            />
          ))}
          {/* Render empty cards if fewer than MAX_PLAYERS are selected */}
          {Array.from({ length: MAX_PLAYERS - selectedPlayers.length }).map((_, index) => (
            <BaseballPlayerComparisonCard key={`placeholder-${index}`} player={null} />
          ))}
        </div>
      </div>
    </main>
  );
}
