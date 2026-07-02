import { useState, useCallback, useMemo } from 'react';
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
    <span style={{
      background: '#dbeafe',
      borderRadius: 4,
      color: '#1e40af',
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 6px',
    }}>
      Starter
    </span>
  );
  if (depth === 2) return (
    <span style={{
      background: '#f3f4f6',
      borderRadius: 4,
      color: '#374151',
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 6px',
    }}>
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
  const [sortColumn, setSortColumn] = useState('value_sf'); // Default sort by value
  const [sortDirection, setSortDirection] = useState('desc'); // Default descending

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

  const handleSort = useCallback((column) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc'); // Default to descending when changing column
    }
  }, [sortColumn, sortDirection]);

  const filteredPlayers = data
    ? (activePos === 'ALL'
        ? data.free_agents
        : data.free_agents.filter((p) => p.position === activePos))
    : [];

  const sortableHeadersMap = {
    'Player': 'name',
    'Pos': 'position',
    'Team': 'team',
    'Dynasty Value': 'value_sf',
    'Injury': 'injury_status',
    'Depth': 'depth_chart_order',
  };

  const sortedPlayers = useMemo(() => {  const TIER_BREAK_THRESHOLD_PERCENT = 15; // A 15% drop in value signifies a new tier
  const TIER_NAMES = ['Elite', 'Strong', 'Solid', 'Depth', 'Deep Depth', 'Fringe']; // More names than typically needed


    if (!filteredPlayers || filteredPlayers.length === 0) return [];

    const sorted = [...filteredPlayers].sort((a, b) => {
      let valA = a[sortColumn];
      let valB = b[sortColumn];

      // Handle specific column types for sorting
      if (sortColumn === 'value_sf' || sortColumn === 'depth_chart_order') {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      } else if (sortColumn === 'name' || sortColumn === 'position' || sortColumn === 'team' || sortColumn === 'injury_status') {
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredPlayers, sortColumn, sortDirection]);
  const tieredPlayers = useMemo(() => {
    if (!sortedPlayers || sortedPlayers.length === 0) return [];

    const tiers = [];
    let currentTierPlayers = [];
    let tierIndex = 0;

    for (let i = 0; i < sortedPlayers.length; i++) {
      const currentPlayer = sortedPlayers[i];
      currentTierPlayers.push(currentPlayer);

      if (i < sortedPlayers.length - 1) {
        const nextPlayer = sortedPlayers[i + 1];
        // Only consider tier breaks if current player has a positive value to avoid division by zero
        // and to ensure meaningful percentage drops.
        if (currentPlayer.value_sf > 0) {
          const valueDiff = currentPlayer.value_sf - nextPlayer.value_sf;
          const percentageDrop = (valueDiff / currentPlayer.value_sf) * 100;

          // Condition for a tier break: significant drop AND current tier has at least one player
          if (percentageDrop >= TIER_BREAK_THRESHOLD_PERCENT && currentTierPlayers.length > 0) {
            tiers.push({
              name: TIER_NAMES[tierIndex] || `Tier ${tierIndex + 1}`,
              players: currentTierPlayers,
            });
            currentTierPlayers = [];
            tierIndex++;
          }
        }
      }
    }

    // Add the last tier if any players remain
    if (currentTierPlayers.length > 0) {
      tiers.push({
        name: TIER_NAMES[tierIndex] || `Tier ${tierIndex + 1}`,
        players: currentTierPlayers,
      });
    }

    return tiers;
  }, [sortedPlayers]);

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
                    {['Player', 'Pos', 'Team', 'Dynasty Value', 'Injury', 'Depth', ''].map((h) => {
                      const columnKey = sortableHeadersMap[h];
                      const isSortable = !!columnKey;
                      const isActiveColumn = sortColumn === columnKey;

                      return (
                        <th
                          key={h}
                          onClick={isSortable ? () => handleSort(columnKey) : undefined}
                          style={{
                            color: '#6b7280',
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            padding: '10px 14px',
                            textAlign: 'left',
                            textTransform: 'uppercase',
                            cursor: isSortable ? 'pointer' : 'default',
                            userSelect: 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {h}
                            {isActiveColumn && (
                              <span style={{ fontSize: 10 }}>
                                {sortDirection === 'asc' ? '▲' : '▼'}
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {tieredPlayers.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="flex flex-col items-center py-16 text-gray-500">
                          <p>No available players match your current filters.</p>
                          <p className="text-sm mt-1">Try adjusting the position filter or waiver settings.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      let overallRank = 0;
                      return tieredPlayers.map((tier, tierIdx) => (
                        <React.Fragment key={`tier-group-${tierIdx}`}>
                          <tr style={{ background: '#e0f2fe', borderBottom: '2px solid #90cdf4' }}>
                            <td colSpan={7} style={{ padding: '8px 14px', fontWeight: 700, fontSize: 14, color: '#1e40af' }}>
                              {tier.name} ({tier.players.length} players)
                            </td>
                          </tr>
                          {tier.players.map((p) => {
                            overallRank++;
                            const isTarget = targets.has(p.sleeper_id);
                            return (
                              <tr
                                key={p.sleeper_id}
                                style={{
                                  background: (overallRank % 2 === 0 ? '#fff' : '#fafafa'),
                                  borderBottom: '1px solid #f3f4f6',
                                }}
                              >
                                <td style={{ fontWeight: 600, padding: '10px 14px' }}>
                                  <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                                    <span style={{ color: '#9ca3af', fontSize: 12, width: 20 }}>{overallRank}</span>
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
                          })}
                        </React.Fragment>
                      ));
                    })()
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
