'use client';

import type { RatingCurveSeries } from '@/lib/play/types';

// The "Moves by Rating" chart — Otter's candidate moves re-run across
// every rating bucket for the current position, each line coloured by a
// Stockfish-judged quality label (see useRatingCurve's sweepRatingCurve).
export default function RatingChart({
  ratingCurveData,
  ratingCurveLoading,
  ratingCurveHoverIdx,
  setRatingCurveHoverIdx,
}: {
  ratingCurveData: RatingCurveSeries[];
  ratingCurveLoading: boolean;
  ratingCurveHoverIdx: number | null;
  setRatingCurveHoverIdx: (idx: number | null) => void;
}) {
  // Fixed axis, matching what sweepRatingCurve computes against — always
  // the full range, regardless of how many buckets have actually resolved
  // yet. Series' own `points` arrays are shorter while a sweep is still
  // live-streaming in, so their lines simply stop partway across this
  // fixed axis and grow rightward as more buckets land, instead of the
  // whole axis rescaling under them as data streams in.
  const eloLabels = [800, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2200, 2400, 2600];
  // Fixed 0/25/50/75/100 scale (not rescaled to the data) so the shape of
  // each curve stays visually comparable across different positions
  // instead of the axis jumping around.
  const maxY = 100;
  const chartW = 380, chartH = 280, padL = 44, padB = 20, padT = 8, padR = 40;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const baseline = chartH - padB;
  const xForIdx = (i: number) => padL + (eloLabels.length > 1 ? (i / (eloLabels.length - 1)) * plotW : plotW / 2);
  const yForProb = (p: number) => padT + (1 - p / maxY) * plotH;
  const gridSteps = [0, 25, 50, 75, 100];
  const hoverIdx = ratingCurveHoverIdx !== null ? Math.max(0, Math.min(eloLabels.length - 1, ratingCurveHoverIdx)) : null;

  // Smooth curve through the points instead of straight joints —
  // quadratic Beziers using each point as the control and the midpoint
  // between consecutive points as the on-curve waypoint. Simple, no extra
  // deps, and keeps the line passing close to the actual data.
  const smoothLine = (pts: { x: number; y: number }[]): string => {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x},${pts[i].y} ${midX},${midY}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x},${last.y}`;
    return d;
  };
  const smoothArea = (pts: { x: number; y: number }[], baseY: number): string => {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x},${baseY} L ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x},${pts[i].y} ${midX},${midY}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x},${last.y} L ${last.x},${baseY} Z`;
    return d;
  };

  return (
    <div className="flex-grow flex flex-col min-h-0 lg:max-h-[460px]">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3 shrink-0">
        <span className="block-label font-mono text-[12px] text-pear tracking-[0.12em] uppercase font-bold flex items-center gap-1.5">
          Moves by Rating
          {ratingCurveLoading && (
            <span className="w-1.5 h-1.5 rounded-full bg-pear animate-pulse" title="Sweeping rating brackets..." />
          )}
        </span>
        <div className="flex items-center gap-2.5 flex-wrap justify-end">
          {ratingCurveData.map((s, i) => (
            <span key={i} className="font-mono text-[12px] font-bold" style={{ color: s.color }} title={s.label}>
              {s.san}
            </span>
          ))}
        </div>
      </div>
      {/* The chart shell (axes, gridlines) always renders, even with zero
          data — the graph must never disappear, whether that's on first
          load before any sweep has finished, or between positions. */}
      {(
        <div className="relative flex-grow min-h-[150px]">
          <svg
            viewBox={`0 0 ${chartW} ${chartH}`}
            preserveAspectRatio="xMidYMin meet"
            className="w-full h-full block -mx-6"
            style={{ width: 'calc(100% + 48px)', maxWidth: 'calc(100% + 48px)' }}
          >
            <defs>
              {ratingCurveData.map((s, si) => (
                <linearGradient key={si} id={`rcgrad-${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {/* Gridlines + y-axis labels */}
            {gridSteps.map((g, i) => (
              <g key={i}>
                <line
                  x1={padL} x2={chartW - padR} y1={yForProb(g)} y2={yForProb(g)}
                  stroke="var(--line)" strokeWidth={0.7} strokeDasharray="2,2"
                />
                <text x={padL - 5} y={yForProb(g) + 3.5} textAnchor="end" fontSize={9} fill="var(--muted)" fontFamily="monospace">
                  {g}%
                </text>
              </g>
            ))}
            {/* Solid x/y axis lines, on top of the dashed gridlines */}
            <line x1={padL} x2={padL} y1={padT} y2={baseline} stroke="var(--muted)" strokeWidth={1} opacity={0.45} />
            <line x1={padL} x2={chartW - padR} y1={baseline} y2={baseline} stroke="var(--muted)" strokeWidth={1} opacity={0.45} />
            {/* X-axis labels */}
            {eloLabels.map((elo, i) => (
              (i === 0 || i === eloLabels.length - 1 || (i % 2 === 0 && i < eloLabels.length - 2) || eloLabels.length <= 6) && (
                <text
                  key={i}
                  x={xForIdx(i)}
                  y={chartH - 4}
                  textAnchor={i === 0 ? 'start' : i === eloLabels.length - 1 ? 'end' : 'middle'}
                  fontSize={8.5} fill="var(--muted)" fontFamily="monospace"
                >
                  {elo}
                </text>
              )
            ))}
            {/* Area fill under each line — rendered lowest-probability-first
                (ratingCurveData is already sorted descending by peak
                probability) so the leading move's large area sits at the
                back and thinner trailing bands layer on top. */}
            {[...ratingCurveData].reverse().map((s, ri) => {
              const si = ratingCurveData.length - 1 - ri;
              const pts = s.points.map((p, i) => ({ x: xForIdx(i), y: yForProb(p.probability) }));
              return <path key={si} d={smoothArea(pts, baseline)} fill={`url(#rcgrad-${si})`} stroke="none" className="transition-[d] duration-250 ease-in-out" />;
            })}
            {/* One smooth curve + dots per candidate move, coloured by
                quality — keyed by rank (not move identity) so when a new
                sweep swaps in a different move at the same rank, the SAME
                dot/line/label elements are reused and just glide + relabel
                instead of vanishing and reappearing. */}
            {ratingCurveData.map((s, si) => (
              <g key={si}>
                <path
                  d={smoothLine(s.points.map((p, i) => ({ x: xForIdx(i), y: yForProb(p.probability) })))}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className="transition-[d,stroke] duration-250 ease-in-out"
                />
                {s.points.map((p, i) => (
                  <circle
                    key={i} cx={xForIdx(i)} cy={yForProb(p.probability)} r={3.6}
                    fill={s.color} stroke="var(--bg)" strokeWidth={1}
                    className="transition-[cx,cy,fill] duration-250 ease-in-out"
                  />
                ))}
                <text
                  x={xForIdx(s.points.length - 1) + 4}
                  y={yForProb(s.points[s.points.length - 1].probability) + 3}
                  fontSize={10}
                  fontWeight="bold"
                  fill={s.color}
                  fontFamily="monospace"
                  className="transition-[y,fill] duration-250 ease-in-out"
                >
                  {s.san}
                </text>
              </g>
            ))}
            {/* Crosshair + highlighted dots for whichever rating column the
                cursor is over. */}
            {hoverIdx !== null && ratingCurveData.length > 0 && (
              <g pointerEvents="none">
                <line x1={xForIdx(hoverIdx)} x2={xForIdx(hoverIdx)} y1={padT} y2={baseline} stroke="var(--paper)" strokeWidth={1} strokeDasharray="3,2" opacity={0.5} />
                {ratingCurveData.map((s, si) => (
                  // A series mid-live-sweep may not have a point at this
                  // column yet — skip its dot rather than reading past the
                  // end of its (still growing) points array.
                  s.points[hoverIdx] && (
                    <circle
                      key={si}
                      cx={xForIdx(hoverIdx)}
                      cy={yForProb(s.points[hoverIdx].probability)}
                      r={5}
                      fill={s.color}
                      stroke="var(--bg)"
                      strokeWidth={1.5}
                    />
                  )
                ))}
              </g>
            )}
            {/* Invisible full-plot overlay that drives the crosshair — on
                top of everything so it always receives the pointer. */}
            <rect
              x={padL} y={padT} width={plotW} height={plotH} fill="transparent"
              onMouseMove={(e) => {
                const svg = e.currentTarget.ownerSVGElement;
                if (!svg || eloLabels.length === 0) return;
                const rect = svg.getBoundingClientRect();
                const localX = (e.clientX - rect.left) * (chartW / rect.width);
                const relative = (localX - padL) / plotW;
                const idx = Math.round(relative * (eloLabels.length - 1));
                setRatingCurveHoverIdx(Math.max(0, Math.min(eloLabels.length - 1, idx)));
              }}
              onMouseLeave={() => setRatingCurveHoverIdx(null)}
            />
          </svg>
          {hoverIdx !== null && ratingCurveData.length > 0 && (
            <div
              className="absolute z-20 pointer-events-none px-2.5 py-2 border border-line bg-panel shadow-md rounded-[3px] whitespace-nowrap"
              style={{
                left: `${(xForIdx(hoverIdx) / chartW) * 100}%`,
                top: `${(padT / chartH) * 100}%`,
                transform: `translate(${hoverIdx > eloLabels.length / 2 ? 'calc(-100% - 10px)' : '10px'}, 0)`,
              }}
            >
              <div className="text-[11px] font-mono font-bold text-paper mb-1">
                {eloLabels[hoverIdx]} Elo
              </div>
              <div className="space-y-0.5">
                {ratingCurveData.map((s, si) => s.points[hoverIdx] && (
                  <div key={si} className="flex items-center gap-2 text-[10.5px] font-mono">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="font-bold" style={{ color: s.color }}>{s.san}</span>
                    <span className="text-muted ml-auto pl-2">{s.points[hoverIdx].probability.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
