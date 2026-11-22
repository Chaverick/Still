interface EdgeGlowProps {
  active: boolean;
}

export function EdgeGlow({ active }: EdgeGlowProps) {
  return (
    <div
      className={`edge-glow ${active ? 'edge-glow--active' : ''}`}
      aria-hidden="true"
    />
  );
}
