import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || '';

export default function WeeklyAssistant() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = () => {
    fetch(`${API}/api/baseball/weekly-assistant`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load weekly assistant');
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const refreshInjuryStatus = async () => {
    setRefreshing(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/baseball/roster/refresh-injury-status`, { method: 'POST' });
      if (!res.ok) throw new Error('Refresh failed');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!data) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: 700, margin: '20px auto' }}>
      <h2>⚾ Weekly Roster Assistant</h2>

      <section style={{ marginBottom: 24 }}>
        <h3>Start / Sit</h3>
        <p style={{ fontSize: '0.8rem', color: '#666' }}>
          Ranking basis: {data.start_sit.ranking_basis}
        </p>
        <h4>Start</h4>
        <ul>
          {data.start_sit.start.length === 0 && <li>No pitchers on your roster</li>}
          {data.start_sit.start.map((p) => (
            <li key={p.mlb_id}>
              {p.name} ({p.position}, {p.team}) — value {p.dynasty_value}
            </li>
          ))}
        </ul>
        <h4>Bench / Stream Watch</h4>
        <ul>
          {data.start_sit.bench_or_stream.map((p) => (
            <li key={p.mlb_id}>
              {p.name} ({p.position}, {p.team}) — value {p.dynasty_value}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h3>IL Monitor</h3>
        <button onClick={refreshInjuryStatus} disabled={refreshing} style={{ marginBottom: 8 }}>
          {refreshing ? 'Checking MLB Stats API...' : 'Refresh injury status'}
        </button>
        <p style={{ fontSize: '0.75rem', color: '#666' }}>{data.il_monitor.note}</p>
        {data.il_monitor.players && data.il_monitor.players.length > 0 ? (
          <ul>
            {data.il_monitor.players.map((p) => (
              <li key={p.mlb_id} style={{ color: '#b54708' }}>
                {p.name} ({p.position}, {p.team}) — {p.injury_status}
              </li>
            ))}
          </ul>
        ) : (
          <p>No players currently flagged. Hit refresh if this hasn't been checked recently.</p>
        )}
      </section>

      <section style={{ opacity: 0.7 }}>
        <h3>FAAB Targets</h3>
        <p style={{ fontSize: '0.85rem' }}>
          Not available yet — {data.faab_targets.reason}.
        </p>
      </section>
    </div>
  );
}
