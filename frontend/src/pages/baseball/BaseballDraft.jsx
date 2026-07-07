import { useEffect, useState } from 'react';
import BaseballAuctionValueCalculator from '../../components/BaseballAuctionValueCalculator'; // Import the new component

const API = import.meta.env.VITE_API_URL || '';

export default function BaseballDraft() {
  const [sessionId, setSessionId] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [numTeams, setNumTeams] = useState(12);
  const [numRounds, setNumRounds] = useState(25);
  const [userSlot, setUserSlot] = useState(1);
  const [faabBudget, setFaabBudget] = useState(100);
  const [faabMode, setFaabMode] = useState(false);

  const [currentView, setCurrentView] = useState('draft'); // New state for view selection

  const startDraft = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/dynasty/draft/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: 'baseball',
          num_teams: numTeams,
          num_rounds: numRounds,
          user_pick_slot: userSlot,
          mode: 'snake',
          faab_budget: faabMode ? faabBudget : null,
        }),
      });
      if (!res.ok) throw new Error('Failed to start draft');
      const data = await res.json();
      setSessionId(data.session_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadState = async (id) => {
    const res = await fetch(`${API}/api/dynasty/draft/${id}/state`);
    if (!res.ok) return;
    setState(await res.json());
  };

  useEffect(() => {
    if (sessionId) loadState(sessionId);
  }, [sessionId]);

  const makePick = async (player) => {
    if (!state) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/dynasty/draft/${sessionId}/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_slot: state.on_the_clock_team,
          player_id: String(player.id),
          player_name: player.name,
          position: player.position,
          faab_spent: faabMode ? Math.max(1, Math.round((player.adjusted_value || 0) / 50)) : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Pick failed');
      }
      await loadState(sessionId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '20px auto' }}>
      <div style={{ marginBottom: '20px', textAlign: 'center' }}>
        <button
          onClick={() => setCurrentView('draft')}
          style={{
            marginRight: '10px',
            padding: '10px 20px',
            cursor: 'pointer',
            backgroundColor: currentView === 'draft' ? 'var(--primary-color, #007bff)' : '#f0f0f0',
            color: currentView === 'draft' ? 'white' : 'black',
            border: '1px solid #ccc',
            borderRadius: '5px',
          }}
        >
          Draft Board
        </button>
        <button
          onClick={() => setCurrentView('calculator')}
          style={{
            padding: '10px 20px',
            cursor: 'pointer',
            backgroundColor: currentView === 'calculator' ? 'var(--primary-color, #007bff)' : '#f0f0f0',
            color: currentView === 'calculator' ? 'white' : 'black',
            border: '1px solid #ccc',
            borderRadius: '5px',
          }}
        >
          Auction Calculator
        </button>
      </div>

      {currentView === 'draft' && (
        <>
          {!sessionId ? (
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
              <h2>⚾ Baseball Startup Draft Board</h2>
              <p style={{ color: 'var(--text-secondary, #666)', fontSize: '0.9rem' }}>
                Value-based pick recommendations, position filters, and optional FAAB budget tracking for
                startup/expansion baseball drafts.
              </p>
              <label>
                Number of teams
                <input type="number" min={4} max={20} value={numTeams} onChange={(e) => setNumTeams(Number(e.target.value))} />
              </label>
              <br />
              <label>
                Number of rounds
                <input type="number" min={5} max={40} value={numRounds} onChange={(e) => setNumRounds(Number(e.target.value))} />
              </label>
              <br />
              <label>
                Your draft slot
                <input type="number" min={1} max={numTeams} value={userSlot} onChange={(e) => setUserSlot(Number(e.target.value))} />
              </label>
              <br />
              <label>
                <input type="checkbox" checked={faabMode} onChange={(e) => setFaabMode(e.target.checked)} /> Track FAAB budget
              </label>
              {faabMode && (
                <>
                  <br />
                  <label>
                    FAAB budget
                    <input type="number" min={0} value={faabBudget} onChange={(e) => setFaabBudget(Number(e.target.value))} />
                  </label>
                </>
              )}
              <br />
              <button onClick={startDraft} disabled={loading}>
                {loading ? 'Starting...' : 'Start Draft'}
              </button>
              {error && <p style={{ color: 'red' }}>{error}</p>}
            </div>
          ) : (
            state ? ( // Check if state is loaded before rendering draft board
              <>
                <h2>⚾ Baseball Draft — Session #{sessionId}</h2>
                {error && <p style={{ color: 'red' }}>{error}</p>}
                {state.is_complete ? (
                  <p>Draft complete — {state.picks.length} picks made.</p>
                ) : (
                  <p>
                    On the clock: <strong>Team {state.on_the_clock_team}</strong>
                    {state.is_user_turn && <span style={{ color: 'green' }}> — your pick!</span>}
                    {state.faab_remaining != null && <span> · FAAB remaining: ${state.faab_remaining}</span>}
                  </p>
                )}

                <h3>Positional needs (yours)</h3>
                <p style={{ fontSize: '0.85rem' }}>
                  {Object.entries(state.user_needs || {})
                    .filter(([, n]) => n > 0)
                    .map(([pos, n]) => `${pos} (${n})`)
                    .join(', ') || 'All starter slots filled'}
                </p>

                <h3>Recommended picks</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Player</th>
                      <th>Pos</th>
                      <th>Value</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(state.recommendations || []).map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td style={{ textAlign: 'center' }}>{p.position}</td>
                        <td style={{ textAlign: 'center' }}>{p.adjusted_value}</td>
                        <td>
                          {state.is_user_turn && !state.is_complete && (
                            <button onClick={() => makePick(p)} disabled={loading}>
                              Draft
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3>Draft board so far</h3>
                <ol style={{ fontSize: '0.85rem', columns: 2 }}>
                  {(state.picks || []).map((p) => (
                    <li key={p.overall_pick}>
                      Team {p.team_slot}: {p.player_name} ({p.position})
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p>Loading draft...</p>
            )
          )}
        </>
      )}

      {currentView === 'calculator' && <BaseballAuctionValueCalculator />}
    </div>
  );
}
