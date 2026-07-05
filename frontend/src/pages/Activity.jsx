import { useCallback, useEffect, useMemo, useState } from 'react';

const TYPE_STYLES = {
  trade: { bg: '#ede9fe', text: '#5b21b6', label: 'Trade' },
  waiver: { bg: '#d1fae5', text: '#065f46', label: 'Waiver' },
  roster_move: { bg: '#e0f2fe', text: '#0369a1', label: 'Roster Move' },
};

function formatTime(value) {
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
  const style = TYPE_STYLES[type] || TYPE_STYLES.roster_move;
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

function PlayerList({ players }) {
  if (!players || players.length === 0) {
    return <span style={{ color: '#98a2b3' }}>No players listed</span>;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
  );
}

function ActivityCard({ item }) {
  const teams = item.teams_involved?.map((team) => team.name).join(' / ') || 'League activity';
  return (
    <article
      style={{
        background: '#fff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            <ActivityBadge type={item.activity_type} />
            <strong style={{ color: '#344054', fontSize: 14 }}>{item.league_name}</strong>
          </div>
          <h2 style={{ fontSize: 17, margin: '0 0 4px' }}>{teams}</h2>
          <p style={{ color: '#667085', fontSize: 13, margin: 0 }}>
            {formatTime(item.timestamp)}
            {item.week ? ` · Week ${item.week}` : ''}
          </p>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <PlayerList players={item.players_involved} />
      </div>

      {item.draft_picks?.length > 0 && (
        <p style={{ color: '#667085', fontSize: 13, margin: '12px 0 0' }}>
          Draft picks involved: {item.draft_picks.length}
        </p>
      )}
    </article>
  );
}

export default function Activity() {
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

  const counts = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc[item.activity_type] = (acc[item.activity_type] || 0) + 1;
        return acc;
      },
      { trade: 0, waiver: 0, roster_move: 0 },
    );
  }, [items]);

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
