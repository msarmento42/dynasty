import { useEffect, useState } from 'react';

const API = '/api';

function ValueBadge({ winner, side, delta }) {
  const isWinner = winner === side;
  const isFair = winner === 'fair';
  if (isFair) return <span className="th-badge th-badge--fair">FAIR</span>;
  if (isWinner) return <span className="th-badge th-badge--win">WIN +{Math.abs(delta)}</span>;
  return <span className="th-badge th-badge--loss">LOSS -{Math.abs(delta)}</span>;
}

function PickLabel({ pick }) {
  const round = pick.round ? `Round ${pick.round}` : 'Pick';
  const year = pick.season || pick.year || '';
  const orig = pick.original_owner_id ? ` (${pick.original_owner_id})` : '';
  return <span className="th-pick">{year} {round}{orig}</span>;
}

function TradeSide({ side, sideKey, winner, delta }) {
  return (
    <div className="th-side">
      <div className="th-owner">
        {side.owner}
        <ValueBadge winner={winner} side={sideKey} delta={delta} />
      </div>
      <div className="th-assets">
        {side.players.map((p, i) => (
          <span key={i} className={`th-player th-player--${(p.position || 'UNK').toLowerCase()}`}>
            {p.name}
            {p.position && <span className="th-pos">{p.position}</span>}
          </span>
        ))}
        {side.picks.map((pick, i) => (
          <PickLabel key={i} pick={pick} />
        ))}
        {side.players.length === 0 && side.picks.length === 0 && (
          <span className="th-empty">No assets</span>
        )}
      </div>
      {side.total_value > 0 && (
        <div className="th-value">Value: {side.total_value.toLocaleString()}</div>
      )}
    </div>
  );
}

function TradeCard({ trade }) {
  const date = trade.traded_at
    ? new Date(typeof trade.traded_at === 'number'
        ? trade.traded_at
        : trade.traded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : `Week ${trade.week}, ${trade.season}`;

  return (
    <div className="th-card">
      <div className="th-card-header">
        <span className="th-date">{date}</span>
        {trade.week && <span className="th-week">Week {trade.week}</span>}
      </div>
      <div className="th-sides">
        <TradeSide side={trade.side_a} sideKey="side_a" winner={trade.winner} delta={Math.abs(trade.value_delta)} />
        <div className="th-vs">⇄</div>
        <TradeSide side={trade.side_b} sideKey="side_b" winner={trade.winner} delta={Math.abs(trade.value_delta)} />
      </div>
    </div>
  );
}

export default function TradeHistory() {
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState('');
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/fantasy/leagues`)
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.leagues || []);
        setLeagues(list);
        if (list.length > 0) setLeagueId(list[0].league_id);
      })
      .catch(() => setError('Failed to load leagues'));
  }, []);

  useEffect(() => {
    if (!leagueId) return;
    setLoading(true);
    setError('');
    fetch(`${API}/fantasy/league/${leagueId}/trade-history?limit=50`)
      .then(r => r.json())
      .then(data => {
        setTrades(data.trades || []);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load trade history');
        setLoading(false);
      });
  }, [leagueId]);

  return (
    <div className="th-root">
      <div className="page-header">
        <h2>Trade History</h2>
        {leagues.length > 1 && (
          <select
            className="league-select"
            value={leagueId}
            onChange={e => setLeagueId(e.target.value)}
          >
            {leagues.map(l => (
              <option key={l.league_id} value={l.league_id}>{l.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading && <p className="th-status">Loading trades…</p>}
      {error && <p className="th-status th-status--error">{error}</p>}

      {!loading && !error && trades.length === 0 && (
        <p className="th-status">No trades found for this league. Run a sync to populate trade history.</p>
      )}

      {!loading && trades.length > 0 && (
        <div className="th-timeline">
          {trades.map(trade => (
            <div key={trade.trade_id} className="th-timeline-item">
              <div className="th-connector" />
              <TradeCard trade={trade} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
