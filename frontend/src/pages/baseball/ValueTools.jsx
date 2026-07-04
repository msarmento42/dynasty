import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LevelBadge, PosBadge } from './BaseballHome.jsx';

const API = import.meta.env.VITE_API_URL || '';

const sectionStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: 18,
};

function formatValue(value) {
  return value == null ? 'Missing' : Number(value).toLocaleString();
}

function PlayerOption({ player, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(player.mlb_id)}
      style={{
        alignItems: 'center',
        background: selected ? 'rgba(59,130,246,0.12)' : 'var(--bg-secondary)',
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border-color)',
        borderRadius: 7,
        color: 'var(--text-primary)',
        cursor: 'pointer',
        display: 'flex',
        gap: 8,
        padding: '8px 10px',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <PosBadge pos={player.position} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{player.name}</span>
      <span style={{ color: player.selected_value == null ? '#b42318' : 'var(--text-secondary)', fontSize: 12 }}>
        {formatValue(player.selected_value)}
      </span>
    </button>
  );
}

function AssetBadge({ player }) {
  return (
    <span
      style={{
        background: player.is_prospect ? '#fef3c7' : '#dcfce7',
        borderRadius: 999,
        color: player.is_prospect ? '#92400e' : '#166534',
        fontSize: 11,
        fontWeight: 800,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {player.is_prospect ? 'Prospect' : 'MLB contributor'}
    </span>
  );
}

function PlayerRow({ player }) {
  return (
    <div
      style={{
        alignItems: 'center',
        borderBottom: '1px solid var(--border-color)',
        display: 'grid',
        gap: 10,
        gridTemplateColumns: 'minmax(170px, 1fr) 88px 88px 86px 116px',
        padding: '10px 0',
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, minWidth: 0 }}>
        <PosBadge pos={player.position} />
        <div style={{ minWidth: 0 }}>
          <Link
            to={`/baseball/players/${player.mlb_id}`}
            style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 800, textDecoration: 'none' }}
          >
            {player.name}
          </Link>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {[player.team, player.age ? `Age ${player.age}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      <strong>{Number(player.dynasty_value || 0).toLocaleString()}</strong>
      <strong>{Number(player.redraft_value || 0).toLocaleString()}</strong>
      <span style={{ color: player.value_trend > 0 ? '#166534' : player.value_trend < 0 ? '#b42318' : 'var(--text-secondary)' }}>
        {player.value_trend > 0 ? '+' : ''}{player.value_trend || 0}
      </span>
      <AssetBadge player={player} />
    </div>
  );
}

export default function BaseballValueTools() {
  const [mode, setMode] = useState('dynasty');
  const [strategy, setStrategy] = useState('contend');
  const [board, setBoard] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [giveIds, setGiveIds] = useState([]);
  const [receiveIds, setReceiveIds] = useState([]);
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const players = board?.players || [];
  const missingPlayers = useMemo(
    () => players.filter((p) => p.selected_value == null),
    [players],
  );

  const loadBoard = async (nextMode = mode) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/baseball/value-board?mode=${nextMode}`);
      if (!res.ok) throw new Error('Failed to load baseball values');
      setBoard(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadProposals = async () => {
    try {
      const res = await fetch(`${API}/api/baseball/trade/proposals?mode=${mode}&strategy=${strategy}`);
      if (!res.ok) throw new Error('Failed to load proposals');
      const data = await res.json();
      setProposals(data.proposals || []);
    } catch {
      setProposals([]);
    }
  };

  useEffect(() => { loadBoard(mode); }, [mode]);
  useEffect(() => { loadProposals(); }, [mode, strategy]);

  const toggle = (setter) => (id) => {
    setter((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  };

  const analyze = async () => {
    const res = await fetch(`${API}/api/baseball/trade/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        give: { player_ids: giveIds },
        receive: { player_ids: receiveIds },
      }),
    });
    if (!res.ok) {
      setTrade({ summary: 'Trade analysis failed.', warnings: ['Check selected players and try again.'] });
      return;
    }
    setTrade(await res.json());
  };

  return (
    <main style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: 14, justifyContent: 'space-between', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 26, margin: 0 }}>Baseball Value Tools</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '5px 0 0' }}>
              Manual dynasty/redraft values, trade analyzer, and contender/rebuild proposal ideas.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['dynasty', 'redraft'].map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                style={{
                  background: mode === item ? 'var(--accent)' : 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 7,
                  color: mode === item ? '#fff' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 800,
                  padding: '8px 12px',
                  textTransform: 'capitalize',
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
          <section style={sectionStyle}>
            <h2 style={{ fontSize: 17, margin: '0 0 12px' }}>Roster Value Board</h2>
            {loading ? (
              <p style={{ color: 'var(--text-secondary)' }}>Loading values...</p>
            ) : players.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>No baseball roster players yet.</p>
            ) : (
              <>
                {missingPlayers.length > 0 && (
                  <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 7, color: '#9a3412', fontSize: 13, marginBottom: 12, padding: 10 }}>
                    {missingPlayers.length} player{missingPlayers.length === 1 ? '' : 's'} missing {mode} values. Missing values are not counted as zero.
                  </div>
                )}
                <div style={{ color: 'var(--text-secondary)', display: 'grid', fontSize: 11, fontWeight: 800, gap: 10, gridTemplateColumns: 'minmax(170px, 1fr) 88px 88px 86px 116px', textTransform: 'uppercase' }}>
                  <span>Player</span><span>Dynasty</span><span>Redraft</span><span>Trend</span><span>Type</span>
                </div>
                {players.map((player) => <PlayerRow key={player.mlb_id} player={player} />)}
              </>
            )}
          </section>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section style={sectionStyle}>
              <h2 style={{ fontSize: 17, margin: '0 0 12px' }}>Trade Analyzer</h2>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Give</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 190, overflowY: 'auto' }}>
                    {players.map((p) => (
                      <PlayerOption key={p.mlb_id} player={p} selected={giveIds.includes(p.mlb_id)} onToggle={toggle(setGiveIds)} />
                    ))}
                  </div>
                </div>
                <div>
                  <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Receive</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 190, overflowY: 'auto' }}>
                    {players.map((p) => (
                      <PlayerOption key={p.mlb_id} player={p} selected={receiveIds.includes(p.mlb_id)} onToggle={toggle(setReceiveIds)} />
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={analyze}
                style={{ background: 'var(--accent)', border: 0, borderRadius: 7, color: '#fff', cursor: 'pointer', fontWeight: 800, marginTop: 12, padding: '9px 12px', width: '100%' }}
              >
                Analyze Trade
              </button>
              {trade && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 7, marginTop: 12, padding: 12 }}>
                  <strong style={{ textTransform: 'capitalize' }}>{trade.verdict || 'Review'}</strong>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '5px 0' }}>{trade.summary}</p>
                  {typeof trade.net_value === 'number' && (
                    <p style={{ fontSize: 13, margin: 0 }}>Net value: <strong>{trade.net_value > 0 ? '+' : ''}{trade.net_value}</strong></p>
                  )}
                  {(trade.warnings || []).map((warning) => (
                    <p key={warning} style={{ color: '#9a3412', fontSize: 12, margin: '6px 0 0' }}>{warning}</p>
                  ))}
                </div>
              )}
            </section>

            <section style={sectionStyle}>
              <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h2 style={{ fontSize: 17, margin: 0 }}>Proposal Finder</h2>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 7, color: 'var(--text-primary)', padding: '7px 8px' }}
                >
                  <option value="contend">Contend</option>
                  <option value="rebuild">Rebuild</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {proposals.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>Add manual values to more players to generate proposals.</p>
                ) : proposals.map((proposal) => (
                  <div key={`${proposal.target.mlb_id}-${proposal.offer?.mlb_id || 'none'}`} style={{ background: 'var(--bg-secondary)', borderRadius: 7, padding: 10 }}>
                    <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                      <strong style={{ flex: 1 }}>{proposal.target.name}</strong>
                      <AssetBadge player={proposal.target} />
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '5px 0 0' }}>
                      Target value {formatValue(proposal.target.selected_value)}
                      {proposal.offer ? ` · Suggested offer: ${proposal.offer.name}` : ' · No matching roster offer'}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
