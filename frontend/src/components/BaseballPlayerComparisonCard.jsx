import React from 'react';
import { LevelBadge, PosBadge } from '../pages/baseball/BaseballHome'; // Reusing badges from BaseballHome

export default function BaseballPlayerComparisonCard({ player, onRemove }) {
  if (!player) {
    return (
      <div style={cardStyle}>
        <div style={placeholderHeaderStyle}>Select a player</div>
        <div style={placeholderContentStyle}>
          Search for a player to add them to the comparison.
        </div>
      </div>
    );
  }

  // Mock stats and dynasty values for demonstration
  const mockStats = {
    'AVG/ERA': player.position && ['SP', 'RP', 'P'].includes(player.position) ? '3.50' : '.280',
    'HR/WHIP': player.position && ['SP', 'RP', 'P'].includes(player.position) ? '1.20' : '30',
    'RBI/K': player.position && ['SP', 'RP', 'P'].includes(player.position) ? '200' : '90',
    'SB/SV': player.position && ['SP', 'RP', 'P'].includes(player.position) ? '30' : '15',
  };

  const mockDynastyValues = {
    'Dynasty Rank': 'Top 50',
    'Future Value': '70',
    'Risk': 'Medium',
  };

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LevelBadge level={player.level || 'MLB'} />
          <h3 style={playerNameStyle}>{player.name}</h3>
        </div>
        {onRemove && (
          <button onClick={() => onRemove(player.mlb_id)} style={removeButtonStyle}>
            &times;
          </button>
        )}
      </div>
      <div style={playerInfoStyle}>
        <PosBadge pos={player.position} />
        <span style={playerDetailStyle}>{player.team || 'Free Agent'}</span>
        {player.age && <span style={playerDetailStyle}>Age {player.age}</span>}
      </div>

      <div style={sectionStyle}>
        <h4 style={sectionTitleStyle}>Key Stats</h4>
        {Object.entries(mockStats).map(([key, value]) => (
          <div key={key} style={statRowStyle}>
            <span style={statLabelStyle}>{key}:</span>
            <span style={statValueStyle}>{value}</span>
          </div>
        ))}
      </div>

      <div style={sectionStyle}>
        <h4 style={sectionTitleStyle}>Dynasty Values</h4>
        {Object.entries(mockDynastyValues).map(([key, value]) => (
          <div key={key} style={statRowStyle}>
            <span style={statLabelStyle}>{key}:</span>
            <span style={statValueStyle}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Basic inline styles for the card
const cardStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 10,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 280,
  flex: 1,
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
};

const playerNameStyle = {
  margin: 0,
  fontSize: 20,
  color: 'var(--text-primary)',
};

const removeButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--text-secondary)',
  fontSize: 24,
  cursor: 'pointer',
  padding: '0 5px',
};

const playerInfoStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 10,
};

const playerDetailStyle = {
  color: 'var(--text-secondary)',
  fontSize: 14,
};

const sectionStyle = {
  marginTop: 10,
  paddingTop: 10,
  borderTop: '1px solid var(--border-color-light)',
};

const sectionTitleStyle = {
  margin: '0 0 10px 0',
  fontSize: 16,
  color: 'var(--text-primary)',
};

const statRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: 6,
};

const statLabelStyle = {
  color: 'var(--text-secondary)',
  fontSize: 14,
};

const statValueStyle = {
  fontWeight: 600,
  color: 'var(--text-primary)',
  fontSize: 14,
};

const placeholderHeaderStyle = {
  fontSize: 20,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 10,
};

const placeholderContentStyle = {
  color: 'var(--text-secondary)',
  fontSize: 14,
};
