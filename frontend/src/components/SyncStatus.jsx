import { useCallback, useEffect, useMemo, useState } from 'react';

function formatDate(value) {
  if (!value) return 'Never synced';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default function SyncStatus() {
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/fantasy/sync-status');
      if (!response.ok) throw new Error('Sync status is unavailable');
      setStatus(await response.json());
    } catch (err) {
      setError(err.message || 'Sync status is unavailable');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const runSync = async () => {
    setError('');
    setIsSyncing(true);

    try {
      const response = await fetch('/fantasy/sync', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Sync failed');
      setStatus(payload);
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const counts = status?.counts || {};
  const stateLabel = useMemo(() => {
    if (isLoading) return 'Checking local data';
    if (error) return 'Needs attention';
    if (status?.core_data_loaded) return 'Ready for local use';
    return 'Needs first sync';
  }, [error, isLoading, status]);

  return (
    <section className="sync-card" aria-label="Local sync status">
      <div className="sync-card-header">
        <span className={`status-dot${status?.core_data_loaded ? ' is-ready' : ''}`} />
        <div>
          <h2>Local Data</h2>
          <p>{stateLabel}</p>
        </div>
      </div>

      <dl className="sync-counts">
        <div>
          <dt>Players</dt>
          <dd>{counts.players ?? 0}</dd>
        </div>
        <div>
          <dt>Leagues</dt>
          <dd>{counts.leagues ?? 0}</dd>
        </div>
        <div>
          <dt>Rosters</dt>
          <dd>{counts.rosters ?? 0}</dd>
        </div>
        <div>
          <dt>Trades</dt>
          <dd>{counts.trade_history ?? 0}</dd>
        </div>
      </dl>

      <p className="sync-meta">
        Last sync: {formatDate(status?.last_sync?.ran_at)}
      </p>
      {status?.last_sync?.message ? <p className="sync-message">{status.last_sync.message}</p> : null}
      {error ? <p className="sync-error">{error}</p> : null}

      <div className="sync-actions">
        <button type="button" onClick={runSync} disabled={isSyncing}>
          {isSyncing ? 'Syncing...' : status?.needs_sync ? 'Run first sync' : 'Refresh data'}
        </button>
        <button type="button" className="secondary" onClick={loadStatus} disabled={isLoading || isSyncing}>
          Check
        </button>
      </div>
    </section>
  );
}
