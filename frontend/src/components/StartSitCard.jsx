import React from 'react';

function positionBadge(position, team) {
  return [position || 'FA', team].filter(Boolean).join(' / ');
}

function StartSitCard({ player, type }) {
  const isStart = type === 'start';
  const isWaiver = type === 'waiver';

  const borderColor = isStart ? '#027a48' : isWaiver ? '#004d99' : '#d9dee7'; // Green for Start, Blue for Waiver
  const backgroundColor = isStart ? '#ecfdf3' : isWaiver ? '#e0f2fe' : '#ffffff';
  const textColor = isStart ? '#027a48' : isWaiver ? '#004d99' : '#344054';

  return (
    <article
      style={{
        background: backgroundColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div>
        <strong style={{ color: '#101828' }}>{player.name}</strong>
        <div style={{ color: '#667085', fontSize: 13 }}>{positionBadge(player.position, player.team)}</div>
      </div>
      <div style={{ display: 'grid', gap: 2, justifyItems: 'end' }}>
        <strong style={{ color: '#101828' }}>{Number(player.adjusted_value || 0).toLocaleString()}</strong>
        <span
          style={{
            background: isStart ? '#d1fadf' : isWaiver ? '#bfdbfe' : '#f2f4f7',
            borderRadius: 999,
            color: textColor,
            fontSize: 12,
            fontWeight: 800,
            padding: '4px 8px',
          }}
        >
          {isStart ? 'START' : 'WAIVER'}
        </span>
      </div>
    </article>
  );
}

export default StartSitCard;
