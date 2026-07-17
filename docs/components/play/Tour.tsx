'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

export interface TourStep {
  // Matches a `data-tour="<target>"` attribute somewhere in the DOM.
  target: string;
  title: string;
  description: string;
}

// A spotlight walkthrough: dims the whole screen except a box drawn around
// the current step's target element (found live via its data-tour
// attribute, so this never needs refs threaded through NotationColumn /
// AnalyzeSidebar), with a small card explaining it. Purely presentational —
// step index and open/close state are owned by the caller.
export default function Tour({
  steps,
  stepIdx,
  onStepChange,
  onClose,
}: {
  steps: TourStep[];
  stepIdx: number;
  onStepChange: (idx: number) => void;
  onClose: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[stepIdx];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    const r = el?.getBoundingClientRect();
    // A display:none target (e.g. inside the mobile collapse while it's
    // closed) measures 0x0 at the origin — treat that as "not found" so
    // we show the plain dimmed backdrop instead of a broken spotlight.
    setRect(r && r.width > 0 && r.height > 0 ? r : null);
  }, [step]);

  // Measure synchronously the instant the step changes (same render pass
  // as the card's new title/description), then kick off scrollIntoView —
  // the scroll listener below keeps `rect` (and the spotlight box) tracking
  // live as the smooth-scroll plays out, instead of freezing the box at its
  // old position for a few hundred ms while the text has already updated.
  useEffect(() => {
    if (!step) return;
    measure();
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [step, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onStepChange(Math.min(steps.length - 1, stepIdx + 1));
      else if (e.key === 'ArrowLeft') onStepChange(Math.max(0, stepIdx - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onStepChange, stepIdx, steps.length]);

  if (!step) return null;

  const isLast = stepIdx === steps.length - 1;
  const PAD = 8;
  const GAP = 16;

  // Card placement. Desktop: to the right of the box when the box sits in
  // the left half of the screen (the left panel's controls), to the left
  // when it sits in the right half — always opening toward the board's
  // open space. Narrow screens (sections stack full-width, no side room
  // for a 300px card): below the box, or above via bottom-anchoring when
  // there's no room underneath.
  const cardW = 300;
  const cardMaxH = 260;
  let cardStyle: CSSProperties = {};
  if (rect) {
    const narrow = window.innerWidth < 768;
    if (narrow) {
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - cardW / 2, window.innerWidth - cardW - 12));
      const spaceBelow = window.innerHeight - rect.bottom;
      cardStyle = spaceBelow > cardMaxH + GAP
        ? { top: rect.bottom + GAP, left }
        : { bottom: Math.min(window.innerHeight - rect.top + GAP, window.innerHeight - cardMaxH - 12), left };
    } else {
      const boxCenterX = rect.left + rect.width / 2;
      const onLeftHalf = boxCenterX < window.innerWidth / 2;
      const cardTop = Math.max(12, Math.min(rect.top, window.innerHeight - cardMaxH - 12));
      cardStyle = onLeftHalf
        ? { top: cardTop, left: Math.min(rect.right + GAP, window.innerWidth - cardW - 12) }
        : { top: cardTop, right: Math.min(window.innerWidth - rect.left + GAP, window.innerWidth - cardW - 12) };
    }
  }

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Spotlight — a box-shadow with a huge spread doubles as both the
          dimmed backdrop and the cut-out, so the highlighted element stays
          at full brightness/interactivity without a 4-panel overlay. */}
      {rect ? (
        <div
          className="fixed rounded-[8px] pointer-events-none transition-all duration-300 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(10,11,8,0.72)',
            border: '2px solid var(--pear)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(10,11,8,0.72)] transition-opacity duration-300" />
      )}

      {/* Click-catcher behind the card so stray clicks on the dimmed area
          don't fall through to the app underneath. */}
      <div className="fixed inset-0" onClick={onClose} />

      {rect && (
        <div
          className="fixed z-[91] w-[min(300px,calc(100vw-24px))] bg-panel border border-[#7a856f]/55 rounded-[6px] shadow-2xl p-4 transition-all duration-300 ease-out"
          style={cardStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <span className="font-mono text-[10px] text-pear uppercase font-bold tracking-wider">
              Step {stepIdx + 1} / {steps.length}
            </span>
            <button
              onClick={onClose}
              className="text-muted hover:text-paper text-[13px] leading-none cursor-pointer -mt-0.5 -mr-0.5"
              title="Close tour"
            >
              ✕
            </button>
          </div>
          <h4 className="font-space text-[14px] font-medium text-paper mb-1.5">{step.title}</h4>
          <p className="text-[12px] text-muted leading-relaxed mb-4">{step.description}</p>
          <div className="flex justify-between items-center">
            <button
              onClick={() => onStepChange(stepIdx - 1)}
              className={`text-[11px] font-mono uppercase tracking-wide text-muted hover:text-paper cursor-pointer transition-opacity ${stepIdx === 0 ? 'opacity-0 pointer-events-none' : ''}`}
            >
              Back
            </button>
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === stepIdx ? 'bg-pear' : 'bg-[#7a856f]/40'}`}
                />
              ))}
            </div>
            <button
              onClick={() => (isLast ? onClose() : onStepChange(stepIdx + 1))}
              className="px-4 py-1.5 bg-pear border border-pear text-bg text-[11px] font-mono font-bold uppercase tracking-wide rounded-[3px] hover:bg-pear-tint hover:border-pear-tint hover:text-pear-deep transition-all cursor-pointer"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
