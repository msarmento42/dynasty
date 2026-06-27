import { useState, useCallback } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';

const POS_COLORS = {
  QB: { bg: '#fef3c7', text: '#92400e' },
  RB: { bg: '#dcfce7', text: '#166534' },
  WR: { bg: '#dbeafe', text: '#1e40af' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
  K:  { bg: '#f3f4f6', text: '#374151' },
  DEF:{ bg: '#fee2e2', text: '#991b1b' },
};

function PosBadge({ pos }) {
  const c = POS_COLORS[pos] || { bg: '#f3f4f6', text: '#374151' };
  return (
    <span style={{
      background: c.bg,
      borderRadius: 4,
      color: c.text,
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 6px',
    }}>
      {pos}
    </span>
  );
}

function ValueChip({ value }) {
  const v = Number(value) || 0;
  let color = '#dc2626';
  if (v >= 3000) color = '#16a34a';
  else if (v >= 1000) color = '#ca8a04';
  return (
    <span style={{ color, fontWeight: 700 }}>
      {v.toLocaleString()}
    </span>
  );
}

function InjuryBadge({ status }) {
  if (!status) return (
    <span style={{
      alignItems: 'center',
      background: '#dcfce7',
      borderRadius: 99,
      color: '#16a34a',
      display: 'inline-flex',
      fontSize: 11,
      fontWeight: 700,
      gap: 4,
      padding: '2px 8px',
    }}>
      <span style={{ background: '#22c55e', borderRadius: '50%', display: 'inline-block', height: 6, width: 6 }} />
      Healthy
    </span>
  );
  const s = status.toUpperCase();
  let bg = '#f3f4f6'; let color = '#374151';
  if (s === 'OUT') { bg = '#fee2e2'; color = '#dc2626'; }
  else if (s === 'DOUBTFUL') { bg = '#ffedd5'; color = '#ea580c'; }
  else if (s === 'QUESTIONABLE') { bg = '#fef9c3'; color = '#ca8a04'; }
  else if (s === 'PROBABLE') { bg = '#dcfce7'; color = '#16a34a'; }
  return (
    <span style={{ background: bg, borderRadius: 4, color, fontSize: 11, fontWeight: 700, padding: '2px 6px' }}>
      {s === 'QUESTIONABLE' ? 'Q' : status}
    </span>
  );
}

function DepthBadge({ depth }) {
  if (!depth) return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
  if (depth === 1) return (
    <span style={{ background: '#dbeafe', borderRadius: 4, color: '#1e40af', fontSize: 11, fontWeight: 700, padding: '2px 6px' }}>
      Starter
    </span>
  );
  if (depth === 2) return (
    <span style={{ background: '#f3f4f6', borderRadius: 4, color: '#374151', fontSize: 11, fontWeight: 700, padding: '2px 6px' }}>
      Backup
    </span>
  );
  return <span style={{ color: '#6b7280', fontSize: 12 }}>{depth}</span>;
}

export default function WaiverWire() {
  const [leagueId, setLeagueId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePos, setActivePos] = useState('ALL');
  const [targets, setTargets] = useState(new Set());

  const load = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/fantasy/waiver/${id}`);
      if (!res.ok) throw new Error('Unable to load waiver data');
      setData(await res.json());
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSelect(id) {
    setLeagueId(id);
    load(id);
  }

  function toggleTarget(id) {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const players = data
    ? (activePos === 'ALL'
        ? data.free_agents
        : data.free_agents.filter((p) => p.position === activePos))
    : [];

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 22, margin: '0 auto', maxWidth: 1100 }}>
        <div style={{ alignItems: 'baseline', display: 'flex', gap: 12 }}>
          <h1 style={{ margin: 0 }}>Waiver Wire</h1>
          {data && (
            <span style={{ color: '#6b7280', fontSize: 14 }}>{data.total} free agents</span>
          )}
        </div>

        <LeagueSelector onSelect={handleSelect} />

        {error && <p style={{ color: '#b42318' }}>{error}</p>}
        {loading && <p>Loading...</p>}

        {data && (
          <>
            {/* Position tabs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['ALL', 'QB', 'RB', 'WR', 'TE'].map((p) => (
                <button
                  key={p}
                  onClick={() => setActivePos(p)}
                  style={{
                    background: activePos === p ? '#3b82f6' : '#fff',
                    border: '1px solid ' + (activePos === p ? '#3b82f6' : '#d1d5db'),
                    borderRadius: 6,
                    color: activePos === p ? '#fff' : '#374151',
                    cursor: 'pointer',
                    fontWeight: 600,
                    padding: '6px 14px',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Table */}
            <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {['Player', 'Pos', 'Team', 'Dynasty Value', 'Injury', 'Depth', ''].map((h) => (
                      <th
                        key={h}
                        style={{
                          color: '#6b7280',
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          padding: '10px 14px',
                          textAlign: 'left',
                          textTransform: 'uppercase',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {players.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: '#9ca3af', padding: 24, textAlign: 'center' }}>
                        No free agents found for this position.
                      </td>
                    </tr>
                  ) : (
                    players.map((p, idx) => {
                      const isTarget = targets.has(p.sleeper_id);
                      return (
                        <tr
                          key={p.sleeper_id}
                          style={{
                            background: idx % 2 === 0 ? '#fff' : '#fafafa',
                            borderBottom: '1px solid #f3f4f6',
                          }}
                        >
                          <td style={{ fontWeight: 600, padding: '10px 14px' }}>
                            <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                              <span style={{ color: '#9ca3af', fontSize: 12, width: 20 }}>{idx + 1}</span>
                              {p.name}
                            </div>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <PosBadge pos={p.position} />
                          </td>
                          <td style={{ color: '#374151', padding: '10px 14px' }}>{p.team || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <ValueChip value={p.value_sf} />
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <InjuryBadge status={p.injury_status} />
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <DepthBadge depth={p.depth_chart_order} />
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <button
                              onClick={() => toggleTarget(p.sleeper_id)}
                              title={isTarget ? 'Remove from trade targets' : 'Add to trade targets'}
                              style={{
                                background: isTarget ? '#ede9fe' : '#f3f4f6',
                                border: isTarget ? '1px solid #c4b5fd' : '1px solid #e5e7eb',
                                borderRadius: 6,
                                color: isTarget ? '#7c3aed' : '#374151',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                                padding: '4px 10px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {isTarget ? '★ Targeted' : '+ Target'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
