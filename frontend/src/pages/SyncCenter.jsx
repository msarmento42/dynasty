import { useEffect, useMemo, useState } from 'react';

const STATUS_COLORS = {
  fresh: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  supported: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  success: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  stale: { bg: '#fef3c7', border: '#facc15', text: '#92400e' },
  'csv-only': { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  missing: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  error: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  unknown: { bg: '#f3f4f6', border: '#d1d5db', text: '#374151' },
};

function formatDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function StatusPill({ status }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.unknown;
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
      {status || 'unknown'}
    </span>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
      <p style={{ color: '#667085', fontSize: 12, margin: 0 }}>{label}</p>
      <strong style={{ display: 'block', fontSize: 28, marginTop: 4 }}>{value}</strong>
      {sub ? <p style={{ color: '#667085', fontSize: 12, margin: '4px 0 0' }}>{sub}</p> : null}
    </div>
  );
}

export default function SyncCenter() {
  const [payload, setPayload] = useState(null);
  const [sport, setSport] = useState('football');
  const [platform, setPlatform] = useState('yahoo');
  const [sourceName, setSourceName] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [rosterName, setRosterName] = useState('My Baseball Roster');
  const [csvText, setCsvText] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/fantasy/sync-center', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load Sync Center');
      const data = await response.json();
      setPayload(data);
      if (!csvText && data.templates?.[sport]?.csv) {
        setCsvText(data.templates[sport].csv);
      }
    } catch (err) {
      setError(err.message || 'Unable to load Sync Center');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const templates = payload?.templates || {};
  const selectedTemplate = templates[sport];
  const platformOptions = selectedTemplate?.platforms || [];
  const counts = payload?.counts || {};

  useEffect(() => {
    if (selectedTemplate && !selectedTemplate.platforms.includes(platform)) {
      setPlatform(selectedTemplate.platforms[0]);
    }
  }, [platform, selectedTemplate]);

  const sampleCsv = useMemo(() => selectedTemplate?.csv || '', [selectedTemplate]);

  const runSync = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/fantasy/sync', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Sleeper sync failed');
      setNotice('Sleeper sync completed.');
      await load();
    } catch (err) {
      setError(err.message || 'Sleeper sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const importCsv = async () => {
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/fantasy/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          platform,
          csv_text: csvText,
          source_name: sourceName,
          league_id: leagueId,
          roster_name: rosterName,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'CSV import failed');
      setNotice(data.message);
      await load();
    } catch (err) {
      setError(err.message || 'CSV import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ display: 'grid', gap: 18, margin: '0 auto', maxWidth: 1180 }}>
        <div style={{ alignItems: 'flex-start', display: 'flex', gap: 16, justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0 }}>Sync Center</h1>
            <p style={{ color: '#667085', fontSize: 13, margin: '6px 0 0' }}>
              Sleeper sync, CSV imports, data freshness, and unsupported platform handoffs.
            </p>
          </div>
          <button
            type="button"
            onClick={runSync}
            disabled={syncing}
            style={{
              background: '#175cd3',
              border: '1px solid #175cd3',
              borderRadius: 7,
              color: '#fff',
              cursor: syncing ? 'wait' : 'pointer',
              fontWeight: 800,
              padding: '10px 14px',
            }}
          >
            {syncing ? 'Syncing...' : 'Refresh Sleeper'}
          </button>
        </div>

        {loading && <p>Loading...</p>}
        {error && <p style={{ color: '#b42318', fontWeight: 700 }}>{error}</p>}
        {notice && <p style={{ color: '#166534', fontWeight: 700 }}>{notice}</p>}

        {payload && (
          <>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <StatCard label="Football players" value={counts.players || 0} />
              <StatCard label="Leagues" value={counts.leagues || 0} />
              <StatCard label="Rosters" value={counts.rosters || 0} />
              <StatCard label="Baseball players" value={counts.baseball_players || 0} />
              <StatCard label="CSV imports" value={counts.import_history || 0} />
            </div>

            <section style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Freshness</h2>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                {payload.freshness.map((item) => (
                  <article key={item.source} style={{ border: '1px solid #edf0f5', borderRadius: 7, padding: 12 }}>
                    <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                      <strong>{item.source}</strong>
                      <StatusPill status={item.status} />
                    </div>
                    <p style={{ color: '#475467', fontSize: 13, margin: '8px 0 0' }}>{item.message}</p>
                    <p style={{ color: '#667085', fontSize: 12, margin: '4px 0 0' }}>
                      Updated {formatDate(item.updated_at)}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>CSV Import</h2>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Sport
                  <select value={sport} onChange={(e) => setSport(e.target.value)}>
                    <option value="football">Football</option>
                    <option value="baseball">Baseball</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Platform
                  <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                    {platformOptions.map((option) => (
                      <option key={option} value={option}>{option.toUpperCase()}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Source name
                  <input
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="League or export name"
                  />
                </label>
                {sport === 'football' ? (
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                    League ID
                    <input
                      value={leagueId}
                      onChange={(e) => setLeagueId(e.target.value)}
                      placeholder="manual-yahoo"
                    />
                  </label>
                ) : (
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                    Roster name
                    <input value={rosterName} onChange={(e) => setRosterName(e.target.value)} />
                  </label>
                )}
              </div>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={8}
                style={{
                  border: '1px solid #cfd5df',
                  borderRadius: 7,
                  boxSizing: 'border-box',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  marginTop: 12,
                  padding: 10,
                  width: '100%',
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                <button type="button" onClick={() => setCsvText(sampleCsv)}>
                  Load template
                </button>
                <button type="button" onClick={importCsv} disabled={importing || !csvText.trim()}>
                  {importing ? 'Importing...' : 'Import CSV'}
                </button>
              </div>
            </section>

            <section
              style={{
                display: 'grid',
                gap: 14,
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              }}
            >
              <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
                <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Recent Imports</h2>
                <div style={{ display: 'grid', gap: 10 }}>
                  {payload.recent_imports.length === 0 && (
                    <p style={{ color: '#667085', margin: 0 }}>No CSV imports recorded yet.</p>
                  )}
                  {payload.recent_imports.map((item) => (
                    <article
                      key={`${item.imported_at}-${item.platform}`}
                      style={{ borderBottom: '1px solid #edf0f5', paddingBottom: 10 }}
                    >
                      <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                        <strong>{item.source_name || item.platform}</strong>
                        <StatusPill status={item.status} />
                      </div>
                      <p style={{ color: '#475467', fontSize: 13, margin: '6px 0 0' }}>
                        {item.sport} / {item.platform} · {item.rows_imported} rows · {formatDate(item.imported_at)}
                      </p>
                      {item.message ? (
                        <p style={{ color: '#667085', fontSize: 12, margin: '4px 0 0' }}>{item.message}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16 }}>
                <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Platform Support</h2>
                <div style={{ display: 'grid', gap: 10 }}>
                  {payload.unsupported_platforms.map((item) => (
                    <article
                      key={`${item.platform}-${item.sport}`}
                      style={{ border: '1px solid #edf0f5', borderRadius: 7, padding: 12 }}
                    >
                      <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                        <strong>{item.platform}</strong>
                        <StatusPill status={item.status} />
                      </div>
                      <p style={{ color: '#667085', fontSize: 12, margin: '5px 0 0' }}>{item.sport}</p>
                      <p style={{ color: '#475467', fontSize: 13, margin: '6px 0 0' }}>{item.message}</p>
                    </article>
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
