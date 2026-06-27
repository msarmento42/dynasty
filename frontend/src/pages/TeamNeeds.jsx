import { useCallback, useState } from 'react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import LeagueSelector from '../components/LeagueSelector.jsx';

const TEAM_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#e11d48',
];

function gradeLabel(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function gradeColor(score) {
  if (score >= 70) return '#15803d';
  if (score >= 50) return '#ca8a04';
  return '#b42318';
}

function TeamRadarCard({ team, color }) {
  const axes = ['QB', 'RB', 'WR', 'TE', 'Picks'];
  const chartData = axes.map((key) => ({
    subject: key,
    value: team.grades[key] ?? 0,
    fullMark: 100,
  }));

  return (
    <div
      style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-color, #e0e0e0)',
        borderRadius: 10,
        padding: '16px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: color,
            flexShrink: 0,
          }}
        />
        <strong style={{ fontSize: 14, color: 'var(--text-primary, #1a1a2e)', lineHeight: 1.2 }}>
          {team.team_name}
        </strong>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
          <PolarGrid stroke="var(--border-color, #e0e0e0)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: 'var(--text-secondary, #666680)', fontSize: 12, fontWeight: 600 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={false}
            axisLine={false}
          />
          <Radar
            name={team.team_name}
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.25}
            strokeWidth={2}
          />
          <Tooltip
            formatter={(val) => [`${val} / 100`, 'Score']}
            contentStyle={{
              background: 'var(--bg-card, #fff)',
              border: '1px solid var(--border-color, #e0e0e0)',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', justifyContent: 'space-around' }}>
        {axes.map((key) => {
          const score = team.grades[key] ?? 0;
          return (
            <div key={key} style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 16,
                  color: gradeColor(score),
                }}
              >
                {gradeLabel(score)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary, #666680)' }}>{key}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TeamNeeds() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadTeamNeeds = useCallback(async (leagueId) => {
    if (!leagueId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/fantasy/league/${leagueId}/team-needs`);
      if (!res.ok) throw new Error('Unable to load team needs');
      setData(await res.json());
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <main style={{ background: 'var(--bg-primary, #f6f7fb)', minHeight: '100vh', padding: 24 }}>
      <section style={{ margin: '0 auto', maxWidth: 1200 }}>
        <div style={{ display: 'grid', gap: 18, marginBottom: 24 }}>
          <h1 style={{ margin: 0, color: 'var(--text-primary, #1a1a2e)' }}>Team Needs</h1>
          <p style={{ color: 'var(--text-secondary, #667085)', margin: 0 }}>
            Positional strength grades (A–F) based on dynasty roster value relative to the league.
          </p>
          <LeagueSelector onSelect={loadTeamNeeds} />
        </div>

        {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>}
        {error && <p style={{ color: '#b42318' }}>{error}</p>}

        {data && !loading && (
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            }}
          >
            {data.map((team, idx) => (
              <TeamRadarCard
                key={team.roster_id}
                team={team}
                color={TEAM_COLORS[idx % TEAM_COLORS.length]}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
