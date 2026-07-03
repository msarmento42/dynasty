import { useCallback, useMemo, useState } from 'react';
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

export default function Dashboard() {
  const [leagueId, setLeagueId] = useState('');
  const [football, setFootball] = useState(null);
  const [baseball, setBaseball] = useState(null);
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
    } catch (err) {
      setFootball(null);
      setBaseball(null);
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
              Prioritized actions with confidence, rationale, and source detail.
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
            </div>

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
