import { useState, useEffect, useMemo } from 'react';

const POS_COLORS = {
  QB: { bg: '#e0f2fe', text: '#0369a1' },
  RB: { bg: '#d1fae5', text: '#065f46' },
  WR: { bg: '#fef3c7', text: '#92400e' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
};

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE'];

function PosBadge({ pos }) {
  const c = POS_COLORS[pos] || { bg: '#f3f4f6', text: '#374151' };
  return (
    <span
      style={{
        background: c.bg,
        borderRadius: 4,
        color: c.text,
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 7px',
        minWidth: 28,
        textAlign: 'center',
      }}
    >
      {pos}
    </span>
  );
}

function ValueChip({ value }) {
  const v = Number(value) || 0;
  let color = '#dc2626';
  if (v >= 7000) color = '#15803d';
  else if (v >= 4000) color = '#16a34a';
  else if (v >= 2000) color = '#ca8a04';
  else if (v >= 800) color = '#ea580c';
  return (
    <span style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
      {v.toLocaleString()}
    </span>
  );
}

function DepthChip({ depth }) {
  if (depth == null) return <span style={{ color: '#94a3b8' }}>—</span>;
  const color = depth === 1 ? '#16a34a' : depth === 2 ? '#ca8a04' : '#64748b';
  return <span style={{ color, fontWeight: 600 }}>#{depth}</span>;
}

function InjuryBadge({ status }) {
  if (!status) return null;
  const s = status.toUpperCase();
  const map = {
    OUT: { bg: '#fee2e2', text: '#991b1b' },
    DOUBTFUL: { bg: '#fee2e2', text: '#b91c1c' },
    QUESTIONABLE: { bg: '#fef9c3', text: '#854d0e' },
    PROBABLE: { bg: '#f0fdf4', text: '#166534' },
  };
  const c = map[s] || { bg: '#f3f4f6', text: '#374151' };
  return (
    <span
      style={{
        background: c.bg,
        borderRadius: 4,
        color: c.text,
        fontSize: 10,
        fontWeight: 700,
        padding: '1px 5px',
        marginLeft: 4,
      }}
    >
      {s.charAt(0) + s.slice(1).toLowerCase()}
    </span>
  );
}

export default function Rookies() {
  const [rookies, setRookies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activePos, setActivePos] = useState('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/fantasy/players/rookies')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load rookies');
        return r.json();
      })
      .then(setRookies)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = rookies;
    if (activePos !== 'ALL') list = list.filter((p) => p.position === activePos);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.team?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rookies, activePos, search]);

  // Re-rank within filtered list
  const ranked = filtered.map((p, i) => ({ ...p, display_rank: i + 1 }));

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1000 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 4px' }}>Rookie Rankings</h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
            Dynasty value rankings for first-year players
          </p>
        </div>

        {/* Controls */}
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 18,
          }}
        >
          {/* Position tabs */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              display: 'flex',
              gap: 2,
              padding: 3,
            }}
          >
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                onClick={() => setActivePos(pos)}
                style={{
                  background: activePos === pos ? '#6366f1' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: activePos === pos ? '#fff' : '#475569',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '5px 14px',
                  transition: 'all 0.15s',
                }}
              >
                {pos}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            placeholder="Search player or team..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 14,
              outline: 'none',
              padding: '7px 12px',
              width: 220,
            }}
          />

          <span style={{ color: '#94a3b8', fontSize: 13, marginLeft: 'auto' }}>
            {ranked.length} player{ranked.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading && <p style={{ color: '#64748b' }}>Loading rookies...</p>}
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}

        {!loading && !error && ranked.length === 0 && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 10 }}>🏈</div>
            <h3 style={{ color: '#1e293b', margin: '0 0 6px' }}>No rookies found</h3>
            <p style={{ color: '#64748b', margin: 0 }}>
              {search ? 'Try a different search.' : 'Run a daily sync to populate player data.'}
            </p>
          </div>
        )}

        {!loading && !error && ranked.length > 0 && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {/* Table header */}
            <div
              style={{
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                display: 'grid',
                fontSize: 11,
                fontWeight: 700,
                gap: 8,
                gridTemplateColumns: '44px 1fr 60px 56px 44px 110px 60px',
                letterSpacing: 0.5,
                padding: '10px 16px',
                color: '#64748b',
                textTransform: 'uppercase',
              }}
            >
              <div>Rank</div>
              <div>Player</div>
              <div>Pos</div>
              <div>Team</div>
              <div>Age</div>
              <div style={{ textAlign: 'right' }}>Dynasty Val</div>
              <div style={{ textAlign: 'center' }}>Depth</div>
            </div>

            {/* Table rows */}
            {ranked.map((player, idx) => (
              <div
                key={player.sleeper_id}
                style={{
                  alignItems: 'center',
                  borderBottom: idx < ranked.length - 1 ? '1px solid #f1f5f9' : 'none',
                  display: 'grid',
                  fontSize: 14,
                  gap: 8,
                  gridTemplateColumns: '44px 1fr 60px 56px 44px 110px 60px',
                  padding: '12px 16px',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Rank */}
                <div
                  style={{
                    color: player.display_rank <= 3 ? '#6366f1' : '#94a3b8',
                    fontWeight: player.display_rank <= 3 ? 800 : 600,
                    fontSize: player.display_rank <= 3 ? 16 : 14,
                  }}
                >
                  {player.display_rank}
                </div>

                {/* Player name + badges */}
                <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>{player.name}</span>
                  {player.is_rising && (
                    <span
                      title="Rising — positive 30-day trend"
                      style={{
                        background: '#fff7ed',
                        border: '1px solid #fed7aa',
                        borderRadius: 99,
                        color: '#ea580c',
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '1px 6px',
                      }}
                    >
                      RISING
                    </span>
                  )}
                  <InjuryBadge status={player.injury_status} />
                </div>

                {/* Position */}
                <div>
                  <PosBadge pos={player.position} />
                </div>

                {/* Team */}
                <div style={{ color: '#475569', fontSize: 13 }}>{player.team}</div>

                {/* Age */}
                <div style={{ color: '#475569' }}>{player.age ?? '—'}</div>

                {/* Value */}
                <div style={{ textAlign: 'right' }}>
                  <ValueChip value={player.value_sf} />
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 1 }}>
                    {player.positional_rank}
                  </div>
                </div>

                {/* Depth */}
                <div style={{ textAlign: 'center' }}>
                  <DepthChip depth={player.depth_chart_order} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
