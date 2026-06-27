import { useCallback, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';

const POS_COLORS = {
  QB: { bg: '#e0f2fe', text: '#0369a1' },
  RB: { bg: '#d1fae5', text: '#065f46' },
  WR: { bg: '#fef3c7', text: '#92400e' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
};

function RankTrend({ change }) {
  if (change === null || change === undefined) {
    return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
  }
  if (change > 0) {
    return (
      <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 13 }}>
        ↑{change}
      </span>
    );
  }
  if (change < 0) {
    return (
      <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 13 }}>
        ↓{Math.abs(change)}
      </span>
    );
  }
  return <span style={{ color: '#6b7280', fontSize: 13 }}>→</span>;
}

function PowerBar({ score, maxScore }) {
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: 8, minWidth: 120 }}>
      <div
        style={{
          background: '#e4e7ec',
          borderRadius: 4,
          height: 8,
          overflow: 'hidden',
          width: 80,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            background: pct >= 80 ? '#16a34a' : pct >= 50 ? '#2563eb' : '#f59e0b',
            borderRadius: 4,
            height: '100%',
            transition: 'width 0.4s ease',
            width: `${pct}%`,
          }}
        />
      </div>
      <span style={{ color: '#667085', fontSize: 12, minWidth: 34 }}>{pct}%</span>
    </div>
  );
}

function SummaryCard({ label, value, sub, highlight }) {
  return (
    <div
      style={{
        background: highlight ? '#eff6ff' : 'var(--bg-card, #fff)',
        border: highlight ? '2px solid #3b82f6' : '1px solid var(--border-color, #d9dee7)',
        borderRadius: 10,
        padding: '16px 20px',
      }}
    >
      <p style={{ color: 'var(--text-secondary, #667085)', fontSize: 13, margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: highlight ? '#2563eb' : 'inherit' }}>
        {value}
      </p>
      {sub && <p style={{ color: '#98a2b3', fontSize: 12, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  );
}

export default function PowerRankings() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (leagueId) => {
    if (!leagueId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/fantasy/league/${leagueId}/power-rankings`);
      if (!res.ok) throw new Error('Unable to load power rankings');
      setData(await res.json());
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const rankings = data?.rankings || [];
  const myTeam = rankings.find((t) => t.is_mine);
  const maxScore = rankings.length > 0 ? rankings[0].power_score : 1;

  const thStyle = {
    borderBottom: '1px solid #e4e7ec',
    color: '#667085',
    fontSize: 12,
    fontWeight: 600,
    padding: '10px 14px',
    textAlign: 'left',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
  const tdStyle = {
    borderBottom: '1px solid #f2f4f7',
    fontSize: 14,
    padding: '11px 14px',
    verticalAlign: 'middle',
  };

  return (
    <main style={{ background: 'var(--bg-primary, #f6f7fb)', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1120 }}>
        <div style={{ display: 'grid', gap: 18, marginBottom: 24 }}>
          <h1 style={{ margin: 0, color: 'var(--text-primary, #1a1a2e)' }}>Power Rankings</h1>
          <p style={{ color: 'var(--text-secondary, #667085)', margin: 0 }}>
            Overall team strength: roster dynasty value + draft pick assets.
          </p>
          <LeagueSelector onSelect={load} />
        </div>

        {loading && <p style={{ color: 'var(--text-secondary, #667085)' }}>Loading rankings...</p>}
        {error && (
          <div
            style={{
              background: '#fef3f2',
              border: '1px solid #fda29b',
              borderRadius: 8,
              color: '#b42318',
              padding: 16,
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* Summary cards */}
            {myTeam && (
              <div
                style={{
                  display: 'grid',
                  gap: 14,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  marginBottom: 24,
                }}
              >
                <SummaryCard
                  label="Your Rank"
                  value={`#${myTeam.rank} of ${rankings.length}`}
                  sub={myTeam.owner_display_name}
                  highlight
                />
                <SummaryCard
                  label="Your Power Score"
                  value={Number(myTeam.power_score).toLocaleString()}
                  sub="Roster + picks"
                />
                <SummaryCard
                  label="Roster Value"
                  value={Number(myTeam.roster_value).toLocaleString()}
                  sub="Dynasty value (SF)"
                />
                <SummaryCard
                  label="Pick Assets"
                  value={Number(myTeam.pick_value).toLocaleString()}
                  sub="Traded picks on hand"
                />
                {myTeam.rank_change !== null && myTeam.rank_change !== undefined && (
                  <SummaryCard
                    label="Week-over-Week"
                    value={
                      myTeam.rank_change > 0
                        ? `↑${myTeam.rank_change}`
                        : myTeam.rank_change < 0
                        ? `↓${Math.abs(myTeam.rank_change)}`
                        : '→ No change'
                    }
                    sub="vs last week"
                  />
                )}
              </div>
            )}

            {/* Rankings table */}
            <div
              style={{
                background: 'var(--bg-card, #fff)',
                border: '1px solid var(--border-color, #d9dee7)',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ ...thStyle, textAlign: 'center', width: 60 }}>Rank</th>
                    <th style={thStyle}>Team</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Roster Value</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Pick Assets</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Power Score</th>
                    <th style={thStyle}>Strength</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((team) => {
                    const isMine = team.is_mine;
                    return (
                      <tr
                        key={team.roster_id}
                        style={{
                          background: isMine ? '#eff6ff' : undefined,
                        }}
                        onMouseEnter={(e) => {
                          if (!isMine) e.currentTarget.style.background = '#f9fafb';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isMine ? '#eff6ff' : '';
                        }}
                      >
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span
                            style={{
                              background:
                                team.rank === 1
                                  ? '#fbbf24'
                                  : team.rank === 2
                                  ? '#9ca3af'
                                  : team.rank === 3
                                  ? '#cd7f32'
                                  : '#f3f4f6',
                              borderRadius: 999,
                              color: team.rank <= 3 ? '#fff' : '#374151',
                              display: 'inline-block',
                              fontWeight: 700,
                              fontSize: 13,
                              lineHeight: 1,
                              minWidth: 28,
                              padding: '5px 0',
                              textAlign: 'center',
                            }}
                          >
                            #{team.rank}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: isMine ? 700 : 500 }}>
                            {team.owner_display_name}
                          </span>
                          {isMine && (
                            <span
                              style={{
                                background: '#dbeafe',
                                borderRadius: 4,
                                color: '#1d4ed8',
                                fontSize: 10,
                                fontWeight: 700,
                                marginLeft: 8,
                                padding: '2px 6px',
                              }}
                            >
                              YOU
                            </span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {Number(team.roster_value).toLocaleString()}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {Number(team.pick_value).toLocaleString()}
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'right' }}>
                          {Number(team.power_score).toLocaleString()}
                        </td>
                        <td style={tdStyle}>
                          <PowerBar score={team.power_score} maxScore={maxScore} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <RankTrend change={team.rank_change} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
