function SkeletonLine({ width = '100%', height = 12, radius = 6 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        background: '#e4e7ec',
        borderRadius: radius,
        display: 'block',
        height,
        maxWidth: '100%',
        width,
      }}
    />
  );
}

function LoadingSkeleton({
  avatar = false,
  badge = true,
  rows = 3,
  metrics = 0,
  style = {},
}) {
  return (
    <article
      aria-hidden="true"
      style={{
        background: '#ffffff',
        border: '1px solid #d9dee7',
        borderRadius: 8,
        display: 'grid',
        gap: 12,
        padding: 16,
        ...style,
      }}
    >
      <div style={{ alignItems: 'start', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12, minWidth: 0, width: '100%' }}>
          {avatar && <SkeletonLine height={42} radius={8} width={42} />}
          <div style={{ display: 'grid', flex: 1, gap: 8, minWidth: 0 }}>
            <SkeletonLine height={16} width="62%" />
            <SkeletonLine width="38%" />
          </div>
        </div>
        {badge && <SkeletonLine height={24} radius={999} width={72} />}
      </div>

      {rows > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {Array.from({ length: rows }).map((_, index) => (
            <SkeletonLine key={index} width={index === rows - 1 ? '46%' : '100%'} />
          ))}
        </div>
      )}

      {metrics > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {Array.from({ length: metrics }).map((_, index) => (
            <div key={index} style={{ alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              <SkeletonLine width="42%" />
              <SkeletonLine width="24%" />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export default LoadingSkeleton;
