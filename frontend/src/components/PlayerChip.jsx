import { getPositionColor, getTeamColor } from '../styles/designSystem.js';

/**
 * Small inline position/team badge — the first building block of the #186
 * design system. Not a full PlayerCard (that's a larger follow-up); this is
 * just a color-coded chip meant to replace bare "{position}" text cells.
 */
export default function PlayerChip({ position, team }) {
  const posColor = getPositionColor(position);
  const teamColor = team ? getTeamColor(team) : null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          backgroundColor: posColor.bg,
          color: posColor.text,
          border: `1px solid ${posColor.border}`,
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: '0.75rem',
          fontWeight: 700,
        }}
      >
        {position || '—'}
      </span>
      {team && (
        <span
          title={team}
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: teamColor,
          }}
        />
      )}
    </span>
  );
}
