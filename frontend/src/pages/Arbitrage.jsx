import { useCallback, useMemo, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
import ConfidenceBadge from '../components/ConfidenceBadge.jsx';

const STRATEGIES = [
  { value: 'all', label: 'All' },
  { value: 'win_now_buys', label: 'Win-now buys' },
  { value: 'rebuild_buys', label: 'Rebuild buys' },
  { value: 'sell_for_future', label: 'Sell for future' },
  { value: 'watch', label: 'Watch' },
];

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const CATEGORY_META = {
  win_now_buys: {
    title: 'Win-now buys',
    subtitle: 'Current-season usefulness exceeds dynasty price.',
    color: '#0369a1',
    bg: '#e0f2fe',
  },
  rebuild_buys: {
    title: 'Rebuild buys',
    subtitle: 'Long-term dynasty value exceeds current-season usefulness.',
    color: '#047857',
    bg: '#d1fae5',
  },
  sell_for_future: {
    title: 'Sell for future',
    subtitle: 'Rostered players worth more now than later.',
    color: '#b45309',
    bg: '#fef3c7',
  },
  watch: {
    title: 'Watch',
    subtitle: 'Meaningful gap, but not a primary action yet.',
    color: '#6d28d9',
    bg: '#ede9fe',
  },
};

function fmt(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function PlayerCard({ player }) {
  const meta = CATEGORY_META[player.category] || CATEGORY_META.watch;
  const gapColor = player.value_gap >= 0 ? '#0369a1' : '#047857';

  return (
    <article
      style={{
        background: '#fff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        display: 'grid',
        gap: 12,
        padding: 16,
      }}
    >
      <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ color: '#111827', fontSize: 17 }}>{player.name}</strong>
            <span
              style={{
                background: meta.bg,
                borderRadius: 4,
                color: meta.color,
                fontSize: 11,
                fontWeight: 800,
                padding: '3px 7px',
              }}
            >
              {player.position || 'NA'}
            </span>
            {player.team && <span style={{ color: '#667085', fontSize: 13 }}>{player.team}</span>}
          </div>
          <p style={{ color: '#667085', fontSize: 13, margin: '4px 0 0' }}>
            {player.owner_name ? `${player.owner_name}${player.is_mine ? ' (you)' : ''}` : 'Available'}
            {player.age ? ` | Age ${player.age}` : ''}
            {player.career_stage ? ` | ${player.career_stage}` : ''}
          </p>
        </div>
        <ConfidenceBadge confidence={player.data_confidence} />
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <div>
          <div style={{ color: '#667085', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
            Dynasty
          </div>
          <div style={{ color: '#111827', fontSize: 20, fontWeight: 800 }}>{fmt(player.dynasty_value)}</div>
        </div>
        <div>
          <div style={{ color: '#667085', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
            Redraft proxy
          </div>
          <div style={{ color: '#111827', fontSize: 20, fontWeight: 800 }}>{fmt(player.redraft_value)}</div>
        </div>
        <div>
          <div style={{ color: '#667085', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
            Gap
          </div>
          <div style={{ color: gapColor, fontSize: 20, fontWeight: 800 }}>
            {player.value_gap >= 0 ? '+' : ''}{fmt(player.value_gap)}
          </div>
        </div>
      </div>

      <p style={{ color: '#374151', fontSize: 14, lineHeight: 1.45, margin: 0 }}>
        {player.explanation}
      </p>
    </article>
  );
}

function CategorySection({ category, players }) {
  const meta = CATEGORY_META[category];
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ color: '#111827', fontSize: 22, margin: 0 }}>{meta.title}</h2>
        <span style={{ color: '#667085', fontSize: 14 }}>{meta.subtitle}</span>
      </div>
      {players.length === 0 ? (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            color: '#667085',
            padding: 16,
          }}
        >
          No matching players in this bucket.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {players.map((player) => (
            <PlayerCard key={`${category}-${player.sleeper_id}`} player={player} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function Arbitrage() {
  const [leagueId, setLeagueId] = useState('');
  const [position, setPosition] = useState('ALL');
  const [strategy, setStrategy] = useState('all');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (position !== 'ALL') params.set('position', position);
      if (strategy !== 'all') params.set('strategy', strategy);
      const query = params.toString();
      const res = await fetch(`/fantasy/league/${leagueId}/arbitrage${query ? `?${query}` : ''}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Unable to load arbitrage targets');
      setPayload(await res.json());
    } catch (err) {
      setPayload(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [leagueId, position, strategy]);

  const categories = useMemo(() => {
    if (!payload?.categories) return [];
    if (strategy !== 'all') return [strategy];
    return ['win_now_buys', 'rebuild_buys', 'sell_for_future', 'watch'];
  }, [payload, strategy]);

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 22, margin: '0 auto', maxWidth: 1180 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <h1 style={{ color: '#111827', margin: 0 }}>Dynasty vs Redraft Arbitrage</h1>
          <p style={{ color: '#667085', margin: 0 }}>
            Find players whose long-term dynasty price and current-season usefulness are out of sync.
          </p>
        </div>

        <div
          style={{
            alignItems: 'end',
            background: '#fff',
            border: '1px solid #d9dee7',
            borderRadius: 8,
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            padding: 16,
          }}
        >
          <LeagueSelector onSelect={setLeagueId} />
          <label style={{ color: '#344054', display: 'grid', fontSize: 13, fontWeight: 700, gap: 6 }}>
            Position
            <select
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: '8px 10px' }}
            >
              {POSITIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label style={{ color: '#344054', display: 'grid', fontSize: 13, fontWeight: 700, gap: 6 }}>
            Strategy
            <select
              value={strategy}
              onChange={(event) => setStrategy(event.target.value)}
              style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: '8px 10px' }}
            >
              {STRATEGIES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <button
            disabled={!leagueId || loading}
            onClick={load}
            style={{
              background: loading ? '#cbd5e1' : '#111827',
              border: 0,
              borderRadius: 8,
              color: '#fff',
              cursor: !leagueId || loading ? 'not-allowed' : 'pointer',
              fontWeight: 800,
              padding: '10px 16px',
            }}
          >
            {loading ? 'Loading' : 'Find Gaps'}
          </button>
        </div>

        {error && <p style={{ color: '#b42318', margin: 0 }}>{error}</p>}

        {payload && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              color: '#475467',
              fontSize: 13,
              lineHeight: 1.45,
              padding: 14,
            }}
          >
            <strong style={{ color: '#111827' }}>{payload.league_name}</strong>
            <span> | {payload.total_candidates} candidates scanned | {payload.method}</span>
          </div>
        )}

        {payload && categories.map((category) => (
          <CategorySection
            key={category}
            category={category}
            players={payload.categories[category] || []}
          />
        ))}
      </section>
    </main>
  );
}
