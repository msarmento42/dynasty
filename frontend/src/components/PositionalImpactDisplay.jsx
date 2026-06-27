function formatDelta(value) {
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function deltaColor(value) {
  if (value > 0) {
    return '#047857';
  }
  if (value < 0) {
    return '#b42318';
  }
  return '#475467';
}

export default function PositionalImpactDisplay({ impact }) {
  const positions = impact?.positions || [];

  if (positions.length === 0) {
    return null;
  }

  return (
    <section style={{ borderTop: '1px solid #e4e7ec', paddingTop: 12 }}>
      <strong>Positional impact</strong>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {positions.map((item) => (
          <div
            key={item.position}
            style={{
              alignItems: 'center',
              border: '1px solid #e4e7ec',
              borderRadius: 8,
              display: 'grid',
              gap: 8,
              gridTemplateColumns: '52px 1fr 1fr',
              padding: '8px 10px',
            }}
          >
            <strong>{item.position}</strong>
            <span style={{ color: deltaColor(item.you), fontWeight: 700 }}>
              You {formatDelta(item.you)}
            </span>
            <span style={{ color: deltaColor(item.them), fontWeight: 700 }}>
              Them {formatDelta(item.them)}
            </span>
          </div>
        ))}
      </div>
      <p style={{ color: '#667085', fontSize: 13, marginBottom: 0 }}>
        Positive numbers mean that side gains depth at the position after the trade.
      </p>
    </section>
  );
}
