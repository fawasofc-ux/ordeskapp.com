import React, { useEffect, useRef, useState } from 'react';
import { fmtCompact, fmtFull } from '../format.js';

const ACCENTS = {
  cyan: ['#29e0ff', 'rgba(41,224,255,0.4)'],
  green: ['#39ff8e', 'rgba(57,255,142,0.4)'],
  red: ['#ff4d6d', 'rgba(255,77,109,0.4)'],
  amber: ['#ffc247', 'rgba(255,194,71,0.4)'],
  violet: ['#b388ff', 'rgba(179,136,255,0.4)'],
};

// Animates value changes with a count-up and a glow pulse on the card.
function useCountUp(target, duration = 700) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

export default function KpiCard({ label, value, accent = 'cyan', caption, badge, hero = false }) {
  const display = useCountUp(value);
  const [pulse, setPulse] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 900);
    return () => clearTimeout(t);
  }, [value]);

  const [color, glow] = ACCENTS[accent] || ACCENTS.cyan;
  return (
    <div className={`kpi${hero ? ' hero' : ''}${pulse ? ' pulse' : ''}`} style={{ '--accent': color, '--glow': glow }}>
      <div className="label">{label}</div>
      <div className="value" title={fmtFull(value)}>{fmtCompact(display)}</div>
      {(caption || badge) && (
        <div className="caption">
          {badge} {caption}
        </div>
      )}
    </div>
  );
}
