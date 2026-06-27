import { useState, useMemo, useCallback } from 'react';

const POS_COLORS = {
  QB: { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' },
  RB: { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
  WR: { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
  TE: { bg: '#ede9fe', text: '#5b21b6', border: '#ddd6fe' },
  K: { bg: '#f3f4f6', text: '#374151', border: '#e5e7eb' },
};

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

function PosBadge({ pos }) {
  const c = POS_COLORS[pos] || { bg: '#f3f4f6', text: '#374151' };
  return (
    <span
      style={{
        background: c.bg,
        borderRadius: 4,
        color: c.text,
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 6px',
        minWidth: 26,
        textAlign: 'center',
      }}
    >
      {pos}
    </span>
  );
}

function ValueGrade({ value }) {
  const v = Number(value) || 0;
  if (v >= 8000) return <span style={{ color: '#15803d', fontWeight: 700 }}>A+</span>;
  if (v >= 6000) return <span style={{ color: '#16a34a', fontWeight: 700 }}>A</span>;
  if (v >= 4000) return <span style={{ color: '#65a30d', fontWeight: 700 }}>B+</span>;
  if (v >= 2500) return <span style={{ color: '#ca8a04', fontWeight: 700 }}>B</span>;
  if (v >= 1200) return <span style={{ color: '#ea580c', fontWeight: 700 }}>C</span>;
  return <span style={{ color: '#dc2626', fontWeight: 700 }}>D</span>;
}

// ── Setup Screen ─────────────────────────────────────────────────────────────

function SetupScreen({ onStart }) {
  const [format, setFormat] = useState('SF');
  const [teams, setTeams] = useState(12);
  const [rounds, setRounds] = useState(20);
  const [pickPos, setPickPos] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/fantasy/draft/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          teams: Number(teams),
          rounds: Number(rounds),
          pick_position: Number(pickPos),
        }),
      });
      if (!res.ok) throw new Error('Failed to start draft');
      const state = await res.json();
      onStart(state);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const label = (t) => (
    <label style={{ color: '#475569', display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {t}
    </label>
  );

  const sel = (value, onChange, opts) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        color: '#1e293b',
        fontSize: 15,
        padding: '10px 14px',
        width: '100%',
        cursor: 'pointer',
      }}
    >
      {opts.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 520 }}>
        <h1 style={{ margin: '0 0 6px' }}>Mock Draft Simulator</h1>
        <p style={{ color: '#64748b', margin: '0 0 28px', fontSize: 14 }}>
          Simulate a dynasty startup draft. AI drafts for all other teams.
        </p>

        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            display: 'grid',
            gap: 20,
            padding: '28px 28px 24px',
          }}
        >
          <div>
            {label('Format')}
            {sel(format, setFormat, [['SF', 'Superflex (SF)'], ['1QB', '1QB']])}
          </div>
          <div>
            {label('Teams')}
            {sel(teams, setTeams, [['10', '10 Teams'], ['12', '12 Teams'], ['14', '14 Teams']])}
          </div>
          <div>
            {label('Rounds')}
            {sel(rounds, setRounds, [['20', '20 Rounds'], ['22', '22 Rounds'], ['24', '24 Rounds']])}
          </div>

          <div>
            {label(`Pick Position — Pick ${pickPos}.01`)}
            <input
              type="range"
              min={1}
              max={Number(teams)}
              value={pickPos}
              onChange={(e) => setPickPos(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>1.01 (first)</span>
              <span
                style={{
                  background: '#ede9fe',
                  borderRadius: 6,
                  color: '#5b21b6',
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '2px 10px',
                }}
              >
                Pick {pickPos}.01
              </span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                1.{String(teams).padStart(2, '0')} (last)
              </span>
            </div>
          </div>

          {error && (
            <p style={{ color: '#dc2626', margin: 0, fontSize: 13 }}>{error}</p>
          )}

          <button
            onClick={handleStart}
            disabled={loading}
            style={{
              background: loading ? '#a5b4fc' : '#6366f1',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 15,
              fontWeight: 700,
              padding: '13px 0',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Setting up draft...' : 'Start Draft'}
          </button>
        </div>
      </section>
    </main>
  );
}

// ── Draft Board ───────────────────────────────────────────────────────────────

function DraftBoard({ initialState }) {
  const [state, setState] = useState(initialState);
  const [posFilter, setPosFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const draftId = state.draft_id;

  const filteredAvailable = useMemo(() => {
    let list = state.available_players || [];
    if (posFilter !== 'ALL') list = list.filter((p) => p.position === posFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name?.toLowerCase().includes(q) || p.team?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [state.available_players, posFilter, search]);

  const makeRequest = useCallback(async (url, method = 'POST', body = null) => {
    setLoading(true);
    setError('');
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Request failed');
      }
      const newState = await res.json();
      setState(newState);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const pickPlayer = (playerId) => {
    if (!state.is_marcus_turn || loading) return;
    makeRequest(`/fantasy/draft/${draftId}/pick`, 'POST', { player_id: playerId });
  };

  const autoPick = () => {
    if (!state.is_marcus_turn || loading) return;
    makeRequest(`/fantasy/draft/${draftId}/auto-pick`, 'POST');
  };

  // Group Marcus's roster by position
  const marcusGrouped = useMemo(() => {
    const groups = {};
    for (const p of state.marcus_roster || []) {
      const pos = p.position || 'Other';
      if (!groups[pos]) groups[pos] = [];
      groups[pos].push(p);
    }
    return groups;
  }, [state.marcus_roster]);

  const pickPct = state.total_picks > 0
    ? Math.round((state.current_pick_idx / state.total_picks) * 100)
    : 0;

  if (state.completed) {
    return <CompletedSummary state={state} />;
  }

  const cur = state.current_pick;

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: '16px 24px' }}>
      <section style={{ margin: '0 auto', maxWidth: 1200 }}>
        {/* Header bar */}
        <div
          style={{
            alignItems: 'center',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'space-between',
            marginBottom: 16,
            padding: '12px 18px',
          }}
        >
          <div>
            <span style={{ fontWeight: 700, fontSize: 17 }}>
              {state.format} Mock Draft
            </span>
            <span style={{ color: '#94a3b8', fontSize: 13, marginLeft: 10 }}>
              {state.teams} teams · {state.rounds} rounds · Pick {state.pick_position}.01
            </span>
          </div>

          {/* Progress */}
          <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
            <div
              style={{
                background: '#f1f5f9',
                borderRadius: 99,
                height: 8,
                overflow: 'hidden',
                width: 140,
              }}
            >
              <div
                style={{
                  background: '#6366f1',
                  borderRadius: 99,
                  height: '100%',
                  transition: 'width 0.3s',
                  width: `${pickPct}%`,
                }}
              />
            </div>
            <span style={{ color: '#64748b', fontSize: 13 }}>
              {state.current_pick_idx}/{state.total_picks}
            </span>
          </div>

          {/* On the clock */}
          <div
            style={{
              alignItems: 'center',
              background: state.is_marcus_turn ? '#ede9fe' : '#f8fafc',
              border: `1px solid ${state.is_marcus_turn ? '#c4b5fd' : '#e2e8f0'}`,
              borderRadius: 8,
              display: 'flex',
              gap: 8,
              padding: '8px 14px',
            }}
          >
            {state.is_marcus_turn ? (
              <>
                <span style={{ fontSize: 18 }}>YOUR PICK</span>
                <span
                  style={{
                    background: '#6366f1',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '2px 8px',
                  }}
                >
                  {cur ? `${cur.round}.${String(cur.pick_in_round).padStart(2, '0')}` : ''}
                </span>
              </>
            ) : (
              <span style={{ color: '#64748b', fontSize: 13 }}>
                {cur
                  ? `Rd ${cur.round} · Pick ${cur.pick_in_round} · Team ${cur.team}`
                  : 'Calculating...'}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: '#fee2e2', borderRadius: 8, color: '#991b1b', fontSize: 13, marginBottom: 12, padding: '10px 14px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 280px' }}>
          {/* Left: available players */}
          <div>
            {/* Filter bar */}
            <div
              style={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  display: 'flex',
                  gap: 2,
                  padding: 3,
                }}
              >
                {POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setPosFilter(pos)}
                    style={{
                      background: posFilter === pos ? '#6366f1' : 'transparent',
                      border: 'none',
                      borderRadius: 5,
                      color: posFilter === pos ? '#fff' : '#475569',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '4px 11px',
                      transition: 'all 0.12s',
                    }}
                  >
                    {pos}
                  </button>
                ))}
              </div>
              <input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  background: '#fff',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 13,
                  outline: 'none',
                  padding: '6px 10px',
                  width: 180,
                }}
              />
              {state.is_marcus_turn && (
                <button
                  onClick={autoPick}
                  disabled={loading}
                  style={{
                    background: '#f59e0b',
                    border: 'none',
                    borderRadius: 6,
                    color: '#fff',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    marginLeft: 'auto',
                    padding: '6px 14px',
                  }}
                >
                  Auto Pick
                </button>
              )}
            </div>

            {/* Player table */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              {/* Column headers */}
              <div
                style={{
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  color: '#64748b',
                  display: 'grid',
                  fontSize: 11,
                  fontWeight: 700,
                  gridTemplateColumns: '28px 1fr 56px 50px 100px 64px',
                  gap: 8,
                  letterSpacing: 0.4,
                  padding: '9px 14px',
                  textTransform: 'uppercase',
                }}
              >
                <div>#</div>
                <div>Player</div>
                <div>Pos</div>
                <div>Team</div>
                <div style={{ textAlign: 'right' }}>Value</div>
                <div style={{ textAlign: 'center' }}>Grade</div>
              </div>

              <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                {filteredAvailable.length === 0 && (
                  <div style={{ color: '#94a3b8', fontSize: 13, padding: '24px', textAlign: 'center' }}>
                    No players match filter
                  </div>
                )}
                {filteredAvailable.map((player, i) => (
                  <div
                    key={player.sleeper_id}
                    onClick={() => state.is_marcus_turn && !loading && pickPlayer(player.sleeper_id)}
                    style={{
                      alignItems: 'center',
                      borderBottom: '1px solid #f1f5f9',
                      cursor: state.is_marcus_turn && !loading ? 'pointer' : 'default',
                      display: 'grid',
                      fontSize: 13,
                      gap: 8,
                      gridTemplateColumns: '28px 1fr 56px 50px 100px 64px',
                      opacity: loading ? 0.6 : 1,
                      padding: '9px 14px',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (state.is_marcus_turn) e.currentTarget.style.background = '#f0f4ff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{i + 1}</div>
                    <div style={{ fontWeight: 600 }}>{player.name}</div>
                    <div><PosBadge pos={player.position} /></div>
                    <div style={{ color: '#64748b' }}>{player.team}</div>
                    <div style={{ color: '#475569', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                      {Number(player.value).toLocaleString()}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <ValueGrade value={player.value} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Next picks strip */}
            {state.next_picks && state.next_picks.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }}>
                  Upcoming picks
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {state.next_picks.map((pk) => (
                    <div
                      key={pk.overall}
                      style={{
                        background: pk.is_marcus ? '#ede9fe' : '#fff',
                        border: `1px solid ${pk.is_marcus ? '#c4b5fd' : '#e2e8f0'}`,
                        borderRadius: 6,
                        color: pk.is_marcus ? '#5b21b6' : '#475569',
                        fontSize: 12,
                        fontWeight: pk.is_marcus ? 700 : 500,
                        padding: '4px 10px',
                      }}
                    >
                      {pk.is_marcus ? 'YOU' : `T${pk.team}`} · {pk.round}.{String(pk.pick_in_round).padStart(2, '0')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right panel: Marcus's roster */}
          <div>
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: '#6366f1',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>Your Roster</span>
                <span>{state.marcus_roster?.length || 0} players</span>
              </div>

              <div style={{ maxHeight: 520, overflowY: 'auto', padding: '8px 0' }}>
                {['QB', 'RB', 'WR', 'TE', 'K'].map((pos) => {
                  const players = marcusGrouped[pos];
                  if (!players?.length) return null;
                  return (
                    <div key={pos}>
                      <div
                        style={{
                          color: '#94a3b8',
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                          padding: '8px 14px 4px',
                          textTransform: 'uppercase',
                        }}
                      >
                        {pos} ({players.length})
                      </div>
                      {players.map((p) => (
                        <div
                          key={p.sleeper_id}
                          style={{
                            alignItems: 'center',
                            display: 'flex',
                            gap: 8,
                            padding: '6px 14px',
                          }}
                        >
                          <PosBadge pos={p.position} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name}
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: 11 }}>{p.team}</div>
                          </div>
                          <ValueGrade value={p.value} />
                        </div>
                      ))}
                    </div>
                  );
                })}

                {(!state.marcus_roster || state.marcus_roster.length === 0) && (
                  <div style={{ color: '#94a3b8', fontSize: 13, padding: '20px 14px', textAlign: 'center' }}>
                    No picks yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

// ── Completed Summary ─────────────────────────────────────────────────────────

function CompletedSummary({ state }) {
  const grouped = useMemo(() => {
    const groups = {};
    for (const p of state.marcus_roster || []) {
      const pos = p.position || 'Other';
      if (!groups[pos]) groups[pos] = [];
      groups[pos].push(p);
    }
    return groups;
  }, [state.marcus_roster]);

  const totalValue = (state.marcus_roster || []).reduce((s, p) => s + (p.value || 0), 0);
  const avgValue = state.marcus_roster?.length
    ? totalValue / state.marcus_roster.length
    : 0;

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 800 }}>
        <div
          style={{
            alignItems: 'center',
            background: '#6366f1',
            borderRadius: 12,
            color: '#fff',
            display: 'flex',
            gap: 16,
            justifyContent: 'space-between',
            marginBottom: 20,
            padding: '20px 24px',
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Draft Complete!</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>
              {state.format} · {state.teams} teams · {state.rounds} rounds · Pick {state.pick_position}.01
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 800 }}>
              {Number(totalValue).toLocaleString()}
            </div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>total dynasty value</div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {['QB', 'RB', 'WR', 'TE', 'K'].map((pos) => {
            const players = grouped[pos];
            if (!players?.length) return null;
            return (
              <div
                key={pos}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    background: POS_COLORS[pos]?.bg || '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    color: POS_COLORS[pos]?.text || '#374151',
                    display: 'flex',
                    fontSize: 13,
                    fontWeight: 700,
                    gap: 8,
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                  }}
                >
                  <span>{pos} ({players.length})</span>
                  <span>
                    Total: {players.reduce((s, p) => s + (p.value || 0), 0).toLocaleString()}
                  </span>
                </div>
                {players.map((p, i) => (
                  <div
                    key={p.sleeper_id}
                    style={{
                      alignItems: 'center',
                      borderBottom: i < players.length - 1 ? '1px solid #f1f5f9' : 'none',
                      display: 'grid',
                      fontSize: 13,
                      gap: 8,
                      gridTemplateColumns: '1fr 50px 100px 50px',
                      padding: '10px 16px',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ color: '#64748b' }}>{p.team}</div>
                    <div style={{ color: '#475569', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(p.value).toLocaleString()}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <ValueGrade value={p.value} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#6366f1',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 700,
              padding: '12px 32px',
            }}
          >
            Start New Draft
          </button>
        </div>
      </section>
    </main>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────

export default function MockDraft() {
  const [draftState, setDraftState] = useState(null);

  if (!draftState) {
    return <SetupScreen onStart={setDraftState} />;
  }

  return <DraftBoard initialState={draftState} />;
}
