import { useCallback, useEffect, useMemo, useState } from 'react';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE'];

function ExposureBar({ pct }) {
  let color = '#12b76a'; // green < 25%
  if (pct >= 75) color = '#f04438';       // red
  else if (pct >= 50) color = '#f79009';  // orange
  else if (pct >= 25) color = '#eaaa08';  // yellow

  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
      <div
        style={{
          background: '#e4e7ec',
          borderRadius: 4,
          height: 8,
          overflow: 'hidden',
          width: 80,
        }}
      >
        <div
          style={{
            background: color,
            borderRadius: 4,
            height: '100%',
            transition: 'width 0.3s',
            width: `${pct}%`,
          }}
        />
      </div>
      <span style={{ color, fontWeight: 600, minWidth: 42 }}>{pct}%</span>
    </div>
  );
}

function SummaryCard({ label, value, sub }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #d9dee7',
        borderRadius: 10,
        padding: '16px 20px',
      }}
    >
      <p style={{ color: '#667085', fontSize: 13, margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{value}</p>
      {sub && <p style={{ color: '#98a2b3', fontSize: 12, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  );
}

const POS_COLORS = {
  QB: { bg: '#e0f2fe', text: '#0369a1' },
  RB: { bg: '#d1fae5', text: '#065f46' },
  WR: { bg: '#fef3c7', text: '#92400e' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
};

export default function Exposure() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [highConcentrationOnly, setHighConcentrationOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/fantasy/portfolio/exposure');
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.players.filter((p) => {
      if (posFilter !== 'ALL' && p.position !== posFilter) return false;
      if (highConcentrationOnly && p.exposure_pct <= 50) return false;
      return true;
    });
  }, [data, posFilter, highConcentrationOnly]);

  const summaryStats = useMemo(() => {
    if (!data) return null;
    const all = data.players;
    const highConc = all.filter((p) => p.exposure_pct > 50);
    const top = all[0] || null;
    return {
      highConc: highConc.length,
      unique: all.length,
      topPlayer: top ? `${top.player_name} (${top.exposure_pct}%)` : '—',
    };
  }, [data]);

  const availablePositions = useMemo(() => {
    if (!data) return [];
    const seen = new Set(data.players.map((p) => p.position));
    return POSITION_ORDER.filter((pos) => seen.has(pos)).concat(
      [...seen].filter((pos) => !POSITION_ORDER.includes(pos)),
    );
  }, [data]);

  const thStyle = {
    borderBottom: '1px solid #e4e7ec',
    color: '#667085',
    fontSize: 12,
    fontWeight: 600,
    padding: '10px 12px',
    textAlign: 'left',
    textTransform: 'uppercase',
  };
  const tdStyle = {
    borderBottom: '1px solid #f2f4f7',
    fontSize: 14,
    padding: '10px 12px',
    verticalAlign: 'middle',
  };

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1120 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 4px' }}>Player Exposure</h1>
          {data && (
            <p style={{ color: '#667085', margin: 0 }}>
              Across {data.total_leagues} league{data.total_leagues !== 1 ? 's' : ''}
              {data.league_names && data.league_names.length > 0
                ? `: ${data.league_names.join(', ')}`
                : ''}
            </p>
          )}
        </div>

        {summaryStats && (
          <div
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              marginBottom: 24,
            }}
          >
            <SummaryCard
              label="High Concentration Players"
              value={summaryStats.highConc}
              sub="> 50% exposure"
            />
            <SummaryCard
              label="Unique Players Owned"
              value={summaryStats.unique}
              sub="across all leagues"
            />
            <SummaryCard
              label="Most Exposed Player"
              value={summaryStats.topPlayer}
              sub="highest exposure"
            />
          </div>
        )}

        <div
          style={{
            alignItems: 'center',
            background: '#fff',
            border: '1px solid #d9dee7',
            borderRadius: 8,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 16,
            padding: '12px 16px',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {['ALL', ...availablePositions].map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                style={{
                  background: posFilter === pos ? '#3b5bdb' : '#f2f4f7',
                  border: 'none',
                  borderRadius: 6,
                  color: posFilter === pos ? '#fff' : '#344054',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '6px 14px',
                }}
              >
                {pos}
              </button>
            ))}
          </div>
          <label
            style={{
              alignItems: 'center',
              color: '#344054',
              cursor: 'pointer',
              display: 'flex',
              fontSize: 13,
              fontWeight: 500,
              gap: 8,
              marginLeft: 'auto',
            }}
          >
            <input
              checked={highConcentrationOnly}
              onChange={(e) => setHighConcentrationOnly(e.target.checked)}
              style={{ accentColor: '#3b5bdb', cursor: 'pointer', height: 16, width: 16 }}
              type="checkbox"
            />
            High concentration only (&gt;50%)
          </label>
        </div>

        {loading && <p style={{ color: '#667085' }}>Loading exposure data...</p>}
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

        {!loading && !error && data && data.total_leagues === 0 && (
          <p style={{ color: '#667085', textAlign: 'center' }}>
            No leagues found. Run a daily sync first.
          </p>
        )}

        {!loading && !error && data && data.total_leagues > 0 && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #d9dee7',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            {filtered.length === 0 ? (
              <p style={{ color: '#667085', padding: 24, textAlign: 'center' }}>
                No players match the current filters.
              </p>
            ) : (
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={thStyle}>Player</th>
                    <th style={thStyle}>Pos</th>
                    <th style={thStyle}>Team</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Dynasty Value</th>
                    <th style={thStyle}>Exposure</th>
                    <th style={thStyle}>Leagues</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const posColor = POS_COLORS[p.position] || { bg: '#f2f4f7', text: '#344054' };
                    const leagueLabel =
                      p.leagues_owned.length > 2
                        ? `${p.leagues_owned.slice(0, 2).join(', ')} +${p.leagues_owned.length - 2}`
                        : p.leagues_owned.join(', ');
                    return (
                      <tr
                        key={p.sleeper_id}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                      >
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 600 }}>{p.player_name}</span>
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              background: posColor.bg,
                              borderRadius: 4,
                              color: posColor.text,
                              fontSize: 12,
                              fontWeight: 700,
                              padding: '2px 8px',
                            }}
                          >
                            {p.position}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, color: '#667085' }}>{p.team}</td>
                        <td style={{ ...tdStyle, fontWeight: 600, textAlign: 'right' }}>
                          {p.dynasty_value ? Number(p.dynasty_value).toLocaleString() : '—'}
                        </td>
                        <td style={tdStyle}>
                          <ExposureBar pct={p.exposure_pct} />
                        </td>
                        <td
                          style={{ ...tdStyle, color: '#475467', fontSize: 13, maxWidth: 220 }}
                          title={p.leagues_owned.join(', ')}
                        >
                          {leagueLabel}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
