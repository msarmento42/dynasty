import { useCallback, useEffect, useState } from 'react';

const POS_COLORS = {
  QB: { bg: '#e0f2fe', text: '#0369a1' },
  RB: { bg: '#d1fae5', text: '#065f46' },
  WR: { bg: '#fef3c7', text: '#92400e' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
};

function PosBadge({ position }) {
  const c = POS_COLORS[position] || { bg: '#f2f4f7', text: '#344054' };
  return (
    <span
      style={{
        background: c.bg,
        borderRadius: 4,
        color: c.text,
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 7px',
      }}
    >
      {position || '—'}
    </span>
  );
}

function MoverCard({ player, type }) {
  const isGainer = type === 'gainer';
  const arrowColor = isGainer ? '#12b76a' : '#f04438';
  const arrow = isGainer ? '▲' : '▼';
  const sign = isGainer ? '+' : '';

  return (
    <div
      style={{
        alignItems: 'center',
        background: '#fff',
        border: '1px solid #d9dee7',
        borderLeft: `4px solid ${arrowColor}`,
        borderRadius: 8,
        display: 'flex',
        gap: 12,
        justifyContent: 'space-between',
        padding: '12px 16px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 700 }}>{player.player_name}</span>
          <PosBadge position={player.position} />
          {player.team && (
            <span style={{ color: '#667085', fontSize: 12 }}>{player.team}</span>
          )}
        </div>
        <div style={{ color: '#98a2b3', fontSize: 12 }}>
          {Number(player.value_7d_ago).toLocaleString()} → {Number(player.value_now).toLocaleString()} dynasty pts
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ color: arrowColor, fontWeight: 700, fontSize: 17 }}>
          {arrow} {sign}{Math.abs(player.delta).toLocaleString()}
        </div>
        <div style={{ color: arrowColor, fontSize: 13 }}>
          {sign}{player.delta_pct}%
        </div>
      </div>
    </div>
  );
}

function PlaceholderCards({ count = 3, label }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p style={{ color: '#98a2b3', fontSize: 13, margin: '0 0 8px', textAlign: 'center' }}>
        {label}
      </p>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: '#f9fafb',
            border: '1px dashed #d9dee7',
            borderRadius: 8,
            height: 62,
          }}
        />
      ))}
    </div>
  );
}

export default function Movers() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/fantasy/players/movers');
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasData = data && (data.gainers?.length > 0 || data.losers?.length > 0);
  const noDataNote = data?.note;

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1080 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 4px' }}>Value Movers</h1>
          <p style={{ color: '#667085', margin: 0 }}>
            Biggest dynasty value changes in the last 7 days across your rosters
          </p>
        </div>

        {loading && <p style={{ color: '#667085' }}>Loading movers...</p>}

        {error && (
          <div
            style={{
              background: '#fef3f2',
              border: '1px solid #fda29b',
              borderRadius: 8,
              color: '#b42318',
              marginBottom: 16,
              padding: 16,
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && (
          <div
            style={{
              display: 'grid',
              gap: 24,
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            }}
          >
            {/* Gainers column */}
            <div>
              <h2 style={{ alignItems: 'center', display: 'flex', fontSize: 16, gap: 8, marginBottom: 14 }}>
                <span>Top Gainers</span>
              </h2>
              {hasData && data.gainers.length > 0 ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {data.gainers.map((p) => (
                    <MoverCard key={p.sleeper_id} player={p} type="gainer" />
                  ))}
                </div>
              ) : (
                <PlaceholderCards
                  label={noDataNote || 'No gainers data yet — snapshots accumulate over 7+ days.'}
                />
              )}
            </div>

            {/* Losers column */}
            <div>
              <h2 style={{ alignItems: 'center', display: 'flex', fontSize: 16, gap: 8, marginBottom: 14 }}>
                <span>Top Losers</span>
              </h2>
              {hasData && data.losers.length > 0 ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {data.losers.map((p) => (
                    <MoverCard key={p.sleeper_id} player={p} type="loser" />
                  ))}
                </div>
              ) : (
                <PlaceholderCards
                  label={noDataNote || 'No losers data yet — snapshots accumulate over 7+ days.'}
                />
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
