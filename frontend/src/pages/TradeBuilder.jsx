import { useCallback, useMemo, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
import VerdictChip from '../components/VerdictChip.jsx';

function playerLabel(player) {
  return `${player.name} (${player.position || 'FA'}${player.team ? `, ${player.team}` : ''})`;
}

function SelectedList({ title, players, onRemove }) {
  return (
    <section style={{ border: '1px solid #d9dee7', borderRadius: 8, padding: 14 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {players.length === 0 ? (
        <p style={{ color: '#667085' }}>No players selected</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {players.map((player) => (
            <button
              key={player.sleeper_id}
              onClick={() => onRemove(player.sleeper_id)}
              style={{
                background: '#eef2ff',
                border: '1px solid #c7d2fe',
                borderRadius: 999,
                cursor: 'pointer',
                padding: '6px 10px',
              }}
            >
              {player.name} x
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function valuesForSide(result, key, fallbackPlayers) {
  const values = result?.[key] || result?.player_values?.[key] || [];
  if (Array.isArray(values) && values.length > 0) {
    return values;
  }

  return fallbackPlayers.map((player) => ({
    sleeper_id: player.sleeper_id,
    name: player.name,
    adjusted_value: player.adjusted_value || player.value || 0,
  }));
}

function ValueList({ title, players }) {
  return (
    <section style={{ borderTop: '1px solid #e4e7ec', paddingTop: 12 }}>
      <strong>{title}</strong>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {players.map((player) => (
          <div
            key={player.sleeper_id || player.name}
            style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}
          >
            <span>{player.name}</span>
            <span>{Number(player.adjusted_value || player.value || 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function TradeBuilder() {
  const [leagueId, setLeagueId] = useState('');
  const [allRosters, setAllRosters] = useState([]);
  const [opponentRosterId, setOpponentRosterId] = useState('');
  const [sideA, setSideA] = useState([]);
  const [sideB, setSideB] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadRosters = useCallback(async (selectedLeagueId) => {
    setLeagueId(selectedLeagueId);
    setLoading(true);
    setError('');
    setResult(null);
    setSideA([]);
    setSideB([]);

    try {
      const response = await fetch(`/fantasy/league/${selectedLeagueId}/all-rosters`);
      if (!response.ok) {
        throw new Error('Unable to load rosters');
      }
      const data = await response.json();
      setAllRosters(data);
      const firstOpponent = data.find((roster) => !roster.is_mine);
      setOpponentRosterId(firstOpponent ? String(firstOpponent.roster_id) : '');
    } catch (err) {
      setAllRosters([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const myRoster = useMemo(() => allRosters.find((roster) => roster.is_mine), [allRosters]);
  const opponentRoster = useMemo(
    () => allRosters.find((roster) => String(roster.roster_id) === opponentRosterId),
    [allRosters, opponentRosterId],
  );

  function addPlayer(player, setSide) {
    setSide((current) => {
      if (current.some((selected) => selected.sleeper_id === player.sleeper_id)) {
        return current;
      }
      return [...current, player];
    });
  }

  async function evaluateTrade() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/fantasy/trade/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: leagueId,
          side_a: { player_ids: sideA.map((player) => player.sleeper_id), picks: [] },
          side_b: { player_ids: sideB.map((player) => player.sleeper_id), picks: [] },
        }),
      });
      if (!response.ok) {
        throw new Error('Unable to evaluate trade');
      }
      setResult(await response.json());
    } catch (err) {
      setResult(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 22, margin: '0 auto', maxWidth: 1180 }}>
        <h1 style={{ margin: 0 }}>Trade Builder</h1>
        <LeagueSelector onSelect={loadRosters} />
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(0, 1.2fr) minmax(320px, 0.8fr)' }}>
          <section style={{ display: 'grid', gap: 16 }}>
            <div style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
              <h2 style={{ marginTop: 0 }}>My players</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(myRoster?.players || []).map((player) => (
                  <button
                    key={player.sleeper_id}
                    onClick={() => addPlayer(player, setSideA)}
                    style={{ border: '1px solid #cbd5e1', borderRadius: 999, cursor: 'pointer', padding: '7px 10px' }}
                  >
                    {playerLabel(player)}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
              <h2 style={{ marginTop: 0 }}>Their players</h2>
              <select
                value={opponentRosterId}
                onChange={(event) => setOpponentRosterId(event.target.value)}
                style={{ border: '1px solid #ccd2dc', borderRadius: 6, marginBottom: 12, padding: '8px 10px' }}
              >
                {allRosters
                  .filter((roster) => !roster.is_mine)
                  .map((roster) => (
                    <option key={roster.roster_id} value={roster.roster_id}>
                      {roster.owner || `Roster ${roster.roster_id}`}
                    </option>
                  ))}
              </select>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(opponentRoster?.players || []).map((player) => (
                  <button
                    key={player.sleeper_id}
                    onClick={() => addPlayer(player, setSideB)}
                    style={{ border: '1px solid #cbd5e1', borderRadius: 999, cursor: 'pointer', padding: '7px 10px' }}
                  >
                    {playerLabel(player)}
                  </button>
                ))}
              </div>
            </div>

            <SelectedList
              title="You send"
              players={sideA}
              onRemove={(id) => setSideA((players) => players.filter((player) => player.sleeper_id !== id))}
            />
            <SelectedList
              title="You receive"
              players={sideB}
              onRemove={(id) => setSideB((players) => players.filter((player) => player.sleeper_id !== id))}
            />
            <button
              disabled={loading || !leagueId || sideA.length === 0 || sideB.length === 0}
              onClick={evaluateTrade}
              style={{ border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 800, padding: 12 }}
            >
              Evaluate Trade
            </button>
          </section>

          <aside style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 18 }}>
            <h2 style={{ marginTop: 0 }}>Result</h2>
            {!result ? (
              <p style={{ color: '#667085' }}>Select players from each side to evaluate a trade.</p>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                <VerdictChip verdict={result.verdict} />
                <strong>Side A: {Number(result.side_a_value || 0).toLocaleString()}</strong>
                <strong>Side B: {Number(result.side_b_value || 0).toLocaleString()}</strong>
                <ValueList title="You send" players={valuesForSide(result, 'side_a_players', sideA)} />
                <ValueList title="You receive" players={valuesForSide(result, 'side_b_players', sideB)} />
                <p>
                  Delta: {Number(result.delta || 0).toLocaleString()} ({Number(result.delta_pct || 0).toFixed(1)}%)
                </p>
                <p>
                  {Number(result.delta || 0) >= 0
                    ? `You're getting ${Number(result.delta || 0).toLocaleString()} value in this trade.`
                    : `You're giving up ${Math.abs(Number(result.delta || 0)).toLocaleString()} value in this trade.`}
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
