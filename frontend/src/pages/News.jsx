import { useCallback, useEffect, useMemo, useState } from 'react';
import LeagueSelector from '../components/LeagueSelector.jsx';

const POS_COLORS = {
  QB: { bg: '#e0f2fe', text: '#0369a1' },
  RB: { bg: '#d1fae5', text: '#065f46' },
  WR: { bg: '#fef3c7', text: '#92400e' },
  TE: { bg: '#ede9fe', text: '#5b21b6' },
};

const SENTIMENT_STYLES = {
  positive: { bg: '#dcfce7', text: '#166534', label: '+ Positive' },
  negative: { bg: '#fee2e2', text: '#991b1b', label: '- Negative' },
  neutral: { bg: '#f1f5f9', text: '#475569', label: '0 Neutral' },
};

/**
 * Detect severity from headline text and return a left-border color.
 * red   = Out / IR / Placed on IR
 * orange = Questionable / Doubtful
 * yellow = Limited
 * green  = Full / Cleared / Activated
 */
function severityColor(headline = '') {
  const h = headline.toLowerCase();
  if (/\bout\b|injured reserve|\bir\b|placed on ir|out for season|season-ending/.test(h)) {
    return '#f04438'; // red
  }
  if (/questionable|doubtful/.test(h)) {
    return '#f79009'; // orange
  }
  if (/limited/.test(h)) {
    return '#eaaa08'; // yellow
  }
  if (/full|cleared|activated|returns|back in/.test(h)) {
    return '#12b76a'; // green
  }
  return '#d9dee7'; // neutral gray
}

function formatTime(published_at) {
  if (!published_at) return '';
  try {
    const d = new Date(published_at);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return published_at;
  }
}

function playerTrendLabel(trend) {
  if (!trend) return '0 pos / 0 neg';
  return `${trend.positive} pos / ${trend.negative} neg`;
}

function NewsCard({ item, trend }) {
  const posColor = POS_COLORS[item.position] || { bg: '#f2f4f7', text: '#344054' };
  const border = severityColor(item.headline);
  const sentiment = SENTIMENT_STYLES[item.sentiment] || SENTIMENT_STYLES.neutral;

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #d9dee7',
        borderLeft: `4px solid ${border}`,
        borderRadius: 8,
        padding: '14px 16px',
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{item.player_name}</span>
        {item.position && (
          <span
            style={{
              background: posColor.bg,
              borderRadius: 4,
              color: posColor.text,
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 7px',
            }}
          >
            {item.position}
          </span>
        )}
        {item.team && (
          <span style={{ color: '#667085', fontSize: 12 }}>{item.team}</span>
        )}
        <span
          style={{
            background: sentiment.bg,
            borderRadius: 4,
            color: sentiment.text,
            fontSize: 11,
            fontWeight: 700,
            marginLeft: 'auto',
            padding: '2px 7px',
          }}
        >
          {sentiment.label}
        </span>
      </div>
      <div style={{ color: '#667085', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        Recent tone: {playerTrendLabel(trend)}
      </div>
      <p style={{ fontWeight: 600, margin: '0 0 4px', fontSize: 14 }}>{item.headline}</p>
      {item.detail && (
        <p style={{ color: '#667085', fontSize: 13, margin: '0 0 8px', lineHeight: 1.5 }}>
          {item.detail}
        </p>
      )}
      <p style={{ color: '#98a2b3', fontSize: 12, margin: 0 }}>
        {item.source && <span>{item.source} · </span>}
        {formatTime(item.published_at)}
      </p>
    </div>
  );
}

export default function News() {
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sentimentByPlayer = useMemo(() => {
    return news.reduce((acc, item) => {
      const key = item.sleeper_id || item.player_name || 'unknown';
      if (!acc[key]) {
        acc[key] = { positive: 0, negative: 0, neutral: 0 };
      }
      const sentiment = SENTIMENT_STYLES[item.sentiment] ? item.sentiment : 'neutral';
      acc[key][sentiment] += 1;
      return acc;
    }, {});
  }, [news]);

  const loadNews = useCallback(async (leagueId) => {
    setSelectedLeague(leagueId);
    setLoading(true);
    setError('');
    try {
      const url = leagueId ? `/fantasy/news?league_id=${leagueId}` : '/fantasy/news';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setNews(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNews(null);
  }, [loadNews]);

  return (
    <main style={{ background: '#f6f7fb', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 860 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 4px' }}>Player News & Injuries</h1>
          <p style={{ color: '#667085', margin: 0 }}>
            Latest news for your roster players
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <LeagueSelector onSelect={loadNews} />
        </div>

        {loading && <p style={{ color: '#667085' }}>Loading news...</p>}

        {error && (
          <div
            style={{
              background: '#fef3f2',
              border: '1px solid #fda29b',
              borderRadius: 8,
              color: '#b42318',
              padding: 16,
              marginBottom: 16,
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && news.length === 0 && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #d9dee7',
              borderRadius: 10,
              padding: 32,
              textAlign: 'center',
            }}
          >
            <p style={{ color: '#667085', fontSize: 15, margin: '0 0 8px' }}>
              No news items found.
            </p>
            <p style={{ color: '#98a2b3', fontSize: 13, margin: 0 }}>
              News syncs daily — check back after the next sync or trigger a manual sync via{' '}
              <a href="/fantasy/sync" style={{ color: '#3b5bdb' }}>/fantasy/sync</a>.
            </p>
          </div>
        )}

        {!loading && !error && news.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {news.map((item) => (
              <NewsCard
                key={item.id || `${item.sleeper_id}-${item.published_at}`}
                item={item}
                trend={sentimentByPlayer[item.sleeper_id || item.player_name || 'unknown']}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
