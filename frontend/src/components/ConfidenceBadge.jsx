const COLORS = {
  high: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  medium: { bg: '#fef3c7', border: '#facc15', text: '#92400e' },
  low: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
};

export default function ConfidenceBadge({ confidence }) {
  const level = confidence?.level || 'low';
  const colors = COLORS[level] || COLORS.low;
  const warnings = confidence?.warnings || [];
  const title = warnings.length > 0 ? warnings.join('; ') : confidence?.source || 'Data confidence';

  return (
    <span
      title={title}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        color: colors.text,
        display: 'inline-flex',
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        padding: '5px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {confidence?.label || level}
    </span>
  );
}
