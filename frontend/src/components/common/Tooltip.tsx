/**
 * Tooltip.tsx — Viewport-aware floating tooltip positioned at mouse coordinates.
 *
 * Unlike CSS-only tooltips, this component adjusts its x/y position after
 * mounting to avoid overflowing the right edge or bottom of the viewport.
 * The offset is 15 px from the provided cursor coordinates; if the tooltip
 * would overflow it flips to the opposite side.
 *
 * Used by FloorMap to show asset details when hovering over placed asset icons.
 * Callers track mouse position and pass it directly as `x`/`y`.
 */
import React, { useState, useRef, useEffect } from 'react';
import styles from '../../styles/components/Tooltip.module.css';

interface TooltipProps {
  x: number;
  y: number;
  visible: boolean;
  children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ x, y, visible, children }) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tooltipRef.current || !visible) return;

    const tooltip = tooltipRef.current;
    const rect = tooltip.getBoundingClientRect();

    // Adjust position to keep tooltip in viewport
    let adjustedX = x + 15;
    let adjustedY = y + 15;

    if (adjustedX + rect.width > window.innerWidth) {
      adjustedX = x - rect.width - 15;
    }

    if (adjustedY + rect.height > window.innerHeight) {
      adjustedY = y - rect.height - 15;
    }

    setPosition({ x: adjustedX, y: adjustedY });
  }, [x, y, visible]);

  if (!visible) return null;

  return (
    <div
      ref={tooltipRef}
      className={styles.tooltip}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {children}
    </div>
  );
};

export default Tooltip;