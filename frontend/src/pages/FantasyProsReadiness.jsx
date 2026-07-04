const FEATURES = [
  {
    name: 'Rankings',
    status: 'Ready',
    path: '/',
    detail: 'Roster, value, age, position, and trend data are available for league decisions.',
  },
  {
    name: 'Trade Analyzer',
    status: 'Ready',
    path: '/trade',
    detail: 'Trade builder evaluates player, pick, and baseball-side value deltas.',
  },
  {
    name: 'Trade Finder',
    status: 'Ready',
    path: '/proposals',
    detail: 'Proposal engine surfaces manager fits and trade target ideas.',
  },
  {
    name: 'Waiver Assistant',
    status: 'Ready',
    path: '/waiver',
    detail: 'Waiver page ranks free agents by value and roster context.',
  },
  {
    name: 'Start/Sit',
    status: 'Ready',
    path: '/start-sit',
    detail: 'Lineup tool flags better starts and injury-driven sits.',
  },
  {
    name: 'Lineup Optimizer',
    status: 'Partial',
    path: '/start-sit',
    detail: 'Current optimizer is value and injury aware; matchup projections still need richer sources.',
  },
  {
    name: 'Draft Assistant',
    status: 'Ready',
    path: '/mock-draft',
    detail: 'Mock draft room supports draft state and player selection workflows.',
  },
  {
    name: 'Mock Draft',
    status: 'Ready',
    path: '/mock-draft',
    detail: 'Mock draft route is available for football draft practice.',
  },
  {
    name: 'News',
    status: 'Ready',
    path: '/news',
    detail: 'News feed can be filtered to roster players and used from the dashboard.',
  },
  {
    name: 'Player Profiles',
    status: 'Ready',
    path: '/dashboard',
    detail: 'Global search opens football and baseball player profile pages.',
  },
  {
    name: 'Baseball Tools',
    status: 'Partial',
    path: '/baseball',
    detail: 'Baseball roster, prospects, draft board, recommendations, and weekly assistant exist; full league sync is missing.',
  },
  {
    name: 'UI Polish',
    status: 'Partial',
    path: '/dashboard',
    detail: 'Core surfaces are linked and usable; deeper responsive polish remains incremental.',
  },
];

const STATUS_STYLE = {
  Ready: { background: '#dcfce7', color: '#166534' },
  Partial: { background: '#fef3c7', color: '#92400e' },
  Missing: { background: '#fee2e2', color: '#991b1b' },
};

function statusSummary(status) {
  return FEATURES.filter((feature) => feature.status === status).length;
}

export default function FantasyProsReadiness() {
  const missing = statusSummary('Missing');
  const partial = statusSummary('Partial');
  const verdict = missing === 0 && partial <= 3
    ? 'Safe to trial without FantasyPros, but keep overlap until partial tools match your league workflow.'
    : 'Not safe to cancel FantasyPros yet.';

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 18, margin: '0 auto', maxWidth: 1080 }}>
        <div>
          <h1 style={{ color: '#101828', margin: 0 }}>FantasyPros Readiness</h1>
          <p style={{ color: '#667085', margin: '6px 0 0' }}>
            Replacement checklist for deciding whether the app covers the FantasyPros workflow.
          </p>
        </div>

        <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 18 }}>
          <strong style={{ color: '#101828', display: 'block', fontSize: 18, marginBottom: 8 }}>
            {verdict}
          </strong>
          <div style={{ color: '#475467', display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 14 }}>
            <span>{statusSummary('Ready')} ready</span>
            <span>{partial} partial</span>
            <span>{missing} missing</span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {FEATURES.map((feature) => {
            const style = STATUS_STYLE[feature.status];
            return (
              <a
                key={feature.name}
                href={feature.path}
                style={{
                  background: '#fff',
                  border: '1px solid #d9dee7',
                  borderRadius: 8,
                  color: 'inherit',
                  display: 'grid',
                  gap: 10,
                  padding: 16,
                  textDecoration: 'none',
                }}
              >
                <div style={{ alignItems: 'center', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                  <strong style={{ color: '#101828' }}>{feature.name}</strong>
                  <span
                    style={{
                      background: style.background,
                      borderRadius: 6,
                      color: style.color,
                      fontSize: 12,
                      fontWeight: 800,
                      padding: '4px 8px',
                    }}
                  >
                    {feature.status}
                  </span>
                </div>
                <p style={{ color: '#667085', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{feature.detail}</p>
              </a>
            );
          })}
        </div>
      </section>
    </main>
  );
}
