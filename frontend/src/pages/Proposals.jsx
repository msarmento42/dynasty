import { useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
import VerdictChip from '../components/VerdictChip.jsx';
import ConfidenceBadge from '../components/ConfidenceBadge.jsx';

function sideText(side) {
  const players = side?.player_names || side?.players || side?.player_ids || [];
  const picks = side?.picks || [];
  const playerText = players.length > 0
    ? players.map((player) => (typeof player === 'string' ? player : player.name || player.sleeper_id)).join(', ')
    : 'No players';
  const pickText = picks.length > 0
    ? ` + ${picks.map((pick) => `${pick.year} R${pick.round}`).join(', ')}`
    : '';
  return `${playerText}${pickText}`;
}

function playerMeta(player) {
  return [
    player.position,
    player.team,
    player.dynasty_value ? `Dyn ${Math.round(player.dynasty_value)}` : '',
    player.redraft_value ? `Redraft ${Math.round(player.redraft_value)}` : '',
    player.trend_30d ? `Trend ${player.trend_30d > 0 ? '+' : ''}${Math.round(player.trend_30d)}` : '',
  ].filter(Boolean).join(' | ');
}

function SideDetail({ title, side }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <strong>{title}</strong>
      <div style={{ display: 'grid', gap: 6 }}>
        {(side?.players || []).map((player) => (
          <div key={player.sleeper_id} style={{ display: 'grid', gap: 2 }}>
            <span>{player.name}</span>
            <small style={{ color: '#5f6b7a' }}>{playerMeta(player)}</small>
          </div>
        ))}
        {(side?.picks || []).map((pick) => (
          <div key={`${pick.year}-${pick.round}`} style={{ display: 'grid', gap: 2 }}>
            <span>{pick.year} round {pick.round} pick</span>
            <small style={{ color: '#5f6b7a' }}>Dynasty value {Math.round(pick.value || 0)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Proposals() {
  const [leagueId, setLeagueId] = useState('');
  const [valueMode, setValueMode] = useState('dynasty');
  const [strategy, setStrategy] = useState('balanced');
  const [proposals, setProposals] = useState([]);
  const [degradedReasons, setDegradedReasons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generateProposals() {
    setLoading(true);
    setError('');
    setDegradedReasons([]);

    try {
      const params = new URLSearchParams({ value_mode: valueMode, strategy });
      const response = await fetch(`/fantasy/proposals/${leagueId}?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Unable to load proposals');
      }
      const data = await response.json();
      setProposals(Array.isArray(data) ? data : data.proposals || []);
      setDegradedReasons(Array.isArray(data?.degraded_reasons) ? data.degraded_reasons : []);
    } catch (err) {
      setProposals([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function copyProposal(proposal) {
    const text = [
      `Trade proposal #${proposal.rank}`,
      `Mode: ${proposal.value_mode || valueMode}`,
      `Strategy: ${proposal.strategy || strategy}`,
      `You send: ${sideText(proposal.side_a)}`,
      `You receive: ${sideText(proposal.side_b)}`,
      `Verdict: ${proposal.verdict}`,
      `Dynasty delta: ${proposal.dynasty_delta}`,
      `Redraft delta: ${proposal.redraft_delta}`,
      proposal.justification,
    ].join('\n');
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  }

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 22, margin: '0 auto', maxWidth: 1040 }}>
        <h1 style={{ margin: 0 }}>Proposals</h1>
        <LeagueSelector onSelect={setLeagueId} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <label style={{ display: 'grid', fontWeight: 700, gap: 6 }}>
            Value mode
            <select value={valueMode} onChange={(event) => setValueMode(event.target.value)} style={{ padding: 10 }}>
              <option value="dynasty">Dynasty</option>
              <option value="redraft">Redraft</option>
            </select>
          </label>
          <label style={{ display: 'grid', fontWeight: 700, gap: 6 }}>
            Strategy
            <select value={strategy} onChange={(event) => setStrategy(event.target.value)} style={{ padding: 10 }}>
              <option value="balanced">Balanced</option>
              <option value="win_now">Win now</option>
              <option value="rebuild">Rebuild</option>
            </select>
          </label>
        </div>
        <button
          disabled={loading || !leagueId}
          onClick={generateProposals}
          style={{ border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 800, padding: 12, width: 220 }}
        >
          Generate Proposals
        </button>

        {error && <p style={{ color: '#b42318' }}>{error}</p>}
        {degradedReasons.length > 0 && (
          <p style={{ color: '#b54708' }}>Data trust warning: {degradedReasons.join('; ')}</p>
        )}
        {loading && <p>Loading...</p>}

        <div style={{ display: 'grid', gap: 14 }}>
          {proposals.map((proposal) => {
            const sideAValue = Number(proposal.side_a_value || 0);
            const sideBValue = Number(proposal.side_b_value || 0);
            const maxValue = Math.max(sideAValue, sideBValue, 1);

            return (
              <article
                key={`${proposal.rank}-${proposal.their_roster_id}`}
                style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 18 }}
              >
                <div style={{ alignItems: 'center', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                  <strong>#{proposal.rank} vs {proposal.their_owner || `Roster ${proposal.their_roster_id}`}</strong>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <ConfidenceBadge confidence={proposal.data_confidence} />
                    <VerdictChip verdict={proposal.verdict} />
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  <SideDetail title="You send" side={proposal.side_a} />
                  <SideDetail title="You receive" side={proposal.side_b} />
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ background: '#fee2e2', borderRadius: 999, height: 10, width: `${(sideAValue / maxValue) * 100}%` }} />
                  <div style={{ background: '#dcfce7', borderRadius: 999, height: 10, width: `${(sideBValue / maxValue) * 100}%` }} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <small>Dynasty delta: {proposal.dynasty_delta > 0 ? '+' : ''}{proposal.dynasty_delta}</small>
                  <small>Redraft delta: {proposal.redraft_delta > 0 ? '+' : ''}{proposal.redraft_delta}</small>
                  <small>Win-now gain: {proposal.win_now_gain > 0 ? '+' : ''}{proposal.win_now_gain}</small>
                  <small>Long-term cost: {proposal.long_term_cost}</small>
                </div>
                <p>{proposal.justification}</p>
                <button onClick={() => copyProposal(proposal)} style={{ borderRadius: 8, cursor: 'pointer', padding: 9 }}>
                  Copy to clipboard
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
