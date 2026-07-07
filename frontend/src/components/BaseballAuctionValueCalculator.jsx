import React, { useState, useEffect } from 'react';

const BaseballAuctionValueCalculator = () => {
  const [leagueSize, setLeagueSize] = useState(12);
  const [totalBudgetPerTeam, setTotalBudgetPerTeam] = useState(260); // Standard $260 budget
  const [rosterSettings, setRosterSettings] = useState({
    C: 1,
    '1B': 1,
    '2B': 1,
    'SS': 1,
    '3B': 1,
    OF: 3,
    UTIL: 1,
    SP: 5,
    RP: 3,
    Bench: 5, // Bench spots are typically $1 players, so we'll account for them differently
  });
  const [calculatedValues, setCalculatedValues] = useState({});

  useEffect(() => {
    calculateAuctionValues();
  }, [leagueSize, totalBudgetPerTeam, rosterSettings]);

  const calculateAuctionValues = () => {
    const totalLeagueBudget = leagueSize * totalBudgetPerTeam;

    // Account for $1 players (bench)
    const oneDollarPlayersCount = leagueSize * rosterSettings.Bench;
    const budgetForOneDollarPlayers = oneDollarPlayersCount * 1;
    const effectiveBudgetForStarters = totalLeagueBudget - budgetForOneDollarPlayers;

    if (effectiveBudgetForStarters <= 0) {
      setCalculatedValues({});
      return;
    }

    // Define relative value scores for each position. These are subjective.
    // Higher score means more valuable/scarce.
    const relativePositionalScores = {
      C: 1.0,
      '1B': 1.8,
      '2B': 1.5,
      'SS': 2.0,
      '3B': 1.8,
      OF: 1.7, // Average for one OF spot
      UTIL: 1.2,
      SP: 2.5, // SPs are often the most valuable
      RP: 1.0, // RPs can be valuable but often less than SPs
    };

    let totalWeightedScore = 0;
    for (const pos in relativePositionalScores) {
      if (rosterSettings[pos] && rosterSettings[pos] > 0) {
        // Sum up the weighted score for all players at this position across the league
        totalWeightedScore += relativePositionalScores[pos] * rosterSettings[pos] * leagueSize;
      }
    }

    if (totalWeightedScore === 0) {
      setCalculatedValues({});
      return;
    }

    const values = {};
    for (const pos in relativePositionalScores) {
      if (rosterSettings[pos] && rosterSettings[pos] > 0) {
        // Calculate the total value for all players at this position in the league
        const totalValueForPosition = (relativePositionalScores[pos] * rosterSettings[pos] * leagueSize / totalWeightedScore) * effectiveBudgetForStarters;
        // Divide by the number of players at this position in the league to get average per player
        const playersAtPositionInLeague = leagueSize * rosterSettings[pos];
        values[pos] = Math.round(totalValueForPosition / playersAtPositionInLeague);
      }
    }
    values['Bench'] = 1; // Bench players are typically $1

    setCalculatedValues(values);
  };

  const handleRosterChange = (pos, value) => {
    setRosterSettings(prev => ({ ...prev, [pos]: Math.max(0, Number(value)) }));
  };

  return (
    <div style={{ maxWidth: 600, margin: '20px auto', padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <h3>⚾ Baseball Auction Value Calculator</h3>
      <p style={{ fontSize: '0.9rem', color: '#555' }}>
        Estimate auction dollar values for your league based on settings.
      </p>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
          League Size:
          <input
            type="number"
            min="4"
            max="20"
            value={leagueSize}
            onChange={(e) => setLeagueSize(Number(e.target.value))}
            style={{ marginLeft: '10px', padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </label>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
          Total Auction Budget per Team ($):
          <input
            type="number"
            min="100"
            max="500"
            step="10"
            value={totalBudgetPerTeam}
            onChange={(e) => setTotalBudgetPerTeam(Number(e.target.value))}
            style={{ marginLeft: '10px', padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </label>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ marginBottom: '10px' }}>Roster Spots per Team:</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {Object.entries(rosterSettings).map(([pos, count]) => (
            <label key={pos} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {pos}:
              <input
                type="number"
                min="0"
                max="10"
                value={count}
                onChange={(e) => handleRosterChange(pos, e.target.value)}
                style={{ width: '60px', padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </label>
          ))}
        </div>
      </div>

      <h4 style={{ marginTop: '20px' }}>Calculated Average Auction Values:</h4>
      {Object.keys(calculatedValues).length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #ddd' }}>Position</th>
              <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #ddd' }}>Avg. Value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(calculatedValues).map(([pos, value]) => (
              <tr key={pos}>
                <td style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #eee' }}>{pos}</td>
                <td style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #eee' }}>${value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Adjust settings to calculate values.</p>
      )}
    </div>
  );
};

export default BaseballAuctionValueCalculator;
