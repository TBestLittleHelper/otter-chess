'use client';

// Otter always flanks the left of the board, Stockfish the right — fixed
// sides, not swapped on flip. Each bar is a solid two-tone split — no
// gradient blend — where the COLOURED region's size always equals `pct`
// (matching the number in the pill; it used to be sized to 100-pct, which
// visually read backwards — e.g. a 47% pill sitting over a 53%-tall green
// region). The coloured region anchors to whichever physical edge White
// currently sits at (bottom normally, top when flipped). Outer footprint
// (w-6 / boardPx height) is unchanged so the board's size formula, tuned
// around that exact reserved width, still holds — only the pill is
// allowed to spill past it visually via overflow-visible.
//
// The bar's slot is always rendered — just empty outside Analyze mode —
// so the row's total width (and therefore the board's centered position)
// never changes when Analyze mode toggles the bar's content.
export default function EvalBar({
  pct,
  color,
  text,
  title,
  isFlipped,
  isAnalyzeMode,
  boardPx,
}: {
  pct: number;
  color: string;
  text: string;
  title: string;
  isFlipped: boolean;
  isAnalyzeMode: boolean;
  boardPx: number | null;
}) {
  const evalBarHeightClasses = "h-[min(calc(92vw-80px),82vh,720px)] lg:h-[min(calc(100vw-760px),82vh,720px)]";
  const colorAtTop = isFlipped;
  const topHeight = colorAtTop ? pct : 100 - pct;
  const topColor = colorAtTop ? color : '#000000';
  const bottomColor = colorAtTop ? '#000000' : color;
  const pillTop = topHeight;

  return (
    <div
      className={`w-6 shrink-0 ${evalBarHeightClasses} relative overflow-visible`}
      style={boardPx !== null ? { height: boardPx } : undefined}
      title={isAnalyzeMode ? title : undefined}
    >
      {isAnalyzeMode && (
        <>
          <div className="absolute inset-0 rounded-[2px] overflow-hidden border border-line">
            <div className="absolute inset-x-0 top-0 transition-[height] duration-500 ease-out" style={{ height: `${topHeight}%`, backgroundColor: topColor }} />
            <div className="absolute inset-x-0 bottom-0 transition-[height] duration-500 ease-out" style={{ height: `${100 - topHeight}%`, backgroundColor: bottomColor }} />
            {[...Array(9)].map((_, i) => (
              <div key={i} className="absolute inset-x-0 h-px bg-white/15" style={{ top: `${(i + 1) * 10}%` }} />
            ))}
          </div>
          <div
            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-bg text-paper text-[10px] font-mono font-bold px-2 py-0.5 rounded-full shadow-md whitespace-nowrap pointer-events-none select-none border border-line/40 transition-[top] duration-500 ease-out"
            style={{ top: `${pillTop}%` }}
          >
            {text}
          </div>
        </>
      )}
    </div>
  );
}
