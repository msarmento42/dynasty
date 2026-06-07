const GRADE_COLORS = {
  A: { background: '#dcfce7', border: '#16a34a', color: '#166534' },
  B: { background: '#fef9c3', border: '#ca8a04', color: '#854d0e' },
  C: { background: '#fef9c3', border: '#ca8a04', color: '#854d0e' },
  D: { background: '#fee2e2', border: '#dc2626', color: '#991b1b' },
  F: { background: '#fee2e2', border: '#dc2626', color: '#991b1b' },
};

function tooltipText(grade) {
  const breakdown = grade?.breakdown || {};
  return [
    `Score: ${grade?.score ?? 'N/A'}`,
    `Total value: ${Number(breakdown.total_value || 0).toLocaleString()}`,
    `Average age: ${breakdown.average_age || 'N/A'}`,
    `Balance: ${breakdown.balance_score ?? 'N/A'}`,
    `Future capital: ${breakdown.future_capital_score ?? 'N/A'}`,
  ].join('\n');
}

export default function RosterGrade({ grade }) {
  if (!grade) {
    return null;
  }

  const colors = GRADE_COLORS[grade.letter] || GRADE_COLORS.C;

  return (
    <div
      title={tooltipText(grade)}
      style={{
        alignItems: 'center',
        background: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        color: colors.color,
        display: 'inline-flex',
        gap: 8,
        minHeight: 44,
        padding: '8px 12px',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 800 }}>Dynasty Grade</span>
      <strong style={{ fontSize: 24, lineHeight: 1 }}>{grade.letter}</strong>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{Number(grade.score || 0).toFixed(1)}</span>
    </div>
  );
}
