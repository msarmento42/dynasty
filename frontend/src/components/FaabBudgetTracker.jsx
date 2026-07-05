import React, { useState, useEffect } from 'react';

function FaabBudgetTracker() {
  // Initialize state from localStorage or default values
  const [totalBudget, setTotalBudget] = useState(() => {
    const savedTotal = localStorage.getItem('faabTotalBudget');
    return savedTotal ? parseFloat(savedTotal) : 100; // Default FAAB budget
  });
  const [spentBudget, setSpentBudget] = useState(() => {
    const savedSpent = localStorage.getItem('faabSpentBudget');
    return savedSpent ? parseFloat(savedSpent) : 0;
  });

  // Save to localStorage whenever totalBudget or spentBudget changes
  useEffect(() => {
    localStorage.setItem('faabTotalBudget', totalBudget.toString());
  }, [totalBudget]);

  useEffect(() => {
    localStorage.setItem('faabSpentBudget', spentBudget.toString());
  }, [spentBudget]);

  const remainingBudget = totalBudget - spentBudget;

  const handleTotalBudgetChange = (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setTotalBudget(value);
    }
  };

  const handleSpentBudgetChange = (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setSpentBudget(value);
    }
  };

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #d9dee7',
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <h3 style={{ margin: 0, fontSize: 16, color: '#101828' }}>FAAB Budget Tracker</h3>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <label htmlFor="total-faab" style={{ fontSize: 14, color: '#344054', whiteSpace: 'nowrap' }}>Total Budget:</label>
        <input
          id="total-faab"
          type="number"
          min="0"
          step="1"
          value={totalBudget}
          onChange={handleTotalBudgetChange}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid #d0d5dd',
            width: '100%',
            maxWidth: 100,
            fontSize: 14,
            textAlign: 'right',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <label htmlFor="spent-faab" style={{ fontSize: 14, color: '#344054', whiteSpace: 'nowrap' }}>Spent Budget:</label>
        <input
          id="spent-faab"
          type="number"
          min="0"
          step="1"
          value={spentBudget}
          onChange={handleSpentBudgetChange}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid #d0d5dd',
            width: '100%',
            maxWidth: 100,
            fontSize: 14,
            textAlign: 'right',
          }}
        />
      </div>
      <div style={{
        borderTop: '1px solid #eaecf0',
        paddingTop: 12,
        marginTop: 8,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <strong style={{ fontSize: 16, color: '#101828' }}>Remaining FAAB:</strong>
        <span style={{ fontSize: 18, fontWeight: 600, color: remainingBudget >= 0 ? '#027a48' : '#b42318' }}>
          ${remainingBudget.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export default FaabBudgetTracker;
