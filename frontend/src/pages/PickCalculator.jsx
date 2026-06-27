import { useCallback, useEffect, useRef, useState } from 'react';

const POSITION_COLORS = {
  QB: '#dc2626',
  RB: '#16a34a',
  WR: '#2563eb',
  TE: '#ca8a04',
};

function posColor(pos) {
  return POSITION_COLORS[pos] || '#667085';
}

function WinnerBadge({ winner, side }) {
  const isWinner = winner === side;
  const isEven = winner === 'even';
  if (isEven) {
    return (
      <span style={{ background: '#f1f5f9', borderRadius: 999, color: '#475467', fontSize: 12, fontWeight: 700, padding: '3px 10px' }}>
        EVEN
      </span>
    );
  }
  if (isWinner) {
    return (
      <span style={{ background: '#dcfce7', borderRadius: 999, color: '#15803d', fontSize: 12, fontWeight: 700, padding: '3px 10px' }}>
        WINNER
      </span>
    );
  }
  return null;
}

function ItemRow({ item, onRemove }) {
  const isPlayer = Boolean(item.player_id);
  const label = isPlayer
    ? (item.name + (item.position ? (' (' + item.position + (item.team ? (', ' + item.team) : '') + ')') : ''))
    : (item.label || (item.year + ' ' + item.round));
  const pos = item.position;

  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {isPlayer && pos && (
          <span style={{ background: posColor(pos) + '22', borderRadius: 4, color: posColor(pos), fontSize: 11, fontWeight: 700, padding: '1px 6px', whiteSpace: 'nowrap' }}>
            {pos}
          </span>
        )}
        {!isPlayer && (
          <span style={{ background: '#eef2ff', borderRadius: 4, color: '#4f46e5', fontSize: 11, fontWeight: 700, padding: '1px 6px', whiteSpace: 'nowrap' }}>
            PICK
          </span>
        )}
        <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, flexShrink: 0 }}>
        <span style={{ color: '#475467', fontSize: 13, fontWeight: 600 }}>{Number(item.value).toLocaleString()}</span>
        <button
          onClick={() => onRemove(item._key)}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px' }}
          title="Remove"
        >
          x
        </button>
      </div>
    </div>
  );
}

function PlayerSearch({ onAdd, label }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleInput(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (val.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch('/api/picks/players/search?q=' + encodeURIComponent(val) + '&limit=10');
        if (res.ok) {
          const data = await res.json();
          setResults(data.players || []);
          setOpen(true);
        }
      } catch (err) {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  }

  function selectPlayer(player) {
    onAdd({
      _key: 'player_' + player.sleeper_id + '_' + Date.now(),
      player_id: player.sleeper_id,
      name: player.name,
      position: player.position,
      team: player.team,
      value: player.value,
    });
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={handleInput}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={'Search player for ' + label + '...'}
          style={{ border: '1px solid #d1d5db', borderRadius: 6, flex: 1, fontSize: 13, padding: '7px 10px' }}
        />
        {searching && <span style={{ alignSelf: 'center', color: '#94a3b8', fontSize: 12 }}>...</span>}
      </div>
      {open && results.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', left: 0, maxHeight: 240, overflowY: 'auto', position: 'absolute', right: 0, top: '100%', zIndex: 50 }}>
          {results.map((player) => (
            <button
              key={player.sleeper_id}
              onClick={() => selectPlayer(player)}
              style={{ alignItems: 'center', background: 'none', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', display: 'flex', gap: 8, justifyContent: 'space-between', padding: '9px 12px', textAlign: 'left', width: '100%' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {player.position && (
                  <span style={{ background: posColor(player.position) + '22', borderRadius: 4, color: posColor(player.position), fontSize: 11, fontWeight: 700, padding: '1px 5px' }}>
                    {player.position}
                  </span>
                )}
                <span style={{ fontSize: 14 }}>{player.name}</span>
                {player.team && <span style={{ color: '#94a3b8', fontSize: 12 }}>{player.team}</span>}
              </div>
              <span style={{ color: '#475467', fontSize: 13, fontWeight: 600 }}>{Number(player.value).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PICK_LABELS_MAP = {
  '1.01': '1st Round (1.01)', '1.02': '1st Round (1.02)', '1.03': '1st Round (1.03)',
  '1.04': '1st Round (1.04)', '1.05': '1st Round (1.05)', '1.06': '1st Round (1.06)',
  '1.07': '1st Round (1.07)', '1.08': '1st Round (1.08)', '1.09': '1st Round (1.09)',
  '1.10': '1st Round (1.10)', '1.11': '1st Round (1.11)', '1.12': '1st Round (1.12)',
  '2nd': '2nd Round', '3rd': '3rd Round', '4th': '4th Round',
  '1st_early': '1st Round (Early)', '1st_mid': '1st Round (Mid)', '1st_late': '1st Round (Late)',
};

function PickAdder({ pickValues, onAdd, label }) {
  const [year, setYear] = useState('2026');
  const [round, setRound] = useState('');

  const years = Object.keys(pickValues || {}).sort();
  const rounds = year && pickValues && pickValues[year] ? Object.keys(pickValues[year]) : [];

  useEffect(() => {
    if (rounds.length > 0 && !rounds.includes(round)) {
      setRound(rounds[0]);
    }
  }, [year]);

  function handleAdd() {
    if (!year || !round) return;
    const value = (pickValues && pickValues[year] && pickValues[year][round]) || 0;
    onAdd({
      _key: 'pick_' + year + '_' + round + '_' + Date.now(),
      year,
      round,
      label: year + ' ' + (PICK_LABELS_MAP[round] || round),
      value,
    });
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <select
        value={year}
        onChange={(e) => setYear(e.target.value)}
        style={{ border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, padding: '7px 8px' }}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <select
        value={round}
        onChange={(e) => setRound(e.target.value)}
        style={{ border: '1px solid #d1d5db', borderRadius: 6, flex: 1, fontSize: 13, padding: '7px 8px' }}
      >
        {rounds.map((r) => {
          const value = (pickValues && pickValues[year] && pickValues[year][r]) || 0;
          const shortLabel = r.startsWith('1.') ? r : (PICK_LABELS_MAP[r] || r);
          return <option key={r} value={r}>{shortLabel} -- {Number(value).toLocaleString()}</option>;
        })}
      </select>
      <button
        onClick={handleAdd}
        disabled={!round}
        style={{ background: '#4f46e5', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '7px 14px' }}
      >
        Add Pick
      </button>
    </div>
  );
}

function TradePanel({ label, items, onAddItem, onRemoveItem, pickValues, total, winner, sideKey }) {
  const isWinnerSide = winner === sideKey;
  const isEven = winner === 'even';

  return (
    <div style={{
      background: '#ffffff',
      border: '2px solid ' + (isWinnerSide ? '#16a34a' : '#d9dee7'),
      borderRadius: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      overflow: 'hidden',
    }}>
      <div style={{ alignItems: 'center', background: isWinnerSide ? '#f0fdf4' : '#f8fafc', borderBottom: '1px solid #e4e7ec', display: 'flex', gap: 10, justifyContent: 'space-between', padding: '14px 16px' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{label}</h2>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          {winner && <WinnerBadge winner={winner} side={sideKey} />}
          <span style={{ color: '#1d4ed8', fontSize: 18, fontWeight: 800 }}>{Number(total).toLocaleString()}</span>
        </div>
      </div>

      <div style={{ borderBottom: '1px solid #f1f5f9', padding: '12px 16px' }}>
        <p style={{ color: '#667085', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', margin: '0 0 8px', textTransform: 'uppercase' }}>Add Pick</p>
        <PickAdder pickValues={pickValues} onAdd={onAddItem} label={label} />
      </div>

      <div style={{ borderBottom: '1px solid #f1f5f9', padding: '12px 16px' }}>
        <p style={{ color: '#667085', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', margin: '0 0 8px', textTransform: 'uppercase' }}>Add Player</p>
        <PlayerSearch onAdd={onAddItem} label={label} />
      </div>

      <div style={{ flex: 1, padding: '12px 16px' }}>
        {items.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>No picks or players added yet</p>
        ) : (
          <div>
            {items.map((item) => (
              <ItemRow key={item._key} item={item} onRemove={onRemoveItem} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PickCalculator() {
  const [pickValues, setPickValues] = useState(null);
  const [sideA, setSideA] = useState([]);
  const [sideB, setSideB] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [valuesLoading, setValuesLoading] = useState(true);

  useEffect(() => {
    async function loadValues() {
      try {
        const res = await fetch('/api/picks/values');
        if (res.ok) {
          const data = await res.json();
          setPickValues(data.pick_values);
        }
      } catch (err) {
        setError('Failed to load pick values');
      } finally {
        setValuesLoading(false);
      }
    }
    loadValues();
  }, []);

  useEffect(() => {
    if (sideA.length === 0 && sideB.length === 0) {
      setResult(null);
      return;
    }
    const timer = setTimeout(() => compare(sideA, sideB), 300);
    return () => clearTimeout(timer);
  }, [sideA, sideB]);

  async function compare(a, b) {
    setLoading(true);
    setError('');
    try {
      const body = {
        side_a: {
          picks: a.filter((i) => !i.player_id).map((i) => ({ year: i.year, round: i.round })),
          player_ids: a.filter((i) => i.player_id).map((i) => i.player_id),
        },
        side_b: {
          picks: b.filter((i) => !i.player_id).map((i) => ({ year: i.year, round: i.round })),
          player_ids: b.filter((i) => i.player_id).map((i) => i.player_id),
        },
      };
      const res = await fetch('/api/picks/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Comparison failed');
      setResult(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function addToSide(setSide) {
    return (item) => setSide((prev) => [...prev, item]);
  }

  function removeFromSide(setSide) {
    return (key) => setSide((prev) => prev.filter((i) => i._key !== key));
  }

  const sideATotal = result ? result.side_a_total : sideA.reduce((s, i) => s + (i.value || 0), 0);
  const sideBTotal = result ? result.side_b_total : sideB.reduce((s, i) => s + (i.value || 0), 0);
  const winner = result ? result.winner : null;
  const delta = result ? result.delta : (sideATotal - sideBTotal);
  const deltaPct = result ? result.delta_pct : 0;

  if (valuesLoading) {
    return (
      <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
        <section style={{ margin: '0 auto', maxWidth: 1100 }}>
          <h1 style={{ margin: 0 }}>Pick Value Calculator</h1>
          <p style={{ color: '#667085' }}>Loading pick values...</p>
        </section>
      </main>
    );
  }

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1100 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 6px' }}>Pick Value Calculator</h1>
          <p style={{ color: '#667085', margin: 0 }}>
            Compare dynasty trade sides with draft picks and players. Values are KTC-equivalent.
          </p>
        </div>

        {error && <p style={{ color: '#b42318', marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', marginBottom: 20 }}>
          <TradePanel
            label="Side A"
            sideKey="side_a"
            items={sideA}
            onAddItem={addToSide(setSideA)}
            onRemoveItem={removeFromSide(setSideA)}
            pickValues={pickValues}
            total={sideATotal}
            winner={winner}
          />
          <TradePanel
            label="Side B"
            sideKey="side_b"
            items={sideB}
            onAddItem={addToSide(setSideB)}
            onRemoveItem={removeFromSide(setSideB)}
            pickValues={pickValues}
            total={sideBTotal}
            winner={winner}
          />
        </div>

        {(sideA.length > 0 || sideB.length > 0) && (
          <div style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#667085', fontSize: 12, fontWeight: 600, marginBottom: 2, textTransform: 'uppercase' }}>Side A Total</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1d4ed8' }}>{Number(sideATotal).toLocaleString()}</div>
                </div>
                <div style={{ alignSelf: 'center', color: '#94a3b8', fontSize: 20, fontWeight: 300 }}>vs</div>
                <div>
                  <div style={{ color: '#667085', fontSize: 12, fontWeight: 600, marginBottom: 2, textTransform: 'uppercase' }}>Side B Total</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1d4ed8' }}>{Number(sideBTotal).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: '#667085', fontSize: 12, fontWeight: 600, marginBottom: 2, textTransform: 'uppercase' }}>Delta</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: delta >= 0 ? '#15803d' : '#b42318' }}>
                    {delta >= 0 ? '+' : ''}{Number(delta).toLocaleString()}
                    <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4 }}>({deltaPct}%)</span>
                  </div>
                </div>
              </div>

              <div>
                {winner === 'even' && (
                  <span style={{ background: '#f1f5f9', borderRadius: 8, color: '#475467', fontSize: 15, fontWeight: 700, padding: '8px 18px' }}>
                    Even Trade
                  </span>
                )}
                {winner === 'side_a' && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ background: '#dcfce7', borderRadius: 8, color: '#15803d', fontSize: 15, fontWeight: 700, padding: '8px 18px' }}>
                      Side A Wins
                    </div>
                    <div style={{ color: '#667085', fontSize: 12, marginTop: 4 }}>
                      Side A gets {Number(Math.abs(delta)).toLocaleString()} more value
                    </div>
                  </div>
                )}
                {winner === 'side_b' && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ background: '#dcfce7', borderRadius: 8, color: '#15803d', fontSize: 15, fontWeight: 700, padding: '8px 18px' }}>
                      Side B Wins
                    </div>
                    <div style={{ color: '#667085', fontSize: 12, marginTop: 4 }}>
                      Side B gets {Number(Math.abs(delta)).toLocaleString()} more value
                    </div>
                  </div>
                )}
                {loading && <span style={{ color: '#94a3b8', fontSize: 13 }}>Calculating...</span>}
              </div>
            </div>
          </div>
        )}

        {pickValues && (
          <details style={{ marginTop: 24 }}>
            <summary style={{ color: '#475467', cursor: 'pointer', fontSize: 14, fontWeight: 600, userSelect: 'none' }}>
              Pick Value Reference Table
            </summary>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginTop: 12 }}>
              {Object.entries(pickValues).map(([year, rounds]) => (
                <div key={year} style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e4e7ec', fontWeight: 700, padding: '8px 12px' }}>{year}</div>
                  {Object.entries(rounds).map(([round, value]) => (
                    <div key={round} style={{ borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', padding: '6px 12px' }}>
                      <span style={{ color: '#475467', fontSize: 13 }}>{round}</span>
                      <span style={{ color: '#1d4ed8', fontSize: 13, fontWeight: 600 }}>{Number(value).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
    </main>
  );
}
