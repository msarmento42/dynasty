import { useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
import VerdictChip from '../components/VerdictChip.jsx';

function sideText(side) {
  const players = side?.player_names || side?.players || side?.player_ids || [];
  const picks = side?.picks || [];
  const playerText = players.length > 0
    ? players.map((player) => (typeof player === 'string' ? player : player.name || player.sleeper_id)).join(', ')
    : 'No players';
  const pickText = picks.length > 0 ? ` + ${picks.length} pick(s)` : '';
  return `${playerText}${pickText}`;
}

export default function Proposals() {
  const [leagueId, setLeagueId] = useState('');
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generateProposals() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/fantasy/proposals/${leagueId}`);
      if (!response.ok) {
        throw new Error('Unable to load proposals');
      }
      setProposals(await response.json());
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
      `You send: ${sideText(proposal.side_a)}`,
      `You receive: ${sideText(proposal.side_b)}`,
      `Verdict: ${proposal.verdict}`,
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
        <button
          disabled={loading || !leagueId}
          onClick={generateProposals}
          style={{ border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 800, padding: 12, width: 220 }}
        >
          Generate Proposals
        </button>

        {error && <p style={{ color: '#b42318' }}>{error}</p>}
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
                  <VerdictChip verdict={proposal.verdict} />
                </div>
                <p><strong>You send:</strong> {sideText(proposal.side_a)}</p>
                <p><strong>You receive:</strong> {sideText(proposal.side_b)}</p>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ background: '#fee2e2', borderRadius: 999, height: 10, width: `${(sideAValue / maxValue) * 100}%` }} />
                  <div style={{ background: '#dcfce7', borderRadius: 999, height: 10, width: `${(sideBValue / maxValue) * 100}%` }} />
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
