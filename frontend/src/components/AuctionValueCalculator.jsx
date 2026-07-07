import React, { useState, useEffect, useCallback } from 'react';

const DEFAULT_POS_ALLOCATION = {
  QB: 0.10,
  RB: 0.35,
  WR: 0.40,
  TE: 0.10,
  K: 0.02,
  DEF: 0.03,
};

const DEFAULT_POS_COUNT_PER_TEAM = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DEF: 1,
};

function AuctionValueCalculator() {
  const [leagueSize, setLeagueSize] = useState(12);
  const [totalBudgetPerTeam, setTotalBudgetPerTeam] = useState(200);
  const [rosterSpotsPerTeam, setRosterSpotsPerTeam] = useState(16); // Input, but not directly used in simple avg value calc
  const [posAllocation, setPosAllocation] = useState(DEFAULT_POS_ALLOCATION);
  const [calculatedValues, setCalculatedValues] = useState({});

  const calculateValues = useCallback(() => {
    const totalLeagueBudget = leagueSize * totalBudgetPerTeam;
    const newCalculatedValues = {};

    let totalAllocatedPercentage = 0;
    for (const pos in posAllocation) {
      totalAllocatedPercentage += posAllocation[pos];
    }

    // Normalize percentages if they don't sum to 1, or fall back to default if sum is 0
    const normalizedPosAllocation = {};
    if (totalAllocatedPercentage > 0) {
      for (const pos in posAllocation) {
        normalizedPosAllocation[pos] = posAllocation[pos] / totalAllocatedPercentage;
      }
    } else {
      Object.assign(normalizedPosAllocation, DEFAULT_POS_ALLOCATION);
    }

    for (const pos in normalizedPosAllocation) {
      const posBudget = totalLeagueBudget * normalizedPosAllocation[pos];
      const estimatedPlayers = DEFAULT_POS_COUNT_PER_TEAM[pos] * leagueSize;
      const avgValuePerPlayer = estimatedPlayers > 0 ? posBudget / estimatedPlayers : 0;

      newCalculatedValues[pos] = {
        budget: posBudget,
        avgValue: avgValuePerPlayer,
        estimatedPlayers: estimatedPlayers,
      };
    }
    setCalculatedValues(newCalculatedValues);
  }, [leagueSize, totalBudgetPerTeam, posAllocation]);

  useEffect(() => {
    calculateValues();
  }, [calculateValues]);

  const handleAllocationChange = (pos, value) => {
    const newValue = parseFloat(value) / 100 || 0;
    setPosAllocation(prev => ({ ...prev, [pos]: newValue }));
  };

  return (
    <div style={{ padding: '20px', background: '#fff', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Auction Value Settings</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 30 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 5, fontSize: 14, fontWeight: 600, color: '#475467' }}>League Size</label>
          <input
            type="number"
            value={leagueSize}
            onChange={(e) => setLeagueSize(Math.max(1, parseInt(e.target.value) || 0))}
            min="1"
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 5, fontSize: 14, fontWeight: 600, color: '#475467' }}>Total Budget Per Team ($)</label>
          <input
            type="number"
            value={totalBudgetPerTeam}
            onChange={(e) => setTotalBudgetPerTeam(Math.max(1, parseInt(e.target.value) || 0))}
            min="1"
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 5, fontSize: 14, fontWeight: 600, color: '#475467' }}>Roster Spots Per Team</label>
          <input
            type="number"
            value={rosterSpotsPerTeam}
            onChange={(e) => setRosterSpotsPerTeam(Math.max(1, parseInt(e.target.value) || 0))}
            min="1"
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          />
        </div>
      </div>

      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 15 }}>Positional Budget Allocation (%)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 15, marginBottom: 30 }}>
        {Object.entries(posAllocation).map(([pos, percent]) => (
          <div key={pos}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 13, fontWeight: 600, color: '#475467' }}>{pos}</label>
            <input
              type="number"
              value={(percent * 100).toFixed(0)}
              onChange={(e) => handleAllocationChange(pos, e.target.value)}
              min="0"
              max="100"
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
            />
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 15 }}>Calculated Values (Per Player)</h3>
      <div style={{ border: '1px solid #e4e7ec', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', background: '#f8fafc', fontWeight: 700, padding: '10px 15px', borderBottom: '1px solid #e4e7ec' }}>
          <div style={{ flex: 1 }}>Position</div>
          <div style={{ flex: 1, textAlign: 'right' }}>Avg. Value</div>
        </div>
        {Object.entries(calculatedValues).map(([pos, data]) => (
          <div key={pos} style={{ display: 'flex', padding: '8px 15px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ flex: 1, color: '#475467', fontSize: 14 }}>{pos}</div>
            <div style={{ flex: 1, textAlign: 'right', color: '#1d4ed8', fontSize: 14, fontWeight: 600 }}>
              ${data.avgValue.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AuctionValueCalculator;
