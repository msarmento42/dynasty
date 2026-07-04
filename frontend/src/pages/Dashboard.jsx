import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LeagueSelector from '../components/LeagueSelector.jsx';
import RecommendationCard from '../components/RecommendationCard.jsx';

function SummaryTile({ label, value }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 14 }}>
      <div style={{ color: '#667085', fontSize: 12, fontWeight: 800, marginBottom: 5, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ color: '#101828', fontSize: 24, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

const ACTION_SECTIONS = [
  {
    key: 'trade_targets',
    label: 'Trade Targets',
    path: '/proposals',
    empty: 'No trade targets loaded yet.',
  },
  {
    key: 'waiver_adds',
    label: 'Waiver Adds',
    path: '/waiver',
    empty: 'No waiver adds loaded yet.',
  },
  {
    key: 'start_sit',
    label: 'Start/Sit Calls',
    path: '/start-sit',
    empty: 'No lineup swaps loaded yet.',
  },
  {
    key: 'value_movers',
    label: 'Value Movers',
    path: '/movers',
    empty: 'No movers loaded yet.',
  },
  {
    key: 'injuries_news',
    label: 'Injuries/News',
    path: '/news',
    empty: 'No news items loaded yet.',
  },
  {
    key: 'baseball_actions',
    label: 'Baseball Actions',
    path: '/baseball',
    empty: 'No baseball actions loaded yet.',
  },
  {
    key: 'draft_reminders',
    label: 'Draft Reminders',
    path: '/mock-draft',
    empty: 'Draft room is ready when you need it.',
  },
];

function ActionCard({ section, item }) {
  return (
    <Link
      to={section.path}
      style={{
        background: '#fff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        color: 'inherit',
        display: 'grid',
        gap: 8,
        minHeight: 138,
        padding: 16,
        textDecoration: 'none',
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <strong style={{ color: '#101828', fontSize: 15 }}>{section.label}</strong>
        <span style={{ color: '#475467', fontSize: 12, fontWeight: 800 }}>Open</span>
      </div>
      <div style={{ color: '#101828', fontSize: 18, fontWeight: 800, lineHeight: 1.25 }}>
        {item?.title || section.empty}
      </div>
      <p style={{ color: '#667085', fontSize: 13, lineHeight: 1.45, margin: 0 }}>
        {item?.summary || item?.rationale || 'Use this deeper tool to verify the recommendation before acting.'}
      </p>
    </Link>
  );
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function pickRecommendation(recommendations, matcher) {
  return recommendations.find((rec) => {
    const haystack = [
      rec.category,
      rec.action,
      rec.title,
      rec.summary,
      rec.source,
    ].map(normalizeText).join(' ');
    return matcher(haystack);
  });
}

function buildActionItems({ recommendations, football, baseball, supportData }) {
  const footballRecs = recommendations.filter((rec) => rec.sport !== 'baseball');
  const baseballRecs = baseball?.recommendations || [];
  const waiver = supportData.waiver?.free_agents?.[0];
  const lineup = supportData.startSit?.recommendations?.[0];
  const mover = supportData.movers?.gainers?.[0] || supportData.movers?.losers?.[0];
  const news = supportData.news?.[0];

  return {
    trade_targets: pickRecommendation(
      footballRecs,
      (text) => text.includes('trade') || text.includes('proposal')
    ),
    waiver_adds: waiver ? {
      title: `Review ${waiver.name}`,
      summary: `${waiver.position || 'FA'} ${waiver.team || ''} leads the waiver list at ${waiver.value_sf || 0} value.`,
    } : pickRecommendation(
      footballRecs,
      (text) => text.includes('waiver') || text.includes('free_agent') || text.includes('add')
    ),
    start_sit: lineup ? {
      title: `${lineup.action || 'Review'} ${lineup.player_in?.name || lineup.player_out?.name || 'lineup call'}`,
      summary: lineup.reason || 'Lineup engine found a start/sit decision to review.',
    } : pickRecommendation(
      footballRecs,
      (text) => text.includes('lineup') || text.includes('start') || text.includes('sit')
    ),
    value_movers: mover ? {
      title: `${mover.player_name} moved ${Math.round(mover.delta || 0)} value`,
      summary: `${mover.position || 'Player'} ${mover.team || ''} changed ${mover.delta_pct || 0}% over the tracked window.`,
    } : pickRecommendation(
      footballRecs,
      (text) => text.includes('market') || text.includes('trend') || text.includes('mover')
    ),
    injuries_news: news ? {
      title: news.player_name || 'Latest roster news',
      summary: news.headline || news.detail || 'Open the news feed for roster context.',
    } : pickRecommendation(
      footballRecs,
      (text) => text.includes('injury') || text.includes('news')
    ),
    baseball_actions: baseballRecs[0],
    draft_reminders: {
      title: football?.summary?.total
        ? 'Review draft board after today\'s actions'
        : 'Mock draft room is ready',
      summary: 'Use the draft assistant after roster, waiver, and trade checks are up to date.',
    },
  };
}

export default function Dashboard() {
  const [leagueId, setLeagueId] = useState('');
  const [football, setFootball] = useState(null);
  const [baseball, setBaseball] = useState(null);
  const [supportData, setSupportData] = useState({});
  const [activeSport, setActiveSport] = useState('football');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [footballRes, baseballRes] = await Promise.all([
        fetch(`/fantasy/recommendations/${id}`),
        fetch('/api/baseball/recommendations'),
      ]);
      if (!footballRes.ok) throw new Error('Unable to load football recommendations');
      if (!baseballRes.ok) throw new Error('Unable to load baseball recommendations');
      setFootball(await footballRes.json());
      setBaseball(await baseballRes.json());

      const supportResponses = await Promise.allSettled([
        fetch(`/fantasy/waiver/${id}`),
        fetch(`/fantasy/startsit/${id}`),
        fetch('/fantasy/players/movers'),
        fetch(`/fantasy/news?league_id=${id}`),
      ]);
      const [waiver, startSit, movers, news] = await Promise.all(
        supportResponses.map(async (result) => {
          if (result.status !== 'fulfilled' || !result.value.ok) return null;
          return result.value.json();
        })
      );
      setSupportData({ waiver, startSit, movers, news });
    } catch (err) {
      setFootball(null);
      setBaseball(null);
      setSupportData({});
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSelect(id) {
    setLeagueId(id);
    load(id);
  }

  const activeData = activeSport === 'football' ? football : baseball;
  const recommendations = activeData?.recommendations || [];
  const allRecommendations = [
    ...(football?.recommendations || []),
    ...(baseball?.recommendations || []),
  ];
  const actionItems = buildActionItems({ recommendations: allRecommendations, football, baseball, supportData });
  const categoryCount = useMemo(
    () => new Set(recommendations.map((rec) => rec.category)).size,
    [recommendations]
  );

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 20, margin: '0 auto', maxWidth: 1120 }}>
        <div style={{ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ color: '#101828', margin: 0 }}>Decision Dashboard</h1>
            <p style={{ color: '#667085', margin: '6px 0 0' }}>
              Today&apos;s actions with confidence, rationale, and source detail.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['football', 'baseball'].map((sport) => (
              <button
                key={sport}
                onClick={() => setActiveSport(sport)}
                style={{
                  background: activeSport === sport ? '#101828' : '#fff',
                  border: '1px solid #d0d5dd',
                  borderRadius: 7,
                  color: activeSport === sport ? '#fff' : '#344054',
                  cursor: 'pointer',
                  fontWeight: 800,
                  padding: '9px 13px',
                  textTransform: 'capitalize',
                }}
              >
                {sport}
              </button>
            ))}
          </div>
        </div>

        <LeagueSelector onSelect={handleSelect} />

        {error && <p style={{ color: '#b42318', fontWeight: 700 }}>{error}</p>}
        {loading && <p>Loading...</p>}

        {activeData && (
          <>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <SummaryTile label="Recommendations" value={recommendations.length} />
              <SummaryTile label="Categories" value={categoryCount} />
              <SummaryTile label="Low Confidence" value={activeData.summary?.low_confidence || 0} />
              <SummaryTile label="Mode" value={activeSport === 'football' ? 'Dynasty/Redraft' : 'Baseball'} />
            </div>

            <section>
              <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <h2 style={{ color: '#101828', fontSize: 20, margin: 0 }}>Today&apos;s Checklist</h2>
                <Link
                  to="/fantasypros-readiness"
                  style={{ color: '#344054', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}
                >
                  FantasyPros readiness
                </Link>
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                {ACTION_SECTIONS.map((section) => (
                  <ActionCard key={section.key} section={section} item={actionItems[section.key]} />
                ))}
              </div>
            </section>

            {recommendations.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 24 }}>
                <strong>No recommendations yet.</strong>
                <p style={{ color: '#667085', marginBottom: 0 }}>
                  Sync roster and player data, then return here for prioritized actions.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {recommendations.map((recommendation) => (
                  <RecommendationCard key={recommendation.id} recommendation={recommendation} />
                ))}
              </div>
            )}
          </>
        )}

        {!leagueId && !loading && (
          <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 24 }}>
            <strong>Select a league to generate recommendations.</strong>
          </div>
        )}
      </section>
    </main>
  );
}
