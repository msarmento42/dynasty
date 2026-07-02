import { useMemo, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';

const ACTION_TYPES = [
  ['trade', 'Trade'],
  ['add_drop', 'Add/drop'],
  ['draft_pick', 'Draft pick'],
  ['lineup_change', 'Lineup change'],
  ['baseball_move', 'Baseball move'],
];

function fmt(value) {
  return Number(value || 0).toLocaleString();
}

function playerName(player) {
  return `${player.name} (${player.position || 'N/A'}${player.team ? `, ${player.team}` : ''})`;
}

function uniquePlayers(teams) {
  const players = new Map();
  for (const team of teams || []) {
    for (const player of team.players || []) {
      players.set(player.sleeper_id, { ...player, owner: team.owner });
    }
  }
  return Array.from(players.values()).sort((a, b) => (b.adjusted_value || 0) - (a.adjusted_value || 0));
}

function Stat({ label, value, tone }) {
  const color = tone === 'good' ? '#067647' : tone === 'bad' ? '#b42318' : '#344054';
  return (
    <div style={{ border: '1px solid #e4e7ec', borderRadius: 8, padding: 12 }}>
      <div style={{ color: '#667085', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function MultiSelect({ label, players, value, onChange }) {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
      {label}
      <select
        multiple
        value={value}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
        style={{ border: '1px solid #cbd5e1', borderRadius: 8, minHeight: 120, padding: 8 }}
      >
        {players.map((player) => (
          <option key={player.sleeper_id} value={player.sleeper_id}>
            {playerName(player)} - {fmt(player.adjusted_value || player.value_sf)}
          </option>
        ))}
      </select>
    </label>
  );
}

function PickEditor({ title, picks, setPicks }) {
  const [year, setYear] = useState(new Date().getFullYear() + 1);
  const [round, setRound] = useState(1);
  return (
    <div style={{ border: '1px solid #e4e7ec', borderRadius: 8, padding: 12 }}>
      <strong>{title}</strong>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          type="number"
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          style={{ border: '1px solid #cbd5e1', borderRadius: 7, padding: 8, width: 110 }}
        />
        <select
          value={round}
          onChange={(event) => setRound(Number(event.target.value))}
          style={{ border: '1px solid #cbd5e1', borderRadius: 7, padding: 8 }}
        >
          {[1, 2, 3, 4].map((roundNumber) => (
            <option key={roundNumber} value={roundNumber}>Round {roundNumber}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPicks([...picks, { year, round }])}
          style={{ border: 0, borderRadius: 7, cursor: 'pointer', fontWeight: 800, padding: '8px 12px' }}
        >
          Add
        </button>
      </div>
      {picks.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {picks.map((pick, index) => (
            <button
              key={`${pick.year}-${pick.round}-${index}`}
              type="button"
              onClick={() => setPicks(picks.filter((_, itemIndex) => itemIndex !== index))}
              style={{ border: '1px solid #bfdbfe', borderRadius: 999, padding: '5px 9px' }}
            >
              {pick.year} R{pick.round} x
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Snapshot({ title, data }) {
  if (!data) return null;
  const positions = data.position_totals || {};
  return (
    <section style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <Stat label="Total value" value={fmt(data.total_value)} />
        <Stat label="Roster value" value={fmt(data.roster_value)} />
        <Stat label="Pick value" value={fmt(data.pick_value)} />
        <Stat label="Power rank" value={`#${data.rank || '-'}`} />
        <Stat label="Playoff odds" value={`${data.playoff_odds || 0}%`} />
        <Stat label="Roster age" value={data.average_age || '-'} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        {Object.entries(positions).map(([position, value]) => (
          <span
            key={position}
            style={{ background: '#f2f4f7', borderRadius: 999, color: '#344054', fontWeight: 700, padding: '6px 10px' }}
          >
            {position}: {fmt(value)}
          </span>
        ))}
      </div>
    </section>
  );
}

export default function SimulationLab() {
  const [leagueId, setLeagueId] = useState('');
  const [lab, setLab] = useState(null);
  const [scenarioName, setScenarioName] = useState('New what-if scenario');
  const [actionType, setActionType] = useState('trade');
  const [sendIds, setSendIds] = useState([]);
  const [receiveIds, setReceiveIds] = useState([]);
  const [picksAdded, setPicksAdded] = useState([]);
  const [picksRemoved, setPicksRemoved] = useState([]);
  const [baseballAdd, setBaseballAdd] = useState(0);
  const [baseballRemove, setBaseballRemove] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allPlayers = useMemo(() => uniquePlayers(lab?.teams || []), [lab]);
  const myPlayers = lab?.my_team?.players || [];

  async function loadLeague(selectedLeagueId) {
    setLeagueId(selectedLeagueId);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch(`/fantasy/league/${selectedLeagueId}/simulation-lab`);
      if (!response.ok) throw new Error('Unable to load simulation lab');
      setLab(await response.json());
    } catch (err) {
      setLab(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function buildAction() {
    const action = {
      action_type: actionType,
      label: ACTION_TYPES.find(([value]) => value === actionType)?.[1] || 'Scenario action',
      send_player_ids: actionType === 'trade' ? sendIds : [],
      receive_player_ids: actionType === 'trade' ? receiveIds : [],
      drop_player_ids: actionType === 'add_drop' ? sendIds : [],
      add_player_ids: actionType === 'add_drop' ? receiveIds : [],
      lineup_player_ids: actionType === 'lineup_change' ? receiveIds : [],
      picks_added: picksAdded,
      picks_removed: picksRemoved,
      baseball_add_values: actionType === 'baseball_move' ? [Number(baseballAdd || 0)] : [],
      baseball_remove_values: actionType === 'baseball_move' ? [Number(baseballRemove || 0)] : [],
    };
    return action;
  }

  async function evaluate(save) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/fantasy/simulation-lab/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: leagueId,
          name: scenarioName,
          actions: [buildAction()],
          save,
        }),
      });
      if (!response.ok) throw new Error('Unable to evaluate scenario');
      const data = await response.json();
      setResult(data);
      if (save) await loadLeague(leagueId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary;

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 20, margin: '0 auto', maxWidth: 1240 }}>
        <div>
          <h1 style={{ margin: 0 }}>Simulation Lab</h1>
          <p style={{ color: '#667085', margin: '6px 0 0' }}>
            Model trades, add/drops, picks, lineup changes, and baseball moves without changing real rosters.
          </p>
        </div>
        <LeagueSelector onSelect={loadLeague} />
        {error && <p style={{ color: '#b42318', fontWeight: 700 }}>{error}</p>}

        {lab && (
          <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(320px, 0.85fr) minmax(0, 1.15fr)' }}>
            <section style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
              <h2 style={{ marginTop: 0 }}>Build Scenario</h2>
              <div style={{ display: 'grid', gap: 14 }}>
                <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Scenario name
                  <input
                    value={scenarioName}
                    onChange={(event) => setScenarioName(event.target.value)}
                    style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 10 }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Action type
                  <select
                    value={actionType}
                    onChange={(event) => setActionType(event.target.value)}
                    style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 10 }}
                  >
                    {ACTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>

                {actionType !== 'baseball_move' && (
                  <>
                    <MultiSelect
                      label={actionType === 'add_drop' ? 'Drop players' : 'Send players'}
                      players={myPlayers}
                      value={sendIds}
                      onChange={setSendIds}
                    />
                    <MultiSelect
                      label={actionType === 'lineup_change' ? 'Start or prioritize players' : 'Receive or add players'}
                      players={allPlayers}
                      value={receiveIds}
                      onChange={setReceiveIds}
                    />
                    <PickEditor title="Picks added" picks={picksAdded} setPicks={setPicksAdded} />
                    <PickEditor title="Picks removed" picks={picksRemoved} setPicks={setPicksRemoved} />
                  </>
                )}

                {actionType === 'baseball_move' && (
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
                    <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                      Baseball value added
                      <input
                        type="number"
                        value={baseballAdd}
                        onChange={(event) => setBaseballAdd(event.target.value)}
                        style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 10 }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                      Baseball value removed
                      <input
                        type="number"
                        value={baseballRemove}
                        onChange={(event) => setBaseballRemove(event.target.value)}
                        style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 10 }}
                      />
                    </label>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    disabled={loading || !leagueId}
                    onClick={() => evaluate(false)}
                    style={{ border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 800, padding: '11px 14px' }}
                  >
                    Compare
                  </button>
                  <button
                    disabled={loading || !leagueId}
                    onClick={() => evaluate(true)}
                    style={{ border: '1px solid #98a2b3', borderRadius: 8, cursor: 'pointer', fontWeight: 800, padding: '11px 14px' }}
                  >
                    Save Scenario
                  </button>
                </div>
              </div>
            </section>

            <section style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                <Snapshot title="Baseline" data={result?.baseline || lab.my_team} />
                <Snapshot title="Scenario" data={result?.scenario} />
              </div>

              {summary && (
                <section style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
                  <h2 style={{ marginTop: 0 }}>Impact</h2>
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                    <Stat
                      label="Value delta"
                      value={`${summary.value_delta >= 0 ? '+' : ''}${fmt(summary.value_delta)}`}
                      tone={summary.value_delta >= 0 ? 'good' : 'bad'}
                    />
                    <Stat label="Value pct" value={`${summary.value_delta_pct}%`} />
                    <Stat label="Rank change" value={`${summary.rank_delta >= 0 ? '+' : ''}${summary.rank_delta}`} />
                    <Stat label="Playoff odds" value={`${summary.playoff_odds_delta >= 0 ? '+' : ''}${summary.playoff_odds_delta}%`} />
                    <Stat label="Long-term cost" value={fmt(summary.long_term_cost)} />
                    <Stat label="Win-now impact" value={summary.win_now_impact} />
                  </div>
                  <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                    {(result.actions || []).map((action, index) => (
                      <div
                        key={`${action.action_type}-${index}`}
                        style={{ borderTop: '1px solid #e4e7ec', display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}
                      >
                        <span>{action.label}</span>
                        <strong>{action.delta >= 0 ? '+' : ''}{fmt(action.delta)}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
                <h2 style={{ marginTop: 0 }}>Saved Scenarios</h2>
                {(lab.saved_scenarios || []).length === 0 ? (
                  <p style={{ color: '#667085' }}>No saved scenarios yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {lab.saved_scenarios.map((scenario) => (
                      <button
                        key={scenario.scenario_id}
                        onClick={() => setResult(scenario.result)}
                        style={{
                          background: '#fff',
                          border: '1px solid #e4e7ec',
                          borderRadius: 8,
                          cursor: 'pointer',
                          padding: 12,
                          textAlign: 'left',
                        }}
                      >
                        <strong>{scenario.name}</strong>
                        <div style={{ color: '#667085', fontSize: 13, marginTop: 4 }}>
                          {scenario.result?.summary?.value_delta >= 0 ? '+' : ''}
                          {fmt(scenario.result?.summary?.value_delta)} value delta
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </section>
          </div>
        )}

        {loading && !lab && <p style={{ color: '#667085' }}>Loading simulation lab...</p>}
      </section>
    </main>
  );
}
