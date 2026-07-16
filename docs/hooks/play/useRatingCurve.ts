'use client';

import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { PredictedMove, RatingCurveSeries } from '@/lib/play/types';
import { classifyDrop } from '@/lib/play/chess-utils';

// Drives the "Moves by Rating" chart: sweeps Otter across every rating
// bucket it's conditioned on for the position on screen, then judges each
// candidate's quality with the background Stockfish worker. Debounced and
// cached by (FEN + both rating-bracket slider values), and entirely
// Analyze-mode-specific — never touches match/editor state.
export function useRatingCurve(deps: {
  otterWorkerRef: React.MutableRefObject<Worker | null>;
  modelLoaded: boolean;
  isAnalyzeMode: boolean;
  game: Chess | null;
  historyMoves: string[];
  analyzeWhiteElo: number;
  analyzeBlackElo: number;
  analyzeHistoryK: number;
  analyzeTimeFormat: 'blitz' | 'rapid' | 'classical';
  analyzeWhiteTime: number;
  analyzeBlackTime: number;
  runModelInferenceAtElo: (c: Chess, history: string[], activeEloBucket: number) => Promise<PredictedMove[] | null>;
  ensureBgStockfishWorker: () => Promise<Worker | null>;
  evaluatePositionOnce: (worker: Worker, fen: string, depth: number) => Promise<number | undefined>;
}) {
  const {
    otterWorkerRef,
    modelLoaded,
    isAnalyzeMode,
    game,
    historyMoves,
    analyzeWhiteElo,
    analyzeBlackElo,
    analyzeHistoryK,
    analyzeTimeFormat,
    analyzeWhiteTime,
    analyzeBlackTime,
    runModelInferenceAtElo,
    ensureBgStockfishWorker,
    evaluatePositionOnce,
  } = deps;

  const ratingCurveSeqRef = useRef(0);
  const [ratingCurveLoading, setRatingCurveLoading] = useState(false);
  const [ratingCurveData, setRatingCurveData] = useState<RatingCurveSeries[]>([]);
  // FEN -> computed series, so revisiting an already-swept position (undo,
  // stepping back through a branch, etc.) is instant instead of
  // recomputing. No speculative prefetching of unplayed moves — that
  // queued extra background work and made the app feel laggy.
  const ratingCurveCacheRef = useRef<Map<string, RatingCurveSeries[]>>(new Map());
  // Column index (into each series' points array) currently under the
  // cursor — a crosshair-style hover, not a single-dot one, so hovering
  // anywhere along a rating value shows every candidate move's value at
  // that rating together.
  const [ratingCurveHoverIdx, setRatingCurveHoverIdx] = useState<number | null>(null);

  // The heavy lifting behind "Moves by Rating": sweep Otter across every
  // rating bucket it's conditioned on for one specific position, take the
  // union of moves that show up in anyone's top-3, then judge each one's
  // quality with the background Stockfish worker so its line can be
  // coloured red/orange/yellow/green instead of a flat green. Pure — does
  // not touch any display state, so it's equally usable for the position
  // on screen or for speculatively precomputing one that isn't yet.
  // `mySeq` ties this run to whichever base position requested it (the
  // current one directly, or the position it was prefetched from), so it
  // aborts the moment that base position is superseded by a newer one.
  const sweepRatingCurve = async (c: Chess, history: string[], mySeq: number): Promise<RatingCurveSeries[] | null> => {
    if (!otterWorkerRef.current || !modelLoaded) return null;

    // Otter is only conditioned on 11 discrete rating buckets (bucket 10
    // covers "2000 and up" as a single wide band — the same scheme used
    // for the player-rating slider elsewhere). Displaying out to 2600
    // (matching the reference chart) doesn't need any extra inference
    // calls: 2200/2400/2600 all resolve to bucket 10, so their results
    // are just bucket 10's, reused — same total compute as before.
    const bucketEloLabels = [800, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2200, 2400, 2600];
    const eloToBucketForDisplay = (elo: number) => (elo < 1100 ? 0 : elo >= 2000 ? 10 : 1 + Math.floor((elo - 1100) / 100));
    const displayBuckets = bucketEloLabels.map(eloToBucketForDisplay);
    const uniqueBuckets = Array.from(new Set(displayBuckets)).sort((a, b) => a - b);
    const baseFenForSan = c.fen();
    const sanFor = (moveUci: string): string => {
      try {
        const cl = new Chess(baseFenForSan);
        const mv = cl.move({
          from: moveUci.slice(0, 2) as any,
          to: moveUci.slice(2, 4) as any,
          promotion: moveUci.length > 4 ? (moveUci.slice(4) as any) : undefined,
        });
        return mv ? mv.san : moveUci;
      } catch (_) {
        return moveUci;
      }
    };
    // Default colour for moves shown live, before Stockfish has had a
    // chance to judge them (that only happens once the full bucket sweep
    // below is done and the final candidate list is known) — Otter's own
    // brand green, since these are Otter's picks; recoloured red/orange/
    // yellow once Stockfish's quality verdict comes in.
    const PENDING_COLOR = '#5C8A2E';

    const resultByBucket = new Map<number, PredictedMove[] | null>();
    const perBucket: (PredictedMove[] | null)[] = new Array(bucketEloLabels.length).fill(null);
    const bestProbSoFar = new Map<string, number>();

    // The candidate set is locked in from the very first (lowest-elo)
    // bucket and never added to or reordered mid-sweep — in practice the
    // top ~5 moves rarely change identity across the rating range, so this
    // avoids the line set shuffling/growing every single bucket. Each
    // series' points array is always the FULL 14-point width too, with
    // not-yet-resolved buckets holding the last known value flat instead
    // of being omitted — so every update is just existing points sliding
    // to a new Y, never the path gaining or losing points. That's what
    // lets the CSS transition on `d` read as one continuous smooth motion
    // (800 -> 2600 filling in left to right) instead of blocky jumps, and
    // is also why moving to a new position (mostly the same ~4 candidates)
    // glides the existing lines to their new values instead of clearing
    // the chart and rebuilding it from nothing.
    let lockedCandidates: string[] | null = null;

    const buildPreview = (): RatingCurveSeries[] => {
      if (!lockedCandidates) return [];
      return lockedCandidates.map((moveUci) => {
        let lastKnown = 0;
        const points = bucketEloLabels.map((eloBucket, i) => {
          const pred = perBucket[i]?.find(m => m.move === moveUci);
          if (pred) lastKnown = pred.probability * 100;
          return { eloBucket, probability: lastKnown };
        });
        return { move: moveUci, san: sanFor(moveUci), color: PENDING_COLOR, label: 'Calculating...', points };
      });
    };

    for (const bucket of uniqueBuckets) {
      if (mySeq !== ratingCurveSeqRef.current) return null; // superseded by a newer position
      const res = await runModelInferenceAtElo(c, history, bucket);
      if (mySeq !== ratingCurveSeqRef.current) return null;
      resultByBucket.set(bucket, res);
      displayBuckets.forEach((db, i) => { if (db === bucket) perBucket[i] = res; });

      res?.slice(0, 3).forEach((m) => {
        const prev = bestProbSoFar.get(m.move) ?? -1;
        if (m.probability > prev) bestProbSoFar.set(m.move, m.probability);
      });
      if (!lockedCandidates && res) {
        lockedCandidates = res.slice(0, 5).map(m => m.move);
      }

      setRatingCurveData(buildPreview());
    }
    if (mySeq !== ratingCurveSeqRef.current) return null;

    const candidateMoves = Array.from(bestProbSoFar.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([move]) => move);

    if (candidateMoves.length === 0) return [];

    const worker = await ensureBgStockfishWorker();
    if (!worker || mySeq !== ratingCurveSeqRef.current) return null;

    const baseFen = c.fen();
    const scanDepth = 12;
    const whiteToMove = c.turn() === 'w';

    // Evaluate every candidate move at the same depth on the same kind of
    // position (all one ply deep) and grade each relative to the best
    // result *among these candidates* — rather than against a separately
    // -searched "before the move" baseline. The two aren't directly
    // comparable with this bundled classical-eval engine: it scores the
    // bare starting position noticeably higher than literally any single
    // reply to it (observed ~+1.16 for the naked startpos vs ~-0.3..+0.45
    // one ply deep), which would mislabel every opening move as an
    // inaccuracy/mistake purely from that depth-0-vs-depth-1 inconsistency.
    const evaluated: { moveUci: string; san: string; moverEval: number | undefined }[] = [];
    for (const moveUci of candidateMoves) {
      if (mySeq !== ratingCurveSeqRef.current) return null;
      let san = moveUci;
      let moverEval: number | undefined;
      try {
        const clone = new Chess(baseFen);
        const mv = clone.move({
          from: moveUci.slice(0, 2) as any,
          to: moveUci.slice(2, 4) as any,
          promotion: moveUci.length > 4 ? (moveUci.slice(4) as any) : undefined,
        });
        if (mv) {
          san = mv.san;
          const afterEval = await evaluatePositionOnce(worker, clone.fen(), scanDepth);
          if (mySeq !== ratingCurveSeqRef.current) return null;
          if (afterEval !== undefined) {
            // Normalize from White's perspective to the mover's own.
            moverEval = whiteToMove ? afterEval : -afterEval;
          }
        }
      } catch (_) {
        // keep the UCI string + undefined eval as a fallback
      }
      evaluated.push({ moveUci, san, moverEval });
    }

    const definedEvals = evaluated.map(e => e.moverEval).filter((v): v is number => v !== undefined);
    const bestMoverEval = definedEvals.length > 0 ? Math.max(...definedEvals) : undefined;

    const series: RatingCurveSeries[] = evaluated.map(({ moveUci, san, moverEval }) => {
      let color = '#5C8A2E';
      let label = 'Good';
      if (bestMoverEval !== undefined && moverEval !== undefined) {
        const cls = classifyDrop(bestMoverEval - moverEval);
        color = cls.color;
        label = cls.label;
      }
      const points = bucketEloLabels.map((eloBucket, i) => ({
        eloBucket,
        probability: (perBucket[i]?.find(m => m.move === moveUci)?.probability ?? 0) * 100,
      }));
      return { move: moveUci, san, color, label, points };
    });

    if (mySeq !== ratingCurveSeqRef.current) return null;
    return series;
  };

  // Drives the visible "Moves by Rating" chart for the position on screen.
  // Cache hit (a position already swept once, e.g. revisited via undo/
  // branch navigation) -> instant. Cache miss -> sweep in the background
  // while the *previous* chart stays fully visible (no clear-to-empty).
  // No speculative prefetching of moves that haven't been played — that
  // queued extra ONNX/Stockfish work competing with the live analysis and
  // made the whole app feel laggy.
  const computeRatingCurve = async (c: Chess, history: string[]) => {
    if (!otterWorkerRef.current || !modelLoaded) return;
    const mySeq = ++ratingCurveSeqRef.current;
    // The opponent's bracket (whichever slider isn't the side being swept)
    // changes the sweep's results for the same FEN, so it has to be part
    // of the cache key — otherwise moving the sliders after a position was
    // already swept once would keep showing the stale numbers. Same for the
    // history-window and time-control conditioning.
    const fen = `${c.fen()}|${analyzeWhiteElo}|${analyzeBlackElo}|${analyzeHistoryK}|${analyzeTimeFormat}|${analyzeWhiteTime}|${analyzeBlackTime}`;

    const cached = ratingCurveCacheRef.current.get(fen);
    if (cached) {
      setRatingCurveData(cached);
      setRatingCurveLoading(false);
      return;
    }

    setRatingCurveLoading(true);
    const series = await sweepRatingCurve(c, history, mySeq);
    if (mySeq !== ratingCurveSeqRef.current) return; // superseded — drop this result
    if (series) {
      ratingCurveCacheRef.current.set(fen, series);
      setRatingCurveData(series);
    }
    setRatingCurveLoading(false);
  };

  // "Moves by Rating" — debounced so rapidly stepping through moves
  // doesn't fire a full rating sweep (11 Otter inferences + up to 5
  // Stockfish scans) for every position along the way, only the one you
  // settle on.
  useEffect(() => {
    // Bump immediately (not inside the debounce below) so a sweep already
    // in flight for the position we just left drops out of the ONNX mutex
    // queue on its very next await, instead of continuing to hold up the
    // live per-move prediction for up to another 400ms while the debounce
    // for the new position is still pending.
    ratingCurveSeqRef.current++;
    if (!isAnalyzeMode || !game || !modelLoaded) {
      setRatingCurveData([]);
      setRatingCurveLoading(false);
      return;
    }
    const handle = setTimeout(() => {
      computeRatingCurve(game, historyMoves);
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnalyzeMode, game, historyMoves, modelLoaded, analyzeWhiteElo, analyzeBlackElo, analyzeHistoryK, analyzeTimeFormat, analyzeWhiteTime, analyzeBlackTime]);

  return {
    ratingCurveData,
    ratingCurveLoading,
    ratingCurveHoverIdx,
    setRatingCurveHoverIdx,
  };
}
