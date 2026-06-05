const COLORS = {
  WIN: { background: '#dcfce7', color: '#166534' },
  FAIR: { background: '#fef9c3', color: '#854d0e' },
  LOSS: { background: '#fee2e2', color: '#991b1b' },
};

export default function VerdictChip({ verdict }) {
  const normalized = verdict || 'FAIR';
  const colors = COLORS[normalized] || COLORS.FAIR;

  return (
    <span
      style={{
        ...colors,
        borderRadius: 999,
        display: 'inline-flex',
        fontSize: 12,
        fontWeight: 800,
        padding: '4px 9px',
      }}
    >
      {normalized}
    </span>
  );
}
