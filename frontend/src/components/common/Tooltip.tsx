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