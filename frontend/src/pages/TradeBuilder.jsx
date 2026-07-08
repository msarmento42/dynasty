import { useCallback, useMemo, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
import PositionalImpactDisplay from '../components/PositionalImpactDisplay.jsx';
import VerdictChip from '../components/VerdictChip.jsx';
import ConfidenceBadge from '../components/ConfidenceBadge.jsx';import LoadingSkeleton from '../components/LoadingSkeleton.jsx';
import TradePartnerFinder from '../components/TradePartnerFinder.jsx';

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

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function findBulkPlayers(input, rosters) {
  const tokens = input
    .split(/[\n,]+/)
    .map(normalizeSearch)
    .filter(Boolean);
  const players = rosters.flatMap((roster) => roster.players || []);
  const seen = new Set();

  return tokens
    .map((token) => players.find((player) => (
      normalizeSearch(player.sleeper_id) === token
      || normalizeSearch(player.name) === token
      || normalizeSearch(player.full_name) === token
    )))
    .filter((player) => {
      if (!player || seen.has(player.sleeper_id)) return false;
      seen.add(player.sleeper_id);
      return true;
    });
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
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ConfidenceBadge confidence={player.data_confidence} />
              {Number(player.trade_value || player.adjusted_value || player.value || 0).toLocaleString()}
              {player.startup_delta ? (
                <small style={{ color: player.startup_delta > 0 ? '#15803d' : '#b42318', fontWeight: 800 }}>
                  {player.startup_delta > 0 ? '+' : ''}
                  {Number(player.startup_delta).toLocaleString()}
                </small>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function scarcityColor(score) {
  if (score >= 70) return '#b42318';
  if (score >= 45) return '#ea580c';
  if (score >= 25) return '#ca8a04';
  return '#15803d';
}

function ScarcityContext({ positions }) {
  if (!positions.length) return null;

  return (
    <section style={{ borderTop: '1px solid #e4e7ec', display: 'grid', gap: 10, paddingTop: 12 }}>
      <strong>Scarcity context</strong>
      {positions.map((position) => (
        <div
          key={position.position}
          style={{
            border: '1px solid #e4e7ec',
            borderRadius: 8,
            display: 'grid',
            gap: 4,
            padding: 10,
          }}
        >
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 800 }}>{position.position}</span>
            <span style={{ color: scarcityColor(position.scarcity_score), fontWeight: 800 }}>
              {position.scarcity_score}
            </span>
          </div>
          <div style={{ color: scarcityColor(position.scarcity_score), fontSize: 13, fontWeight: 700 }}>
            {position.scarcity_label}
          </div>
          <div style={{ color: '#667085', fontSize: 12 }}>
            Leader: {position.top_team?.team_name || 'None'} ({position.top_team?.share_pct || 0}% of league value)
          </div>
        </div>
      ))}
    </section>
  );
}

export default function TradeBuilder() {
  const [leagueId, setLeagueId] = useState('');
  const [allRosters, setAllRosters] = useState([]);
  const [opponentRosterId, setOpponentRosterId] = useState('');
  const [mode, setMode] = useState('in-season');
  const [draftPosition, setDraftPosition] = useState(1);
  const [scarcity, setScarcity] = useState(null);
  const [sideA, setSideA] = useState([]);
  const [sideB, setSideB] = useState([]);
  const [bulkSideA, setBulkSideA] = useState('');
  const [bulkSideB, setBulkSideB] = useState('');
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
    setBulkSideA('');
    setBulkSideB('');
    setScarcity(null);

    try {
      const [response, scarcityResponse] = await Promise.all([
        fetch(`/fantasy/league/${selectedLeagueId}/all-rosters`),
        fetch(`/fantasy/league/${selectedLeagueId}/positional-scarcity`),
      ]);
      if (!response.ok) {
        throw new Error('Unable to load rosters');
      }
      if (!scarcityResponse.ok) {
        throw new Error('Unable to load positional scarcity');
      }
      const data = await response.json();
      setAllRosters(data);
      setScarcity(await scarcityResponse.json());
      const firstOpponent = data.find((roster) => !roster.is_mine);
      setOpponentRosterId(firstOpponent ? String(firstOpponent.roster_id) : '');
    } catch (err) {
      setAllRosters([]);
      setScarcity(null);
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
  const involvedScarcity = useMemo(() => {
    if (!result || !scarcity?.positions) return [];
    const involved = new Set([...sideA, ...sideB].map((player) => player.position).filter(Boolean));
    return scarcity.positions.filter((position) => involved.has(position.position));
  }, [result, scarcity, sideA, sideB]);

  function addPlayer(player, setSide) {
    setSide((current) => {
      if (current.some((selected) => selected.sleeper_id === player.sleeper_id)) {
        return current;
      }
      return [...current, player];
    });
  }

  function applyBulkPlayers(input, setInput, setSide) {
    const matches = findBulkPlayers(input, allRosters);
    setSide((current) => {
      const existing = new Set(current.map((player) => player.sleeper_id));
      return [...current, ...matches.filter((player) => !existing.has(player.sleeper_id))];
    });
    setInput('');
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
          mode,
          draft_position: Number(draftPosition) || 1,
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
      <section className="trade-builder-container">
        <h1 style={{ margin: 0 }}>Trade Builder</h1>
        <LeagueSelector onSelect={loadRosters} />
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        <section className="trade-builder-mode-selector">
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              ['in-season', 'In-Season'],
              ['startup', 'Startup Draft'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setMode(value);
                  setResult(null);
                }}
                style={{
                  background: mode === value ? '#111827' : '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  color: mode === value ? '#ffffff' : '#111827',
                  cursor: 'pointer',
                  fontWeight: 800,
                  padding: '8px 12px',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'startup' && (
            <label style={{ alignItems: 'center', display: 'flex', gap: 8, fontWeight: 700 }}>
              Current pick
              <input
                min="1"
                onChange={(event) => setDraftPosition(event.target.value)}
                type="number"
                value={draftPosition}
                style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: '7px 9px', width: 86 }}
              />
            </label>
          )}
        </section>

        <div className="trade-builder-grid">
          <section style={{ display: 'grid', gap: 16 }}>
            {loading ? (
              <LoadingSkeleton rows={5} avatar={false} badge={false} />
            ) : (
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
            )}

            {loading ? (
              <LoadingSkeleton rows={5} avatar={false} badge={false} />
            ) : (
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
            )}

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
            {mode === 'startup' && (
              <section style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
                <h2 style={{ marginTop: 0 }}>Bulk startup entry</h2>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  <label style={{ display: 'grid', gap: 8, fontWeight: 700 }}>
                    You send
                    <textarea
                      onChange={(event) => setBulkSideA(event.target.value)}
                      placeholder="Paste player names or Sleeper IDs"
                      rows={5}
                      value={bulkSideA}
                      style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: 10 }}
                    />
                    <button
                      onClick={() => applyBulkPlayers(bulkSideA, setBulkSideA, setSideA)}
                      style={{ border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', padding: 10 }}
                    >
                      Add send side
                    </button>
                  </label>
                  <label style={{ display: 'grid', gap: 8, fontWeight: 700 }}>
                    You receive
                    <textarea
                      onChange={(event) => setBulkSideB(event.target.value)}
                      placeholder="Paste player names or Sleeper IDs"
                      rows={5}
                      value={bulkSideB}
                      style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: 10 }}
                    />
                    <button
                      onClick={() => applyBulkPlayers(bulkSideB, setBulkSideB, setSideB)}
                      style={{ border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', padding: 10 }}
                    >
                      Add receive side
                    </button>
                  </label>
                </div>
              </section>
            )}
            <button
              disabled={loading || !leagueId || sideA.length === 0 || sideB.length === 0}
              onClick={evaluateTrade}
              style={{ border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 800, padding: 12 }}
            >
              Evaluate Trade
            </button>
            <TradePartnerFinder />
          </section>

          <aside style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 18 }}>
            <h2 style={{ marginTop: 0 }}>Result</h2>
            {loading ? (
              <LoadingSkeleton
                rows={4}
                metrics={4}
                avatar={false}
                badge={true}
                style={{ background: 'none', border: 'none', padding: '0' }}
              />
            ) : !result ? (
              <p style={{ color: '#667085' }}>Select players from each side to evaluate a trade.</p>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                <strong>{result.mode === 'startup' ? 'Startup Draft mode' : 'In-Season mode'}</strong>
                <VerdictChip verdict={result.verdict} />
                <ConfidenceBadge confidence={result.data_confidence} />
                <strong>Side A: {Number(result.side_a_value || 0).toLocaleString()}</strong>
                <strong>Side B: {Number(result.side_b_value || 0).toLocaleString()}</strong>
                <ValueList title="You send" players={valuesForSide(result, 'side_a_players', sideA)} />
                <ValueList title="You receive" players={valuesForSide(result, 'side_b_players', sideB)} />
                <ScarcityContext positions={involvedScarcity} />
                <PositionalImpactDisplay impact={result.positional_impact} />
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
