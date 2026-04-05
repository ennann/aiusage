interface ZoomIndicatorProps {
  zoomLevel: number;
  isVisible: boolean;
  position: { x: number; y: number } | null;
}

export const ZoomIndicator = ({ zoomLevel, isVisible, position }: ZoomIndicatorProps) => {
  if (!isVisible || !position) return null;

  const percentage = Math.round(zoomLevel * 100);

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div
        className="px-4 py-2 rounded-full bg-black/70 backdrop-blur-md text-white text-sm font-medium shadow-lg"
        style={{
          animation: 'zoom-badge-enter 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {percentage}%
      </div>
    </div>
  );
};
