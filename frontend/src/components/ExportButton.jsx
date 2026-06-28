import React from 'react';

const ExportButton = ({ players }) => {
  const handleExport = () => {
    if (!players || players.length === 0) {
      alert('No players to export.');
      return;
    }

    const headers = [
      'name',
      'position',
      'team',
      'age',
      'adjusted_value',
      'career_stage',
      'trajectory',
      'trend_30d',
    ];

    const csvRows = [];
    csvRows.push(headers.join(',')); // Add headers

    for (const player of players) {
      const values = headers.map((header) => {
        const value = player[header];
        // Handle potential commas, newlines, or double quotes in string values by quoting them
        if (typeof value === 'string' && (value.includes(',') || value.includes('\n') || value.includes('"')) ) {
          return `"${value.replace(/"/g, '""')}"`; // Escape double quotes within the string
        }
        return value;
      });
      csvRows.push(values.join(','));
    }

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'roster.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href); // Clean up the object URL
  };

  return (
    <button
      onClick={handleExport}
      style={{
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #d0d5dd',
        background: '#ffffff',
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 500,
        color: '#344054',
        whiteSpace: 'nowrap',
      }}
    >
      Export CSV
    </button>
  );
};

export default ExportButton;
