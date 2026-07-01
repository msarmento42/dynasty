import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const STATUS_COLORS = {
  ok: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  warning: { bg: '#fef3c7', border: '#facc15', text: '#92400e' },
  critical: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
};

function StatusPill({ status }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.critical;
  return (
    <span
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        color: colors.text,
        fontSize: 11,
        fontWeight: 800,
        padding: '5px 8px',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

export default function DataDoctor() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDoctor() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/fantasy/data-doctor', { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load data diagnostics');
        setPayload(await response.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadDoctor();
  }, []);

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 18, margin: '0 auto', maxWidth: 1040 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0 }}>Data Doctor</h1>
            <p style={{ color: '#667085', fontSize: 13, margin: '6px 0 0' }}>
              Freshness, missing values, sync coverage, and recommendation trust.
            </p>
          </div>
          {payload?.status && <StatusPill status={payload.status} />}
        </div>

        {loading && <p>Loading...</p>}
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {payload && (
          <div style={{ display: 'grid', gap: 14 }}>
            {payload.checks.map((check) => (
              <article
                key={check.name}
                style={{
                  background: '#ffffff',
                  border: '1px solid #d9dee7',
                  borderRadius: 8,
                  display: 'grid',
                  gap: 10,
                  padding: 16,
                }}
              >
                <div style={{ alignItems: 'center', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                  <strong>{check.name}</strong>
                  <StatusPill status={check.status} />
                </div>
                <p style={{ color: '#475467', margin: 0 }}>{check.detail}</p>
                <Link
                  to={check.action_url || '/'}
                  style={{ color: '#175cd3', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
                >
                  {check.action}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
