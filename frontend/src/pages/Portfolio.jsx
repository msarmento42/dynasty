import { useEffect, useMemo, useState } from 'react';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'Other'];

function formatValue(value) {
  return Number(value || 0).toLocaleString();
}

function positionRows(breakdown) {
  return POSITION_ORDER.filter((position) => breakdown[position]).map((position) => ({
    position,
    ...breakdown[position],
  }));
}

function ConcentrationBadge({ player }) {
  if (!player.concentrated) {
    return null;
  }

  return (
    <span
      title={(player.owned_leagues || []).map((league) => league.league_name).join(', ')}
      style={{
        background: '#fff7ed',
        border: '1px solid #fdba74',
        borderRadius: 999,
        color: '#c2410c',
        fontSize: 12,
        fontWeight: 800,
        padding: '3px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      Shared
    </span>
  );
}

function PlayerRow({ player }) {
  return (
    <article
      style={{
        background: player.concentrated ? '#fffbeb' : '#ffffff',
        border: player.concentrated ? '1px solid #fbbf24' : '1px solid #d9dee7',
        borderRadius: 8,
        display: 'grid',
        gap: 8,
        padding: 12,
      }}
    >
      <div style={{ alignItems: 'start', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <div>
          <strong>{player.name}</strong>
          <div style={{ color: '#667085', fontSize: 13 }}>
            {player.position || 'FA'} {player.team ? `- ${player.team}` : ''} - Age {player.age || 'N/A'}
          </div>
        </div>
        <ConcentrationBadge player={player} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ color: '#475467' }}>Value</span>
        <strong>{formatValue(player.adjusted_value)}</strong>
      </div>
    </article>
  );
}

function LeagueColumn({ league }) {
  return (
    <section
      style={{
        background: '#ffffff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        display: 'grid',
        gap: 14,
        padding: 16,
      }}
    >
      <header style={{ borderBottom: '1px solid #eaecf0', paddingBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{league.league_name}</h2>
        <p style={{ color: '#667085', margin: '4px 0 0' }}>{league.format}</p>
        <strong style={{ display: 'block', fontSize: 22, marginTop: 8 }}>
          {formatValue(league.total_adjusted_value)}
        </strong>
      </header>

      <div style={{ display: 'grid', gap: 10 }}>
        {(league.players || []).map((player) => (
          <PlayerRow key={`${league.league_id}-${player.sleeper_id}`} player={player} />
        ))}
      </div>
    </section>
  );
}

export default function Portfolio() {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadPortfolio() {
      try {
        const response = await fetch('/fantasy/portfolio');
        if (!response.ok) {
          throw new Error('Unable to load portfolio');
        }
        const data = await response.json();
        if (isMounted) {
          setPortfolio(data);
          setError('');
        }
      } catch (err) {
        if (isMounted) {
          setPortfolio(null);
          setError(err.message);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadPortfolio();
    return () => {
      isMounted = false;
    };
  }, []);

  const positionStats = useMemo(
    () => positionRows(portfolio?.stats?.positional_breakdown || {}),
    [portfolio],
  );

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 24, margin: '0 auto', maxWidth: 1280 }}>
        <header>
          <h1 style={{ margin: 0 }}>Portfolio</h1>
          <p style={{ color: '#536176', margin: '8px 0 0' }}>
            All league rosters side by side, with shared players flagged for concentration risk.
          </p>
        </header>

        {loading && <p>Loading...</p>}
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {portfolio && !loading && (
          <>
            <div
              style={{
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              }}
            >
              {(portfolio.leagues || []).map((league) => (
                <LeagueColumn key={league.league_id} league={league} />
              ))}
            </div>

            <section
              style={{
                background: '#ffffff',
                border: '1px solid #d9dee7',
                borderRadius: 8,
                display: 'grid',
                gap: 18,
                padding: 18,
              }}
            >
              <h2 style={{ margin: 0 }}>Portfolio Stats</h2>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <div>
                  <div style={{ color: '#667085' }}>Unique players</div>
                  <strong style={{ fontSize: 22 }}>{portfolio.stats.total_unique_players}</strong>
                </div>
                <div>
                  <div style={{ color: '#667085' }}>Concentration risk</div>
                  <strong style={{ fontSize: 22 }}>{portfolio.stats.concentration_risk_players}</strong>
                </div>
                <div>
                  <div style={{ color: '#667085' }}>Total value</div>
                  <strong style={{ fontSize: 22 }}>{formatValue(portfolio.stats.total_adjusted_value)}</strong>
                </div>
              </div>

              {portfolio.concentrated_players.length > 0 && (
                <div>
                  <h3 style={{ margin: '0 0 10px' }}>Shared Players</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {portfolio.concentrated_players.map((player) => (
                      <span
                        key={player.sleeper_id}
                        style={{
                          background: '#fff7ed',
                          border: '1px solid #fdba74',
                          borderRadius: 999,
                          color: '#c2410c',
                          fontWeight: 800,
                          padding: '6px 10px',
                        }}
                      >
                        {player.name} ({player.leagues.length})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 style={{ margin: '0 0 10px' }}>Positional Breakdown</h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {positionStats.map((row) => (
                    <div
                      key={row.position}
                      style={{
                        alignItems: 'center',
                        borderBottom: '1px solid #eaecf0',
                        display: 'grid',
                        gap: 12,
                        gridTemplateColumns: '80px 1fr auto',
                        padding: '8px 0',
                      }}
                    >
                      <strong>{row.position}</strong>
                      <span style={{ color: '#667085' }}>{row.count} players</span>
                      <strong>{formatValue(row.value)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
