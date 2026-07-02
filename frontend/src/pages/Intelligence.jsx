import { useCallback, useMemo, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';
import DivergenceCard from '../components/DivergenceCard.jsx';
import QBPremiumCard from '../components/QBPremiumCard.jsx';
import BreakoutCard from '../components/BreakoutCard.jsx';
import StartSitCard from '../components/StartSitCard.jsx';
import LoadingSkeleton from '../components/LoadingSkeleton.jsx';

const KTC_RANKINGS_URL = 'https://keeptradecut.com/api/rankings?format=superflex&numQBs=1';
const FOUR_HORSEMEN_LEAGUE_IDS = new Set(['1315139749693886464', '1312285408079380481']);

const SEVERITY_GROUPS = [
  { key: 'critical', label: 'Critical', color: '#b42318', badge: 'CRITICAL' },
  { key: 'notable', label: 'Notable', color: '#b54708', badge: 'NOTABLE' },
  { key: 'fyi', label: 'FYI', color: '#027a48', badge: 'FYI' },
];

function cardStyle(borderColor = '#d9dee7') {
  return {
    background: '#ffffff',
    border: `1px solid ${borderColor}`,
    borderRadius: 8,
    padding: 16,
  };
}

async function optionalJson(response) {
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function formatDate(value) {
  if (!value) {
    return 'Unknown time';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function playerKey(name, position) {
  return `${normalizeName(name)}:${String(position || '').toUpperCase()}`;
}

function flattenKtcPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const possibleArrays = [
    payload?.players,
    payload?.rankings,
    payload?.data,
    payload?.value,
    payload?.values,
  ];
  return possibleArrays.find(Array.isArray) || [];
}

function ktcPlayerName(player) {
  return player.playerName || player.name || player.fullName || player.displayName || player.player?.name || '';
}

function ktcPlayerPosition(player) {
  return player.position || player.pos || player.player?.position || '';
}

function buildKtcRankMap(payload) {
  const players = flattenKtcPayload(payload);
  const rankMap = new Map();

  players.forEach((player, index) => {
    const name = ktcPlayerName(player);
    const position = ktcPlayerPosition(player);
    const key = playerKey(name, position);
    if (!key.startsWith(':') && !rankMap.has(key)) {
      rankMap.set(key, Number(player.rank || player.overallRank || index + 1));
    }
  });

  return rankMap;
}

async function fetchKtcRankMap() {
  const response = await fetch(KTC_RANKINGS_URL);
  if (!response.ok) {
    throw new Error('KTC rankings unavailable');
  }
  return buildKtcRankMap(await response.json());
}

function findKtcDivergences(rosterPlayers, ktcRankMap) {
  const rankedRoster = [...rosterPlayers]
    .filter((player) => player.name && player.position)
    .sort((a, b) => Number(b.value_sf || b.adjusted_value || 0) - Number(a.value_sf || a.adjusted_value || 0));

  return rankedRoster
    .map((player, index) => {
      const fantasyCalcRank = index + 1;
      const ktcRank = ktcRankMap.get(playerKey(player.name, player.position));
      if (!ktcRank) {
        return null;
      }

      const rankDelta = ktcRank - fantasyCalcRank;
      if (Math.abs(rankDelta) < 20) {
        return null;
      }

      return {
        sleeper_id: player.sleeper_id,
        name: player.name,
        position: player.position,
        team: player.team,
        fantasyCalcValue: player.value_sf || player.adjusted_value || 0,
        fantasyCalcRank,
        ktcRank,
        rankDelta,
        signal: rankDelta <= -20 ? 'SELL_HIGH' : 'BUY_LOW',
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta))
    .slice(0, 8);
}

function positionBadge(position, team) {
  return [position || 'FA', team].filter(Boolean).join(' / ');
}

function trendText(value) {
  const trend = Number(value || 0);
  return trend > 0 ? `+${trend}` : String(trend);
}

function buildQbPremium(player) {
  if (player.qb_premium) {
    return player.qb_premium;
  }

  const valueSf = Number(player.value_sf || 0);
  const value1qb = Number(player.value_1qb || 0);
  if (String(player.position || '').toUpperCase() !== 'QB' || value1qb <= 0) {
    return null;
  }

  const premiumMultiplier = Number((valueSf / value1qb).toFixed(2));
  let label = 'Overvalued in 4QB';
  if (premiumMultiplier > 1.8) {
    label = '4QB Target';
  } else if (premiumMultiplier < 1.2) {
    label = 'Format Neutral';
  }

  return {
    value_sf: valueSf,
    value_1qb: value1qb,
    premium_multiplier: premiumMultiplier,
    label,
  };
}

function PlayerInitials({ name }) {
  const initials = String(name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';

  return (
    <div
      style={{
        alignItems: 'center',
        background: '#e0f2fe',
        border: '1px solid #bae6fd',
        borderRadius: 8,
        color: '#075985',
        display: 'flex',
        fontWeight: 800,
        height: 42,
        justifyContent: 'center',
        width: 42,
      }}
    >
      {initials}
    </div>
  );
}

function AlertsSection({ alerts }) {
  const groupedAlerts = useMemo(() => {
    return alerts.reduce((groups, alert) => {
      const severity = String(alert.severity || 'fyi').toLowerCase();
      const key = severity === 'critical' || severity === 'notable' ? severity : 'fyi';
      return { ...groups, [key]: [...(groups[key] || []), alert] };
    }, {});
  }, [alerts]);

  if (alerts.length === 0) {
    return <p style={{ color: '#667085', margin: 0 }}>No alerts</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {SEVERITY_GROUPS.map((group) => {
        const groupAlerts = groupedAlerts[group.key] || [];
        if (groupAlerts.length === 0) {
          return null;
        }

        return (
          <section key={group.key} style={{ display: 'grid', gap: 10 }}>
            <h3 style={{ color: group.color, margin: 0 }}>{group.label}</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {groupAlerts.map((alert) => (
                <article key={`${alert.player_name}-${alert.alert_type}-${alert.created_at}`} style={cardStyle(group.color)}>
                  <div style={{ alignItems: 'start', display: 'flex', gap: 14, justifyContent: 'space-between' }}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <strong>{alert.player_name || 'Unknown player'}</strong>
                      <span style={{ color: '#475467', fontSize: 13 }}>
                        {positionBadge(alert.position, alert.team)}
                      </span>
                      {alert.detail && <span style={{ color: '#475467' }}>{alert.detail}</span>}
                    </div>
                    <div style={{ display: 'grid', gap: 6, justifyItems: 'end', minWidth: 150 }}>
                      <span
                        style={{
                          background: '#f2f4f7',
                          borderRadius: 999,
                          color: group.color,
                          fontSize: 12,
                          fontWeight: 800,
                          padding: '4px 8px',
                        }}
                      >
                        {group.badge} - {alert.alert_type || 'alert'}
                      </span>
                      <strong>
                        {alert.old_value || 'N/A'} -&gt; {alert.new_value || 'N/A'}
                      </strong>
                      <span style={{ color: '#667085', fontSize: 12 }}>{formatDate(alert.created_at)}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function NewsSection({ newsItems }) {
  if (newsItems.length === 0) {
    return <p style={{ color: '#667085', margin: 0 }}>No news</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {newsItems.map((item) => (
        <article key={`${item.sleeper_id || item.player_name}-${item.published_at}-${item.headline}`} style={cardStyle()}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '42px minmax(0, 1fr)' }}>
            <PlayerInitials name={item.player_name} />
            <div style={{ display: 'grid', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>{item.headline || 'News update'}</h3>
                {item.detail && <p style={{ color: '#475467', margin: '6px 0 0' }}>{item.detail}</p>}
              </div>
              <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span
                  style={{
                    background: '#eef2ff',
                    border: '1px solid #c7d2fe',
                    borderRadius: 999,
                    color: '#3730a3',
                    fontSize: 12,
                    fontWeight: 800,
                    padding: '4px 8px',
                  }}
                >
                  {item.player_name || 'Unknown player'}
                </span>
                {item.source && <span style={{ color: '#475467', fontSize: 13 }}>{item.source}</span>}
                <span style={{ color: '#667085', fontSize: 13 }}>{formatDate(item.published_at)}</span>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function MoversColumn({ title, players, color, emptyText }) {
  return (
    <section style={cardStyle()}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {players.length === 0 ? (
        <p style={{ color: '#667085', marginBottom: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {players.map((player) => (
            <div
              key={player.sleeper_id}
              style={{
                alignItems: 'center',
                borderTop: '1px solid #e4e7ec',
                display: 'flex',
                gap: 12,
                justifyContent: 'space-between',
                paddingTop: 10,
              }}
            >
              <div>
                <strong>{player.name}</strong>
                <div style={{ color: '#667085', fontSize: 13 }}>{positionBadge(player.position, player.team)}</div>
              </div>
              <div style={{ display: 'grid', gap: 2, justifyItems: 'end' }}>
                <strong>{Number(player.adjusted_value || 0).toLocaleString()}</strong>
                <span style={{ color, fontWeight: 800 }}>{trendText(player.trend_30d)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ValueMoversSection({ players }) {
  const significantPlayers = players.filter((player) => Math.abs(Number(player.trend_30d || 0)) > 100);
  const risers = significantPlayers
    .filter((player) => Number(player.trend_30d || 0) > 0)
    .sort((a, b) => Number(b.trend_30d || 0) - Number(a.trend_30d || 0))
    .slice(0, 3);
  const fallers = significantPlayers
    .filter((player) => Number(player.trend_30d || 0) < 0)
    .sort((a, b) => Number(a.trend_30d || 0) - Number(b.trend_30d || 0))
    .slice(0, 3);

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      <MoversColumn title="Top risers" players={risers} color="#15803d" emptyText="No risers above +100" />
      <MoversColumn title="Top fallers" players={fallers} color="#b42318" emptyText="No fallers below -100" />
    </div>
  );
}

function KtcDivergenceSection({ divergences, status }) {
  if (status === 'loading') {
    return <p style={{ color: '#667085', margin: 0 }}>Loading KTC comparison...</p>;
  }

  if (status === 'unavailable') {
    return <p style={{ color: '#667085', margin: 0 }}>KTC rankings unavailable</p>;
  }

  if (divergences.length === 0) {
    return <p style={{ color: '#667085', margin: 0 }}>No significant KTC divergences</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {divergences.map((divergence) => (
        <DivergenceCard key={`${divergence.sleeper_id}-${divergence.signal}`} divergence={divergence} />
      ))}
    </div>
  );
}

function QBPremiumSection({ players }) {
  const { targets, overvalued } = useMemo(() => {
    const premiumQbs = players
      .filter((player) => String(player.position || '').toUpperCase() === 'QB')
      .map((player) => ({ ...player, qb_premium: buildQbPremium(player) }))
      .filter((player) => player.qb_premium);

    return {
      targets: premiumQbs
        .filter((player) => player.qb_premium.label === '4QB Target')
        .sort((a, b) => b.qb_premium.premium_multiplier - a.qb_premium.premium_multiplier)
        .slice(0, 5),
      overvalued: premiumQbs
        .filter((player) => player.qb_premium.label === 'Overvalued in 4QB')
        .sort((a, b) => a.qb_premium.premium_multiplier - b.qb_premium.premium_multiplier)
        .slice(0, 3),
    };
  }, [players]);

  if (targets.length === 0 && overvalued.length === 0) {
    return <p style={{ color: '#667085', margin: 0 }}>No QB premium signals for this roster</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {targets.length > 0 && (
        <section style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ color: '#166534', margin: 0 }}>4QB Targets</h3>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {targets.map((player) => (
              <QBPremiumCard key={`target-${player.sleeper_id}`} player={player} />
            ))}
          </div>
        </section>
      )}

      {overvalued.length > 0 && (
        <section style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ color: '#92400e', margin: 0 }}>Overvalued QBs</h3>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {overvalued.map((player) => (
              <QBPremiumCard key={`overvalued-${player.sleeper_id}`} player={player} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SkeletonGrid({ count = 3, cardProps = {}, minWidth = 260 }) {
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))` }}>
      {Array.from({ length: count }).map((_, index) => (
        <LoadingSkeleton key={index} {...cardProps} />
      ))}
    </div>
  );
}

function AlertsSkeleton() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <LoadingSkeleton rows={1} metrics={1} style={{ borderColor: '#b54708' }} />
      <LoadingSkeleton rows={1} metrics={1} style={{ borderColor: '#027a48' }} />
    </div>
  );
}

function NewsSkeleton() {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <LoadingSkeleton avatar rows={2} />
      <LoadingSkeleton avatar rows={2} />
    </div>
  );
}

function MoversSkeleton() {
  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {['Top risers', 'Top fallers'].map((title) => (
        <section key={title} style={cardStyle()}>
          <h3 style={{ marginTop: 0 }}>{title}</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <LoadingSkeleton badge={false} rows={0} metrics={2} style={{ padding: 0, border: 0 }} />
            <LoadingSkeleton badge={false} rows={0} metrics={2} style={{ padding: 0, border: 0 }} />
            <LoadingSkeleton badge={false} rows={0} metrics={2} style={{ padding: 0, border: 0 }} />
          </div>
        </section>
      ))}
    </div>
  );
}

function StartSitSkeleton() {
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {['QB', 'RB', 'WR', 'TE', 'FLEX'].map((position) => (
        <div key={position} style={cardStyle()}>
          <h3 style={{ marginTop: 0 }}>{position}</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <LoadingSkeleton rows={0} metrics={1} style={{ background: '#ecfdf3', borderColor: '#027a48', padding: 12 }} />
            <LoadingSkeleton rows={0} metrics={1} style={{ background: '#ecfdf3', borderColor: '#027a48', padding: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function WaiverSkeleton() {
  return <SkeletonGrid count={4} cardProps={{ rows: 0, metrics: 1, style: { background: '#e0f2fe', borderColor: '#004d99', padding: 12 } }} />;
}

// Define standard starter slots
const STARTER_SLOTS = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1, // One flex spot (RB/WR/TE)
};

function generateStartSitRecommendations(rosterPlayers) {
  const recommendations = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    FLEX: [],
    BENCH: [],
  };

  const playersByPosition = rosterPlayers.reduce((acc, player) => {
    const pos = String(player.position || '').toUpperCase();
    if (['QB', 'RB', 'WR', 'TE'].includes(pos)) {
      acc[pos] = [...(acc[pos] || []), player];
    } else {
      // Handle other positions or unknown as potential flex
      acc.OTHER = [...(acc.OTHER || []), player];
    }
    return acc;
  }, {});

  const sortedPlayers = {};
  for (const pos in playersByPosition) {
    sortedPlayers[pos] = [...playersByPosition[pos]].sort(
      (a, b) => Number(b.adjusted_value || 0) - Number(a.adjusted_value || 0)
    );
  }

  const assignedPlayerSleeperIds = new Set();

  // Fill primary positions
  ['QB', 'RB', 'WR', 'TE'].forEach((pos) => {
    const slots = STARTER_SLOTS[pos];
    if (sortedPlayers[pos]) {
      for (let i = 0; i < slots && i < sortedPlayers[pos].length; i++) {
        const player = sortedPlayers[pos][i];
        recommendations[pos].push(player);
        assignedPlayerSleeperIds.add(player.sleeper_id);
      }
    }
  });

  // Fill FLEX
  const flexCandidates = [
    ...(sortedPlayers.RB || []),
    ...(sortedPlayers.WR || []),
    ...(sortedPlayers.TE || []),
    ...(sortedPlayers.OTHER || []), // Include other positions for flex consideration
  ]
    .filter((player) => !assignedPlayerSleeperIds.has(player.sleeper_id))
    .sort((a, b) => Number(b.adjusted_value || 0) - Number(a.adjusted_value || 0));

  for (let i = 0; i < STARTER_SLOTS.FLEX && i < flexCandidates.length; i++) {
    const player = flexCandidates[i];
    recommendations.FLEX.push(player);
    assignedPlayerSleeperIds.add(player.sleeper_id);
  }

  // Remaining players go to BENCH
  rosterPlayers.forEach((player) => {
    if (!assignedPlayerSleeperIds.has(player.sleeper_id)) {
      recommendations.BENCH.push(player);
    }
  });

  // Sort bench by value
  recommendations.BENCH.sort((a, b) => Number(b.adjusted_value || 0) - Number(a.adjusted_value || 0));

  return recommendations;
}

function generateWaiverWireRankings(allPlayers, allLeagueRosters) {
  if (!allPlayers || allPlayers.length === 0 || !allLeagueRosters || allLeagueRosters.length === 0) {
    return [];
  }

  const ownedPlayerSleeperIds = new Set();
  allLeagueRosters.forEach((roster) => {
    if (Array.isArray(roster.players)) {
      roster.players.forEach((player) => {
        if (player.sleeper_id) {
          ownedPlayerSleeperIds.add(player.sleeper_id);
        }
      });
    }
  });

  const waiverPlayers = allPlayers
    .filter((player) => !ownedPlayerSleeperIds.has(player.sleeper_id))
    .filter((player) => player.adjusted_value > 0) // Only show players with some value
    .sort((a, b) => Number(b.adjusted_value || 0) - Number(a.adjusted_value || 0))
    .slice(0, 10); // Top 10 waiver wire players

  return waiverPlayers;
}

export default function Intelligence() {
  const [selectedLeague, setSelectedLeague] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [newsItems, setNewsItems] = useState([]);
  const [rosterPlayers, setRosterPlayers] = useState([]);
  const [ktcDivergences, setKtcDivergences] = useState([]);
  const [ktcStatus, setKtcStatus] = useState('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [breakoutCandidates, setBreakoutCandidates] = useState([]);
  const [startSitRecommendations, setStartSitRecommendations] = useState({});
  const [waiverWirePlayers, setWaiverWirePlayers] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]); // To store all players for waiver wire

  const loadIntelligence = useCallback(async (leagueId) => {
    setSelectedLeague(leagueId);
    setLoading(true);
    setError('');
    setKtcDivergences([]);
    setKtcStatus('idle');
    setBreakoutCandidates([]);
    setStartSitRecommendations({}); // Reset
    setWaiverWirePlayers([]); // Reset
    setAllPlayers([]); // Reset

    try {
      const [
        alertsResponse,
        newsResponse,
        rosterResponse,
        breakoutResponse,
        allPlayersResponse, // New
        allRostersResponse, // New
      ] = await Promise.all([
        fetch(`/fantasy/alerts/${leagueId}`),
        fetch('/fantasy/news'),
        fetch(`/fantasy/league/${leagueId}/roster`),
        fetch(`/fantasy/breakout-candidates?league_id=${leagueId}&limit=10`),
        fetch('/fantasy/players/all'), // New endpoint
        fetch(`/fantasy/league/${leagueId}/all-rosters`), // New endpoint
      ]);

      if (!alertsResponse.ok) {
        throw new Error('Unable to load alerts');
      }
      if (!rosterResponse.ok) {
        throw new Error('Unable to load roster movers');
      }
      // Add error handling for new responses
      if (!allPlayersResponse.ok) {
        console.warn('Unable to load all players for waiver wire');
      }
      if (!allRostersResponse.ok) {
        console.warn('Unable to load all league rosters for waiver wire');
      }

      const [
        alertsData,
        newsData,
        rosterData,
        breakoutData,
        allPlayersData,
        allRostersData,
      ] = await Promise.all([
        alertsResponse.json(),
        optionalJson(newsResponse),
        rosterResponse.json(),
        optionalJson(breakoutResponse),
        optionalJson(allPlayersResponse),
        optionalJson(allRostersResponse),
      ]);
      const players = Array.isArray(rosterData.players) ? rosterData.players : [];
      const fullPlayerList = Array.isArray(allPlayersData) ? allPlayersData : [];
      const allLeagueRosters = Array.isArray(allRostersData) ? allRostersData : [];


      setAlerts(Array.isArray(alertsData) ? alertsData : []);
      setNewsItems(newsData);
      setRosterPlayers(players);
      setBreakoutCandidates(breakoutData);
      setAllPlayers(fullPlayerList); // Store all players

      // Generate Start/Sit recommendations
      const startSit = generateStartSitRecommendations(players);
      setStartSitRecommendations(startSit);

      // Generate Waiver Wire rankings
      const waiverWire = generateWaiverWireRankings(fullPlayerList, allLeagueRosters);
      setWaiverWirePlayers(waiverWire);

      setKtcStatus('loading');

      try {
        const ktcRankMap = await fetchKtcRankMap();
        setKtcDivergences(findKtcDivergences(players, ktcRankMap));
        setKtcStatus('ready');
      } catch (ktcError) {
        setKtcDivergences([]);
        setKtcStatus('unavailable');
      }
    } catch (err) {
      setAlerts([]);
      setNewsItems([]);
      setRosterPlayers([]);
      setKtcDivergences([]);
      setBreakoutCandidates([]);
      setKtcStatus('idle');
      setStartSitRecommendations({});
      setWaiverWirePlayers([]);
      setAllPlayers([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const isFourHorsemenLeague = FOUR_HORSEMEN_LEAGUE_IDS.has(selectedLeague);

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 22, margin: '0 auto', maxWidth: 1120 }}>
        <header style={{ display: 'grid', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0 }}>Intelligence</h1>
            <p style={{ color: '#667085', margin: '6px 0 0' }}>
              Alerts, roster news, market divergences, and significant value movement for the selected league.
            </p>
          </div>
          <LeagueSelector onSelect={loadIntelligence} />
        </header>

        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {!error && selectedLeague && (
          <div style={{ display: 'grid', gap: 22 }}>
            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0 }}>Alerts</h2>
              {loading ? <AlertsSkeleton /> : <AlertsSection alerts={alerts} />}
            </section>

            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0 }}>News Feed</h2>
              {loading ? <NewsSkeleton /> : <NewsSection newsItems={newsItems} />}
            </section>

            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0 }}>KTC Divergence</h2>
              {loading ? (
                <SkeletonGrid count={3} cardProps={{ metrics: 3 }} />
              ) : (
                <KtcDivergenceSection divergences={ktcDivergences} status={ktcStatus} />
              )}
            </section>

            {isFourHorsemenLeague && (
              <section style={{ display: 'grid', gap: 12 }}>
                <h2 style={{ margin: 0 }}>4QB Premium</h2>
                {loading ? <SkeletonGrid count={3} cardProps={{ metrics: 3 }} /> : <QBPremiumSection players={rosterPlayers} />}
              </section>
            )}

            {(loading || breakoutCandidates.length > 0) && (
              <section style={{ display: 'grid', gap: 12 }}>
                <h2 style={{ margin: 0 }}>Breakout Candidates</h2>
                <p style={{ color: '#667085', fontSize: 13, margin: 0 }}>
                  Rising players with below-market value — buy-low targets.
                </p>
                {loading ? (
                  <SkeletonGrid count={3} cardProps={{ metrics: 2 }} />
                ) : (
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                    {breakoutCandidates.map((p) => (
                      <BreakoutCard key={p.sleeper_id} player={p} />
                    ))}
                  </div>
                )}
              </section>
            )}

            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0 }}>Value Movers</h2>
              {loading ? <MoversSkeleton /> : <ValueMoversSection players={rosterPlayers} />}
            </section>

            <section style={{ display: 'grid', gap: 12 }}>
                <h2 style={{ margin: 0 }}>Start/Sit Recommendations</h2>
                <p style={{ color: '#667085', fontSize: 13, margin: 0 }}>
                    Top players on your roster to start this week based on adjusted value.
                </p>
                {loading ? <StartSitSkeleton /> : <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                    {Object.entries(startSitRecommendations).map(([position, players]) => {
                        // Only render primary positions and FLEX
                        if (!['QB', 'RB', 'WR', 'TE', 'FLEX'].includes(position)) {
                            return null;
                        }
                        return (
                            <div key={position} style={cardStyle()}>
                                <h3 style={{ marginTop: 0 }}>{position}</h3>
                                {players.length === 0 ? (
                                    <p style={{ color: '#667085', marginBottom: 0 }}>No {position} recommendations</p>
                                ) : (
                                    <div style={{ display: 'grid', gap: 10 }}>
                                        {players.map((player) => (
                                            <StartSitCard key={player.sleeper_id} player={player} type="start" />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>}
            </section>

            <section style={{ display: 'grid', gap: 12 }}>
                <h2 style={{ margin: 0 }}>Waiver Wire Rankings</h2>
                <p style={{ color: '#667085', fontSize: 13, margin: 0 }}>
                    Top unowned players available on the waiver wire by FantasyCalc value.
                </p>
                {loading ? <WaiverSkeleton /> : <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                    {waiverWirePlayers.length === 0 ? (
                        <p style={{ color: '#667085', margin: 0 }}>No waiver wire players found.</p>
                    ) : (
                        waiverWirePlayers.map((player) => (
                            <StartSitCard key={player.sleeper_id} player={player} type="waiver" />
                        ))
                    )}
                </div>}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
