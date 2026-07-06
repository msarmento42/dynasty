import React from 'react';

const StatcastPercentileChart = ({ metrics }) => {
  if (!metrics || metrics.length === 0) {
    return null;
  }

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: 10,
      padding: '16px 20px',
      marginBottom: 20,
    }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Statcast Percentiles
      </h3>
      <div style={{ display: 'grid', gap: 12 }}>
        {metrics.map((metric, index) => (
          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--text-primary)', minWidth: 80 }}>{metric.metricName}</span>
            <div style={{
              flexGrow: 1,
              height: 10,
              background: 'var(--bg-secondary)',
              borderRadius: 5,
              overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                width: `${metric.percentileValue}%`,
                height: '100%',
                background: 'var(--accent)',
                borderRadius: 5,
                transition: 'width 0.5s ease-in-out',
              }}></div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 30, textAlign: 'right' }}>{metric.percentileValue}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StatcastPercentileChart;
