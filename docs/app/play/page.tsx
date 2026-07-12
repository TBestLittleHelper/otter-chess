'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import { Api } from 'chessground/api';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

// Simple types for Chess piece representation
interface Piece {
  type: 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
  color: 'w' | 'b';
  square: string;
}

// Predicted move object
interface PredictedMove {
  move: string;
  probability: number;
}

interface RatingCurveSeries {
  move: string;
  san: string;
  color: string;
  label: string;
  points: { eloBucket: number; probability: number }[];
}

interface MatchRecord {
  id: string;
  date: string;
  opponentElo: number;
  timeControl: string;
  playerColor: 'w' | 'b';
  result: 'win' | 'loss' | 'draw';
  movesCount: number;
  pgn: string;
}

// Convert FEN string to 8x8 pieces grid (row 0 is Rank 8, col 0 is File a)
const fenToGrid = (fen: string): string[][] => {
  const grid: string[][] = Array(8).fill(null).map(() => Array(8).fill(""));
  const fields = fen.split(' ');
  const ranks = fields[0].split('/');
  for (let r = 0; r < 8; r++) {
    let c = 0;
    if (!ranks[r]) continue;
    for (let i = 0; i < ranks[r].length; i++) {
      const char = ranks[r][i];
      if (/[1-8]/.test(char)) {
        c += parseInt(char, 10);
      } else {
        const color = char === char.toUpperCase() ? 'w' : 'b';
        const type = char.toLowerCase();
        grid[r][c] = color + type;
        c++;
      }
    }
  }
  return grid;
};

// Convert 8x8 pieces grid back to FEN placement string
const gridToFenPlacement = (grid: string[][]): string => {
  const ranks: string[] = [];
  for (let r = 0; r < 8; r++) {
    let rankStr = "";
    let emptyCount = 0;
    for (let c = 0; c < 8; c++) {
      const piece = grid[r][c];
      if (piece === "") {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rankStr += emptyCount.toString();
          emptyCount = 0;
        }
        const color = piece[0];
        const type = piece[1];
        const char = color === 'w' ? type.toUpperCase() : type.toLowerCase();
        rankStr += char;
      }
    }
    if (emptyCount > 0) {
      rankStr += emptyCount.toString();
    }
    ranks.push(rankStr);
  }
  return ranks.join('/');
};

const boardToTensor = (c: Chess): Float32Array => {
  const originalTurn = c.turn();
  const isWhite = originalTurn === 'w';
  const tensor = new Float32Array(18 * 8 * 8);

  const setVal = (ch: number, row: number, col: number, val: number) => {
    tensor[ch * 64 + row * 8 + col] = val;
  };

  const fillChannel = (ch: number, val: number) => {
    for (let i = 0; i < 64; i++) {
      tensor[ch * 64 + i] = val;
    }
  };

  const board = c.board();
  const pieceToCh: Record<string, number> = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

  for (let r = 0; r < 8; r++) {
    for (let cIdx = 0; cIdx < 8; cIdx++) {
      const piece = board[r][cIdx];
      if (piece) {
        const row = isWhite ? r : (7 - r);
        const col = cIdx;
        const color = isWhite ? piece.color : (piece.color === 'w' ? 'b' : 'w');
        const ch = pieceToCh[piece.type] + (color === 'w' ? 0 : 6);
        setVal(ch, row, col, 1.0);
      }
    }
  }

  const castling = {
    w: { k: c.fen().split(' ')[2].includes('K'), q: c.fen().split(' ')[2].includes('Q') },
    b: { k: c.fen().split(' ')[2].includes('k'), q: c.fen().split(' ')[2].includes('q') }
  };

  if (isWhite) {
    if (castling.w.k) fillChannel(12, 1.0);
    if (castling.w.q) fillChannel(13, 1.0);
    if (castling.b.k) fillChannel(14, 1.0);
    if (castling.b.q) fillChannel(15, 1.0);
  } else {
    if (castling.b.k) fillChannel(12, 1.0);
    if (castling.b.q) fillChannel(13, 1.0);
    if (castling.w.k) fillChannel(14, 1.0);
    if (castling.w.q) fillChannel(15, 1.0);
  }

  const fenParts = c.fen().split(' ');
  const epSquare = fenParts[3];
  if (epSquare && epSquare !== '-') {
    const file = epSquare.charCodeAt(0) - 97;
    const rank = parseInt(epSquare[1], 10);
    const row = isWhite ? (8 - rank) : (rank - 1);
    const col = file;
    setVal(16, row, col, 1.0);
  }

  if (isWhite) {
    fillChannel(17, 1.0);
  }

  return tensor;
};

const mirrorSquare = (square: string): string => {
  const file = square[0];
  const rank = parseInt(square[1], 10);
  return `${file}${9 - rank}`;
};

const mirrorMove = (moveUci: string): string => {
  const from = moveUci.slice(0, 2);
  const to = moveUci.slice(2, 4);
  const promo = moveUci.length > 4 ? moveUci.slice(4) : '';
  return `${mirrorSquare(from)}${mirrorSquare(to)}${promo}`;
};

export default function PlayPage() {
  // Engine & Asset Availability
  const [modelAvailable, setModelAvailable] = useState<boolean>(false);
  const [stockfishAvailable, setStockfishAvailable] = useState<boolean>(false);
  const [checkingAvailability, setCheckingAvailability] = useState<boolean>(true);
  
  // Downloading States
  const [isDownloadingModel, setIsDownloadingModel] = useState<boolean>(false);
  const [modelProgress, setModelProgress] = useState<number>(0);
  const [isDownloadingSf, setIsDownloadingSf] = useState<boolean>(false);
  const [sfProgress, setSfProgress] = useState<number>(0);
  
  // Game Setup & Lobby States
  const [isMatchActive, setIsMatchActive] = useState<boolean>(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [matchHistory, setMatchHistory] = useState<MatchRecord[]>([]);
  const [chosenSide, setChosenSide] = useState<'w' | 'b' | 'random'>('w');
  const [thinkingMode, setThinkingMode] = useState<'instant' | 'human'>('human');
  const [isThinking, setIsThinking] = useState<boolean>(false);

  // Active Game State
  const [game, setGame] = useState<Chess | null>(null);
  const [board, setBoard] = useState<(Piece | null)[][]>([]);
  const [historyMoves, setHistoryMoves] = useState<string[]>([]);
  const [historyMovesSan, setHistoryMovesSan] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [possibleSquares, setPossibleSquares] = useState<string[]>([]);
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [gameStatus, setGameStatus] = useState<string>("White to move");

  // Model Parameters
  const [playerRating, setPlayerRating] = useState<number>(1500);
  const [playerElo, setPlayerElo] = useState<number>(1500);
  const [opponentElo, setOpponentElo] = useState<number>(1500);
  const [timeControl, setTimeControl] = useState<string>("600+0");
  const [clockFraction, setClockFraction] = useState<number>(50); // percentage
  const [playerTime, setPlayerTime] = useState<number>(600);
  const [otterTime, setOtterTime] = useState<number>(600);

  // Model Loading & Execution State
  const [showSetupModal, setShowSetupModal] = useState<boolean>(false);
  const [showReadyToast, setShowReadyToast] = useState<boolean>(true);
  const [liveFenInput, setLiveFenInput] = useState<string>("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const [livePgnInput, setLivePgnInput] = useState<string>("");
  const [ortLoaded, setOrtLoaded] = useState<boolean>(false);
  const [modelLoaded, setModelLoaded] = useState<boolean>(false);
  const [provider, setProvider] = useState<'webgpu' | 'wasm'>('wasm');
  const [webgpuSupported, setWebgpuSupported] = useState<boolean>(false);

  // Model Outputs
  const [winProbability, setWinProbability] = useState<number>(0.0);
  const stockfishRef = useRef<Worker | null>(null);
  const [stockfishEvalPct, setStockfishEvalPct] = useState<number>(50);
  const [topMoves, setTopMoves] = useState<PredictedMove[]>([]);
  // Stockfish's own top candidate moves (UCI MultiPV), for the side-by-side
  // Otter-vs-Stockfish comparison panel in Analyze mode.
  const [sfTopMoves, setSfTopMoves] = useState<{ san: string; evalCp: number; from: string; to: string }[]>([]);
  const sfMultiPvBufferRef = useRef<Map<number, { move: string; scoreCp: number }>>(new Map());
  // "Moves by Rating" — for the current position, Otter's candidate moves
  // re-run across every rating bucket it's conditioned on, each move's
  // line coloured by a Stockfish-judged quality label (dedicated
  // background worker — see bgStockfishRef — so it never competes with
  // the live eval bar / comparison panel's own Stockfish worker).
  const bgStockfishRef = useRef<Worker | null>(null);
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
  const [auxMovingPiece, setAuxMovingPiece] = useState<string>("-");
  const [auxCapturedPiece, setAuxCapturedPiece] = useState<string>("-");
  const [auxCheckProb, setAuxCheckProb] = useState<string>("-");
  const [auxFromTo, setAuxFromTo] = useState<string>("-");
  // The aux head's own 64-way from-square and 64-way to-square predictions
  // (aux_logits[13:77] and [77:141]) — 128 of the model's 141 auxiliary
  // output dims that were computed on every inference but never decoded or
  // shown anywhere. Trained independently from the policy head, so it can
  // (and sometimes does) point at a different move than Otter's own top
  // pick — that disagreement is itself a signal, not just a duplicate of
  // topMoves[0].
  const [auxIntuitionFrom, setAuxIntuitionFrom] = useState<string | null>(null);
  const [auxIntuitionFromConf, setAuxIntuitionFromConf] = useState<number>(0);
  const [auxIntuitionTo, setAuxIntuitionTo] = useState<string | null>(null);
  const [auxIntuitionToConf, setAuxIntuitionToConf] = useState<number>(0);
  const [modelPredMove, setModelPredMove] = useState<{ from: string; to: string } | null> (null);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [mobileNotationOpen, setMobileNotationOpen] = useState<boolean>(false);
  const [pendingPromotion, setPendingPromotion] = useState<{ orig: string; dest: string; color: 'w' | 'b' } | null>(null);
  const [showResignConfirm, setShowResignConfirm] = useState<boolean>(false);
  const [drawDeclined, setDrawDeclined] = useState<boolean>(false);
  const [editorPositionError, setEditorPositionError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showFenPgnModal, setShowFenPgnModal] = useState<boolean>(false);
  // Player names/ratings parsed from a loaded PGN's headers, for Analyze
  // mode's board cards. Kept as separate state (not read off `game.header()`)
  // because `game` gets reconstructed from a bare FEN on every navigation
  // step (goToAnalysisMove), which would otherwise silently drop them.
  const [analysisWhiteName, setAnalysisWhiteName] = useState<string | null>(null);
  const [analysisBlackName, setAnalysisBlackName] = useState<string | null>(null);
  const [analysisWhiteElo, setAnalysisWhiteElo] = useState<string | null>(null);
  const [analysisBlackElo, setAnalysisBlackElo] = useState<string | null>(null);

  // Rating bracket Otter's predictions are conditioned on for each side
  // while in Analyze mode — independent of the Challenge Otter match
  // sliders. Defaulted (see applyDefaultAnalyzeElos) from the loaded PGN's
  // WhiteElo/BlackElo headers, or from the just-played match's configured
  // ratings when there's no PGN to read them from, then adjustable via the
  // two sliders at the top of the Analyze sidebar.
  const [analyzeWhiteElo, setAnalyzeWhiteElo] = useState<number>(1500);
  const [analyzeBlackElo, setAnalyzeBlackElo] = useState<number>(1500);

  // Analysis Mode States
  const [isAnalyzeMode, setIsAnalyzeMode] = useState<boolean>(false);
  const [analysisMoves, setAnalysisMoves] = useState<{
    san: string;
    uci: string;
    fen: string;
    from: string;
    to: string;
    classification?: string;
  }[]>([]);
  const [currentMoveIdx, setCurrentMoveIdx] = useState<number>(-1);
  // Variations played while stepped back into the middle of the loaded
  // game instead of at the end of it. The real line (analysisMoves) is
  // never touched by these — each branch is keyed by the real-line ply
  // index it diverged from (analysisMoves[baseIdx], or -1 for "before the
  // first move"). Unlike scratch state, these are kept around across
  // navigation — going back to the real line only changes which one (if
  // any) is being *viewed*, via activeBranchBase/branchViewIdx; the data
  // itself survives until a new game is loaded. Only one branch per
  // divergence point is kept (playing a different move from the same spot
  // again replaces it, rather than stacking sibling variations).
  const [branchesByBase, setBranchesByBase] = useState<Map<number, {
    san: string;
    uci: string;
    fen: string;
    from: string;
    to: string;
  }[]>>(new Map());
  const [activeBranchBase, setActiveBranchBase] = useState<number | null>(null);
  const [branchViewIdx, setBranchViewIdx] = useState<number>(-1);
  // The currently-viewed branch's moves, if any — derived rather than its
  // own state so it can never drift out of sync with branchesByBase.
  const branchMoves = activeBranchBase !== null ? (branchesByBase.get(activeBranchBase) ?? []) : [];
  const [isAnalyzeModalOpen, setIsAnalyzeModalOpen] = useState<boolean>(false);
  const [analyzeInput, setAnalyzeInput] = useState<string>("");
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analysisStartingFen, setAnalysisStartingFen] = useState<string>("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
  const [fenScores, setFenScores] = useState<Record<string, number>>({});
  const [fenPredictions, setFenPredictions] = useState<Record<string, PredictedMove[]>>({});
  const [playedMoveEvaluation, setPlayedMoveEvaluation] = useState<string>("");
  const [similarityPct, setSimilarityPct] = useState<number>(0);

  // Board Editor States
  const [isEditorMode, setIsEditorMode] = useState<boolean>(false);
  // Defaults to 'move' (drag existing pieces around), not a piece-stamp
  // tool — otherwise every click/short-drag on entering the editor plants
  // a new pawn wherever you clicked, which reads as "I can't touch the
  // board without corrupting it."
  const [editorSelectedPiece, setEditorSelectedPiece] = useState<'erase' | 'move' | 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP' | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP'>('move');
  const [editorMoveSource, setEditorMoveSource] = useState<string | null>(null);
  const [editorTurn, setEditorTurn] = useState<'w' | 'b'>('w');
  const [editorCastling, setEditorCastling] = useState({ wK: true, wQ: true, bK: true, bQ: true });
  const [isFreeform, setIsFreeform] = useState<boolean>(true);

  // refs to avoid stale closure bindings
  const activeTurnRef = useRef<'w' | 'b'>('w');
  const currentFenRef = useRef<string>("");
  const ignoreSearchLinesRef = useRef<boolean>(true);

  // ONNX inference runs entirely inside a dedicated worker (see
  // public/otter-worker.js) so wasm execution never blocks the main
  // thread — the board stays interactive (drag/drop, legal-move
  // application) no matter how much analysis is queued behind it.
  const otterWorkerRef = useRef<Worker | null>(null);
  const otterReqIdRef = useRef(0);
  const otterPendingRef = useRef<Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>>(new Map());
  const policyMoveToIdRef = useRef<Record<string, number>>({});
  const idToMoveRef = useRef<Record<number, string>>({});
  const historyMoveToIdRef = useRef<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const boardWrapperRef = useRef<HTMLDivElement>(null);
  const [boardPx, setBoardPx] = useState<number | null>(null);
  const cgRef = useRef<Api | null>(null);
  const mouseDownCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const lastInferenceSeqRef = useRef<number>(0);
  // Always mirrors the latest `game`, readable from async callbacks (like
  // Otter's delayed move) without the staleness a captured closure would have.
  const gameRef = useRef<Chess | null>(null);

  // 1. Check cached engines & load match history on mount
  useEffect(() => {
    const initializePage = async () => {
      // Load Player Rating
      const savedRating = localStorage.getItem('otter-player-rating');
      if (savedRating) {
        setPlayerRating(parseInt(savedRating, 10));
      }

      // Check WebGPU support
      if (typeof window !== 'undefined' && (navigator as any).gpu) {
        setWebgpuSupported(true);
        setProvider('webgpu');
      }

      // Load Match History
      const history = localStorage.getItem('otter-match-history');
      if (history) {
        try {
          setMatchHistory(JSON.parse(history));
        } catch (e) {
          console.error(e);
        }
      }

      // Check Cache Storage
      try {
        const cache = await caches.open('otter-model-cache');
        const modelRes = await cache.match('/policy_model.onnx');
        const sfRes = await cache.match('/stockfish.js');
        
        const hasModel = !!modelRes;
        const hasSf = !!sfRes;
        
        setModelAvailable(hasModel);
        setStockfishAvailable(hasSf);

        if (hasModel && hasSf) {
          // Warm up session in the background
          await loadAndInitModelFromCache();
        } else {
          // Engines missing — open the download dialog immediately instead
          // of leaving it to a small bottom-corner toast that's easy to
          // miss (especially on mobile, where it's not even in view until
          // you scroll).
          setShowSetupModal(true);
        }
      } catch (err) {
        console.error("Cache check failed:", err);
      } finally {
        setCheckingAvailability(false);
      }
    };

    initializePage();
  }, []);

  // 2. Initialize Chess.js
  useEffect(() => {
    const c = new Chess();
    setGame(c);
    setBoard(c.board() as (Piece | null)[][]);
  }, []);

  // Keep gameRef mirroring the latest `game` on every render.
  useEffect(() => {
    gameRef.current = game;
  });

  // 3. Automated Otter Game Loop
  useEffect(() => {
    if (!isMatchActive || !game || !modelLoaded || isThinking) return;

    const turn = game.turn();
    if (turn !== playerColor) {
      setIsThinking(true);
      const fenAtStart = game.fen();

      const runOtterTurn = async () => {
        try {
          const currentMoves = game.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
          const inferenceResult = await runModelInference(game, currentMoves);

          // The board may have moved on while inference was running — e.g. a
          // takeback, or the match ending via resign/draw. Applying Otter's
          // move to a position it was never computed for would corrupt the
          // game, so bail out instead.
          if (gameRef.current?.fen() !== fenAtStart) {
            setIsThinking(false);
            return;
          }

          if (inferenceResult && inferenceResult.length > 0) {
            const bestMove = inferenceResult[0].move;
            const delaySec = getExpectedHumanTime(inferenceResult, timeControl, otterTime);
            const thinkingDelay = thinkingMode === 'human' ? delaySec * 1000 : 50;

            setTimeout(() => {
              // Re-check right before applying too — the position could have
              // changed during the thinking delay itself.
              if (gameRef.current?.fen() === fenAtStart) {
                playModelMove(bestMove);
              }
              setIsThinking(false);
            }, thinkingDelay);
          } else {
            setIsThinking(false);
          }
        } catch (e) {
          console.error("Otter move generation failed:", e);
          setIsThinking(false);
        }
      };

      runOtterTurn();
    }
  }, [historyMoves, isMatchActive, modelLoaded, playerColor, thinkingMode, otterTime, timeControl]);

  // Re-run inference when Elo, time control, or clock fraction changes
  useEffect(() => {
    if (game && modelLoaded && isMatchActive && game.turn() === playerColor) {
      runModelInference(game, historyMoves);
    }
  }, [playerElo, opponentElo, timeControl, clockFraction, modelLoaded]);

  // Same, but for Analyze mode's own rating-bracket sliders — refreshes
  // the Otter · Human panel immediately as either slider moves, instead of
  // waiting for the next move/navigation to pick up the new brackets.
  useEffect(() => {
    if (game && modelLoaded && isAnalyzeMode) {
      runModelInference(game, historyMoves);
    }
  }, [analyzeWhiteElo, analyzeBlackElo, isAnalyzeMode, modelLoaded]);

  // Helper to parse base seconds of a time control
  const getBaseSeconds = (tc: string): number => {
    if (!tc || !tc.includes('+')) return 600;
    try {
      const parts = tc.split('+');
      return parseInt(parts[0], 10);
    } catch {
      return 600;
    }
  };

  // Helper to parse increment seconds of a time control
  const getIncrementSeconds = (tc: string): number => {
    if (!tc || !tc.includes('+')) return 0;
    try {
      const parts = tc.split('+');
      return parseInt(parts[1], 10);
    } catch {
      return 0;
    }
  };

  // Helper to compute expected human think time based on predictions, clock, and TC
  const getExpectedHumanTime = (preds: PredictedMove[], tcStr: string, timeLeft: number): number => {
    if (!preds || preds.length === 0) return 3.0;
    
    const p1 = preds[0].probability;
    const p2 = preds[1]?.probability || 0;
    
    // Entropy/Difference factor: if p1 is close to p2, decisions are harder
    const diff = Math.max(0, p1 - p2);
    // Harder moves have low diff and low absolute p1
    const difficulty = 1.0 - (diff * 0.5 + p1 * 0.5); 
    
    const baseSec = getBaseSeconds(tcStr);
    const scale = Math.max(5, baseSec * 0.05); // e.g. 30s max for Rapid
    
    // Remaining clock scale: humans play faster as clock runs down
    const clockFactor = baseSec > 0 ? Math.max(0.1, timeLeft / baseSec) : 1.0;
    
    const estimated = 1.0 + difficulty * scale * clockFactor;
    return Math.round(estimated * 10) / 10; // 1 decimal place
  };

  // Real-time ticking clock loop. Reads gameRef instead of closing over
  // `game` directly (and doesn't list `game` as a dependency), so the
  // interval runs continuously for the whole match instead of tearing down
  // and rebuilding on every move — which used to reset setInterval's 1s
  // phase each time, losing up to ~1s of ticking after every move and
  // making the displayed clock drift slower than real elapsed time.
  useEffect(() => {
    if (!isMatchActive) return;

    const interval = setInterval(() => {
      const currentGame = gameRef.current;
      if (!currentGame || currentGame.isGameOver()) return;

      const turn = currentGame.turn();
      if (turn === playerColor) {
        setPlayerTime(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            setGameStatus("Time's up — you lost on time.");
            setTimeout(() => recordMatch('loss'), 1800);
            return 0;
          }
          return prev - 1;
        });
      } else {
        setOtterTime(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            setGameStatus("Time's up — Otter lost on time.");
            setTimeout(() => recordMatch('win'), 1800);
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isMatchActive, playerColor]);

  // Helper to parse destinations for Chessground
  const getDests = (c: Chess): Map<any, any> => {
    const dests = new Map();
    c.moves({ verbose: true }).forEach(m => {
      if (!dests.has(m.from)) {
        dests.set(m.from, []);
      }
      dests.get(m.from).push(m.to);
    });
    return dests;
  };

  // Handle move events fired by Chessground drag-and-drop
  const handleMoveFromCg = (orig: string, dest: string) => {
    if (!game) return;

    // Detect promotion — defer to the themed picker modal instead of
    // blocking synchronously on window.prompt(). The rest of the move
    // logic resumes in applyMove() once the user picks a piece (or reverts
    // the optimistic Chessground move if the picker is cancelled).
    const pieceObj = game.get(orig as any);
    const isPawn = pieceObj && pieceObj.type === 'p';
    const isPromoRank = dest[1] === '8' || dest[1] === '1';

    if (isPawn && isPromoRank) {
      setPendingPromotion({ orig, dest, color: pieceObj!.color });
      return;
    }

    applyMove(orig, dest, undefined);
  };

  const resolvePromotion = (piece: 'q' | 'r' | 'b' | 'n') => {
    if (!pendingPromotion) return;
    const { orig, dest } = pendingPromotion;
    setPendingPromotion(null);
    applyMove(orig, dest, piece);
  };

  const cancelPromotion = () => {
    if (!pendingPromotion) return;
    setPendingPromotion(null);
    // Chessground already optimistically moved the pawn visually; revert it
    // since no move was actually committed to game state.
    if (cgRef.current && game) {
      cgRef.current.set({ fen: game.fen() });
    }
  };

  const applyMove = (orig: string, dest: string, promotionPiece: 'q' | 'r' | 'b' | 'n' | undefined) => {
    if (!game) return;

    const isLobbyOrAnalysis = !isMatchActive;
    if (isLobbyOrAnalysis) {
      if (isEditorMode && isFreeform) {
        const currentFen = currentFenRef.current || (game ? game.fen() : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        const grid = fenToGrid(currentFen);
        
        const origFile = orig.charCodeAt(0) - 97;
        const origRank = 8 - parseInt(orig[1], 10);
        const destFile = dest.charCodeAt(0) - 97;
        const destRank = 8 - parseInt(dest[1], 10);
        
        const piece = grid[origRank]?.[origFile];
        if (piece) {
          grid[origRank][origFile] = "";
          
          const isPawn = piece[1] === 'p';
          if (isPawn && (destRank === 0 || destRank === 7)) {
            const promo = promotionPiece || 'q';
            grid[destRank][destFile] = piece[0] + promo;
          } else {
            grid[destRank][destFile] = piece;
          }
          
          const fields = currentFen.split(' ');
          fields[0] = gridToFenPlacement(grid);
          const newFen = fields.join(' ');
          
          currentFenRef.current = newFen;
          setLiveFenInput(newFen);
          setAnalysisMoves([]);
          setCurrentMoveIdx(-1);
          setBranchesByBase(new Map());
          setActiveBranchBase(null);
          setBranchViewIdx(-1);
          setEditorMoveSource(null);

          try {
            const newGame = new Chess(newFen);
            setGame(newGame);
          } catch (_) {}
        }
        return;
      }

      if (branchViewIdx !== -1 && activeBranchBase !== null) {
        // Already on a branch — extend it, or re-branch again from a point
        // further back inside it. Only that saved branch changes; the
        // real line (analysisMoves) still isn't touched.
        const branchBase = branchMoves.slice(0, branchViewIdx + 1);
        const beforeFen = branchBase[branchBase.length - 1].fen;
        const temp = new Chess(beforeFen);
        let moveObj: any = null;
        try {
          moveObj = temp.move({ from: orig as any, to: dest as any, promotion: promotionPiece });
        } catch (e) {
          // Illegal move
        }
        if (moveObj) {
          const newMove = {
            san: moveObj.san,
            uci: moveObj.from + moveObj.to + (moveObj.promotion || ''),
            fen: temp.fen(),
            from: moveObj.from,
            to: moveObj.to,
          };
          const updatedBranch = [...branchBase, newMove];
          const baseIdx = activeBranchBase;
          setBranchesByBase(prev => {
            const next = new Map(prev);
            next.set(baseIdx, updatedBranch);
            return next;
          });
          setBranchViewIdx(updatedBranch.length - 1);
          setGame(temp);
          updateGameState(temp);
        } else {
          if (cgRef.current) {
            cgRef.current.set({ fen: game.fen() });
          }
        }
        return;
      }

      if (currentMoveIdx < analysisMoves.length - 1) {
        // Stepped back into the middle of the real line. If this is
        // exactly the move that was actually played next, just continue
        // along the real line instead of forking off a redundant branch
        // that duplicates it.
        const nextRealMove = analysisMoves[currentMoveIdx + 1];
        const playedUci = orig + dest + (promotionPiece || '');
        if (nextRealMove && nextRealMove.uci === playedUci) {
          goToAnalysisMove(currentMoveIdx + 1);
          return;
        }

        // Otherwise it's genuinely different — branch off instead of
        // overwriting the real continuation.
        const beforeFen = currentMoveIdx === -1 ? analysisStartingFen : analysisMoves[currentMoveIdx].fen;
        const temp = new Chess(beforeFen);
        let moveObj: any = null;
        try {
          moveObj = temp.move({
            from: orig as any,
            to: dest as any,
            promotion: promotionPiece
          });
        } catch (e) {
          // Illegal move
        }
        if (moveObj) {
          const newMove = {
            san: moveObj.san,
            uci: moveObj.from + moveObj.to + (moveObj.promotion || ''),
            fen: temp.fen(),
            from: moveObj.from,
            to: moveObj.to,
          };
          const baseIdx = currentMoveIdx;
          setBranchesByBase(prev => {
            const next = new Map(prev);
            next.set(baseIdx, [newMove]);
            return next;
          });
          setActiveBranchBase(baseIdx);
          setBranchViewIdx(0);
          setGame(temp);
          updateGameState(temp);
        } else {
          if (cgRef.current) {
            cgRef.current.set({ fen: game.fen() });
          }
        }
        return;
      }
    }

    let moveObj: any = null;
    let newGame: Chess | null = null;
    try {
      newGame = cloneGameWithHistory(game);
      moveObj = newGame.move({
        from: orig as any,
        to: dest as any,
        promotion: promotionPiece
      });
    } catch (e) {
      // Illegal move
    }

    if (moveObj && newGame) {
      if (isLobbyOrAnalysis) {
        const newMove = {
          san: moveObj.san,
          uci: moveObj.from + moveObj.to + (moveObj.promotion || ''),
          fen: newGame.fen(),
          from: moveObj.from,
          to: moveObj.to,
        };
        const updatedMoves = [...analysisMoves, newMove];
        setAnalysisMoves(updatedMoves);
        setCurrentMoveIdx(updatedMoves.length - 1);
      }
      setGame(newGame);
      updateGameState(newGame);
    } else {
      if (cgRef.current) {
        cgRef.current.set({ fen: game.fen() });
      }
    }
  };

  const handleMoveFromCgRef = useRef(handleMoveFromCg);
  useEffect(() => {
    handleMoveFromCgRef.current = handleMoveFromCg;
  });

  const handleBoardMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    mouseDownCoordsRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleBoardMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditorMode || !containerRef.current || !game || !mouseDownCoordsRef.current) return;
    
    const dx = e.clientX - mouseDownCoordsRef.current.x;
    const dy = e.clientY - mouseDownCoordsRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    mouseDownCoordsRef.current = null;
    
    // If it was a drag, ignore it
    if (distance > 5) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    let fileIdx = Math.floor((x / rect.width) * 8);
    let rankIdx = Math.floor((y / rect.height) * 8);
    
    fileIdx = Math.max(0, Math.min(7, fileIdx));
    rankIdx = Math.max(0, Math.min(7, rankIdx));
    
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const file = isFlipped ? files[7 - fileIdx] : files[fileIdx];
    const rank = isFlipped ? (rankIdx + 1) : (8 - rankIdx);
    
    const square = `${file}${rank}`;
    handleEditorSquareClick(square);
  };

  const validateAndApplyEditorPosition = (): boolean => {
    const currentFen = liveFenInput || (game ? game.fen() : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    try {
      const cleanChess = new Chess(currentFen);
      setGame(cleanChess);
      setLiveFenInput(cleanChess.fen());
      updateGameState(cleanChess);
      setEditorPositionError(null);
      return true;
    } catch (e: any) {
      setEditorPositionError(e.message || String(e));
      return false;
    }
  };

  // Chess.js only tracks .history() for moves made via .move()/.undo() on
  // that exact instance — reconstructing via `new Chess(fen)` starts fresh
  // with an empty history, which is why the match move list kept resetting
  // to show only the latest move. This clones `source` with its move
  // history intact (matches always start from the standard position, so
  // replaying its PGN reconstructs it faithfully) so callers can branch off
  // it — via .move() or .undo() — without losing everything before it.
  const cloneGameWithHistory = (source: Chess): Chess => {
    const clone = new Chess();
    const pgn = source.pgn().trim();
    if (pgn) {
      try {
        clone.loadPgn(pgn);
        return clone;
      } catch (_) {
        // fall through to FEN-only clone below
      }
    }
    clone.load(source.fen());
    return clone;
  };

  // Otter's predicted moves are stored as raw UCI (e.g. "e2e4"); render them
  // as SAN for display, matching how Stockfish's candidates are shown.
  const formatUciAsSan = (uci: string, fen?: string): string => {
    if (!fen) return uci;
    try {
      const c = new Chess(fen);
      const mv = c.move({
        from: uci.slice(0, 2) as any,
        to: uci.slice(2, 4) as any,
        promotion: uci.length > 4 ? (uci.slice(4) as any) : undefined,
      });
      return mv ? mv.san : uci;
    } catch (_) {
      return uci;
    }
  };

  // Stockfish's raw centipawn score (White's perspective; mate scores are
  // offset ±100000 — see the MultiPV parsing in initStockfishWorker) as a
  // pawns-style points string for the eval bar pill, e.g. "+0.62" or "M3".
  const formatSfPoints = (raw: number | undefined): string => {
    if (raw === undefined) return '...';
    if (raw > 90000) return `M${100000 - raw}`;
    if (raw < -90000) return `-M${Math.abs(-100000 - raw)}`;
    return (raw > 0 ? '+' : '') + (raw / 100).toFixed(2);
  };

  const syncGameFromFen = (fen: string) => {
    try {
      const c = new Chess(fen);
      setGame(c);
      if (cgRef.current) {
        cgRef.current.set({ fen });
      }
    } catch (_) {}
  };

  const handleEditorSquareClick = (square: string) => {
    if (!isFreeform) return;
    
    const currentFen = currentFenRef.current || (game ? game.fen() : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    const grid = fenToGrid(currentFen);
    
    const fileIdx = square.charCodeAt(0) - 97;
    const rankIdx = 8 - parseInt(square[1], 10);

    if (editorSelectedPiece === 'move') {
      if (editorMoveSource === null) {
        if (grid[rankIdx][fileIdx] !== "") {
          setEditorMoveSource(square);
        }
      } else if (editorMoveSource === square) {
        setEditorMoveSource(null);
      } else {
        const srcFileIdx = editorMoveSource.charCodeAt(0) - 97;
        const srcRankIdx = 8 - parseInt(editorMoveSource[1], 10);
        const piece = grid[srcRankIdx][srcFileIdx];
        if (piece) {
          grid[srcRankIdx][srcFileIdx] = "";
          grid[rankIdx][fileIdx] = piece;
          const fields = currentFen.split(' ');
          fields[0] = gridToFenPlacement(grid);
          const newFen = fields.join(' ');
          currentFenRef.current = newFen;
          setLiveFenInput(newFen);
          setEditorMoveSource(null);
          syncGameFromFen(newFen);
        }
      }
      return;
    }
    
    if (editorSelectedPiece === 'erase') {
      grid[rankIdx][fileIdx] = "";
    } else {
      const type = editorSelectedPiece.slice(1).toLowerCase();
      const color = editorSelectedPiece[0];
      grid[rankIdx][fileIdx] = color + type;
    }
    
    const fields = currentFen.split(' ');
    fields[0] = gridToFenPlacement(grid);
    const newFen = fields.join(' ');
    
    currentFenRef.current = newFen;
    setLiveFenInput(newFen);
    setAnalysisMoves([]);
    setCurrentMoveIdx(-1);
    setBranchesByBase(new Map());
    setActiveBranchBase(null);
    setBranchViewIdx(-1);
    setEditorMoveSource(null);
    syncGameFromFen(newFen);
  };

  // 1. Initial Chessground instantiation
  useEffect(() => {
    if (containerRef.current && game && !cgRef.current) {
      const history = game.history({ verbose: true });
      const lastMove = history.length > 0
        ? [history[history.length - 1].from, history[history.length - 1].to]
        : undefined;

      const cg = Chessground(containerRef.current, {
        fen: game.fen(),
        lastMove: lastMove as any,
        orientation: isFlipped ? 'black' : 'white',
        turnColor: game.turn() === 'w' ? 'white' : 'black',
        movable: {
          free: isEditorMode && isFreeform && editorSelectedPiece === 'move',
          color: (isMatchActive || isAnalyzeMode || isEditorMode)
            ? (isMatchActive ? (playerColor === 'w' ? 'white' : 'black') : 'both')
            : undefined,
          dests: (isMatchActive || isAnalyzeMode || isEditorMode)
            ? (isEditorMode 
                ? (isFreeform ? undefined : getDests(game)) 
                : (isMatchActive 
                    ? (game.turn() === playerColor ? getDests(game) : new Map()) 
                    : getDests(game)))
            : new Map(),
        },
        events: {
          move: (orig, dest) => {
            handleMoveFromCgRef.current(orig, dest);
          }
        },
        drawable: {
          // Manual right-click-drag arrows live in `drawable.shapes` and
          // are expected to clear on the next board click — that's normal
          // chess-site UX. Otter's predicted-move arrows and the checkmate
          // king highlights are programmatic, so they're kept in the
          // separate `drawable.autoShapes` array instead (see the sync
          // effect below): chessground's click-clear only ever touches
          // `shapes`, never `autoShapes`, so ours survive clicks that
          // wipe the user's own hand-drawn ones.
          enabled: true,
          // Custom brushes so each arrow source reads as itself at a
          // glance: Otter in brand green, Stockfish in a light, friendly
          // red (visible without reading as an alarm/error colour), and
          // the player's actual move (when reviewing a finished/loaded
          // game) in yellow.
          brushes: {
            otter: { key: 'otter', color: '#5C8A2E', opacity: 1, lineWidth: 10 },
            stockfish: { key: 'stockfish', color: '#F0605F', opacity: 1, lineWidth: 10 },
            played: { key: 'played', color: '#EAB308', opacity: 1, lineWidth: 10 },
          } as any,
        }
      });
      cgRef.current = cg;
    }
  }, [game]);

  // 1b. Chessground always snaps its rendered board to a multiple of 8
  // device pixels (see node_modules/chessground/src/render.ts updateBounds)
  // to keep squares crisp. If its container isn't already sized to a
  // multiple of 8, that snap leaves a visible gap on the right/bottom edges
  // — this is what shows up as "extra padding" around the board. Rather
  // than fight that, we measure the wrapper's actual content-box size and
  // pin it to the nearest multiple of 8 ourselves, so chessground's own
  // snap becomes a no-op. This also keeps chessground's memoized bounds
  // fresh (redrawAll below) whenever that size changes, e.g. on window
  // resize, which is otherwise never re-measured on its own.
  useEffect(() => {
    const wrapper = boardWrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const size = Math.max(200, Math.floor(Math.min(width, height) / 8) * 8);
      setBoardPx((prev) => (prev === size ? prev : size));
    });
    observer.observe(wrapper);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (boardPx === null) return;
    requestAnimationFrame(() => cgRef.current?.redrawAll());
  }, [boardPx]);

  // 2. Keep Chessground options in sync with external game changes and draw shapes (predictions & checkmate)
  useEffect(() => {
    if (cgRef.current && game) {
      let finalShapes: any[] = [];

      if (isEditorMode && isFreeform && editorSelectedPiece === 'move' && editorMoveSource) {
        finalShapes.push({ orig: editorMoveSource as any, brush: 'blue' });
      }

      if (game.isGameOver()) {
        if (game.isCheckmate()) {
          const squares = [
            'a1','b1','c1','d1','e1','f1','g1','h1',
            'a2','b2','c2','d2','e2','f2','g2','h2',
            'a3','b3','c3','d3','e3','f3','g3','h3',
            'a4','b4','c4','d4','e4','f4','g4','h4',
            'a5','b5','c5','d5','e5','f5','g5','h5',
            'a6','b6','c6','d6','e6','f6','g6','h6',
            'a7','b7','c7','d7','e7','f7','g7','h7',
            'a8','b8','c8','d8','e8','f8','g8','h8'
          ];
          let whiteKing: string | undefined;
          let blackKing: string | undefined;
          for (const sq of squares) {
            const piece = game.get(sq as any);
            if (piece && piece.type === 'k') {
              if (piece.color === 'w') whiteKing = sq;
              else blackKing = sq;
            }
          }
          const loserColor = game.turn();
          const loserKing = loserColor === 'w' ? whiteKing : blackKing;
          const winnerKing = loserColor === 'w' ? blackKing : whiteKing;
          if (loserKing) finalShapes.push({ orig: loserKing as any, brush: 'red' });
          if (winnerKing) finalShapes.push({ orig: winnerKing as any, brush: 'green' });
        }
      } else if (isAnalyzeMode) {
        // One arrow per source instead of Otter's whole top-3 — each in its
        // own colour so it's obvious at a glance who's suggesting what:
        // Otter's own top pick, Stockfish's own top pick, and (when
        // reviewing an already-played game, not mid-branch) the move that
        // was actually played next.
        if (topMoves.length > 0) {
          const m = topMoves[0];
          finalShapes.push({
            orig: m.move.slice(0, 2) as any,
            dest: m.move.slice(2, 4) as any,
            brush: 'otter',
          });
        }
        if (sfTopMoves.length > 0) {
          const m = sfTopMoves[0];
          finalShapes.push({ orig: m.from as any, dest: m.to as any, brush: 'stockfish' });
        }
        if (branchViewIdx === -1 && currentMoveIdx < analysisMoves.length - 1) {
          const actual = analysisMoves[currentMoveIdx + 1];
          if (actual) {
            finalShapes.push({ orig: actual.from as any, dest: actual.to as any, brush: 'played' });
          }
        }
      }

      const history = game.history({ verbose: true });
      const lastMove = history.length > 0
        ? [history[history.length - 1].from, history[history.length - 1].to]
        : undefined;

      cgRef.current.set({
        fen: (isEditorMode && isFreeform) ? liveFenInput : game.fen(),
        lastMove: lastMove as any,
        orientation: isFlipped ? 'black' : 'white',
        turnColor: game.turn() === 'w' ? 'white' : 'black',
        movable: {
          free: isEditorMode && isFreeform && editorSelectedPiece === 'move',
          color: (isMatchActive || isAnalyzeMode || isEditorMode)
            ? (isMatchActive ? (playerColor === 'w' ? 'white' : 'black') : 'both')
            : undefined,
          dests: (isMatchActive || isAnalyzeMode || isEditorMode)
            ? (isEditorMode 
                ? (isFreeform ? undefined : getDests(game)) 
                : (isMatchActive 
                    ? (game.turn() === playerColor ? getDests(game) : new Map()) 
                    : getDests(game)))
            : new Map(),
        },
        drawable: {
          autoShapes: finalShapes as any
        }
      });
    }
  }, [historyMoves, isFlipped, playerColor, topMoves, sfTopMoves, analysisMoves, currentMoveIdx, branchViewIdx, isMatchActive, isAnalyzeMode, isEditorMode, isFreeform, game, liveFenInput, editorSelectedPiece, editorMoveSource]);

  // Check if both engines are fully ready
  const enginesReady = modelAvailable && stockfishAvailable;

  // Timed fade-away effect for ready toast
  useEffect(() => {
    if (enginesReady) {
      const t = setTimeout(() => {
        setShowReadyToast(false);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [enginesReady]);

  const initStockfishWorker = async () => {
    try {
      const cache = await caches.open('otter-model-cache');
      const response = await cache.match('/stockfish.js');
      if (!response) return;

      const blob = await response.blob();
      const workerUrl = URL.createObjectURL(blob);
      const sfWorker = new Worker(workerUrl);

      sfWorker.onmessage = (e: MessageEvent) => {
        const line = e.data;

        if (line.includes('depth 1 ') || line.includes('depth 2 ')) {
          ignoreSearchLinesRef.current = false;
        }

        if (ignoreSearchLinesRef.current) {
          return;
        }

        // MultiPV is enabled (see initStockfishWorker), so each depth reports
        // one `info` line per candidate line (multipv 1..4). Buffer every
        // rank's move as it comes in, and commit the buffer to display after
        // *every* line — not just once at the final depth. Shallow depths
        // resolve in milliseconds and often disagree with each other, so
        // the panel and eval bar visibly flicker/reorder as the search
        // deepens before settling — reads as live engine thought rather
        // than a frozen "Running..." wait.
        if (line.startsWith('info') && line.includes(' pv ')) {
          const parts = line.split(' ');
          const mpvIdx = parts.indexOf('multipv');
          const rank = mpvIdx !== -1 ? parseInt(parts[mpvIdx + 1], 10) : 1;
          const pvIdx = parts.indexOf('pv');
          const firstMoveUci = pvIdx !== -1 ? parts[pvIdx + 1] : null;
          const isMate = line.includes('score mate');
          const isBlackTurn = activeTurnRef.current === 'b';

          let scoreVal = 0;
          if (line.includes('score cp')) {
            const cpIdx = parts.indexOf('cp');
            const cp = parseInt(parts[cpIdx + 1], 10);
            // Standardize centipawns relative to White's perspective
            scoreVal = isBlackTurn ? -cp : cp;
          } else if (isMate) {
            const mateIdx = parts.indexOf('mate');
            const mate = parseInt(parts[mateIdx + 1], 10);
            const normalizedMate = isBlackTurn ? -mate : mate;
            scoreVal = normalizedMate > 0 ? 100000 - normalizedMate : -100000 - normalizedMate;
          }

          if (firstMoveUci) {
            sfMultiPvBufferRef.current.set(rank, { move: firstMoveUci, scoreCp: scoreVal });
          }

          if (rank === 1) {
            if (isMate) {
              const isWhiteWinning = scoreVal > 0;
              setStockfishEvalPct(isWhiteWinning ? 100 : 0);
            } else {
              const maxCp = 400;
              const bounded = Math.max(-maxCp, Math.min(maxCp, scoreVal));
              const pct = Math.round(((bounded + maxCp) / (maxCp * 2)) * 100);
              setStockfishEvalPct(pct);
            }

            const currentFen = currentFenRef.current;
            if (currentFen) {
              setFenScores(prev => ({ ...prev, [currentFen]: scoreVal }));
            }
          }

          // Live-commit whatever ranks have reported so far this depth pass
          // (not necessarily all 4 yet) as the displayed candidate list.
          const baseFen = currentFenRef.current;
          if (baseFen) {
            const ranked = Array.from(sfMultiPvBufferRef.current.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([, v]) => v);
            try {
              const sanRanked = ranked.map(({ move, scoreCp }) => {
                const c = new Chess(baseFen);
                const mv = c.move({
                  from: move.slice(0, 2) as any,
                  to: move.slice(2, 4) as any,
                  promotion: move.length > 4 ? (move.slice(4) as any) : undefined,
                });
                return mv ? { san: mv.san, evalCp: scoreCp, from: mv.from, to: mv.to } : null;
              }).filter((m): m is { san: string; evalCp: number; from: string; to: string } => m !== null);
              setSfTopMoves(sanRanked);
            } catch (_) {
              // keep the previous list rather than flashing empty on a
              // transient parse failure
            }
          }
        }
      };

      sfWorker.postMessage('uci');
      // Ask for the top 4 candidate lines instead of just the best one, so
      // the Analyze-mode comparison panel can show Stockfish's own top
      // moves alongside Otter's, not just a single position eval.
      sfWorker.postMessage('setoption name MultiPV value 4');
      sfWorker.postMessage('isready');
      stockfishRef.current = sfWorker;
    } catch (e) {
      console.error("Failed to init stockfish worker:", e);
    }
  };

  // Background Cache Loader
  const loadAndInitModelFromCache = async () => {
    try {
      // 1. Fetch vocab files
      const v1 = await fetch('/vocab/policy_move_to_id.json').then(r => r.json());
      const v2 = await fetch('/vocab/history_move_to_id.json').then(r => r.json());
      policyMoveToIdRef.current = v1;
      historyMoveToIdRef.current = v2;
      
      const rev: Record<number, string> = {};
      Object.entries(v1).forEach(([k, v]) => {
        rev[v as number] = k;
      });
      idToMoveRef.current = rev;

      // 2. Fetch cached model
      const cache = await caches.open('otter-model-cache');
      const response = await cache.match('/policy_model.onnx');
      if (!response) return;

      const modelBuffer = await response.arrayBuffer();

      // 3. Spin up the inference worker and hand it the model. All
      // session.run() calls happen on this worker's thread from now on —
      // see public/otter-worker.js and callOtterWorker() above.
      otterWorkerRef.current?.terminate();
      const worker = new Worker('/otter-worker.js');
      otterWorkerRef.current = worker;

      worker.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.type !== 'run') return;
        const pending = otterPendingRef.current.get(msg.id);
        if (!pending) return;
        otterPendingRef.current.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg);
      };

      await new Promise<void>((resolve, reject) => {
        const onInit = (ev: MessageEvent) => {
          if (ev.data?.type !== 'init') return;
          worker.removeEventListener('message', onInit);
          if (ev.data.ok) resolve();
          else reject(new Error(ev.data.error || 'Otter worker init failed'));
        };
        worker.addEventListener('message', onInit);
        worker.postMessage({ type: 'init', modelBuffer, provider }, [modelBuffer]);
      });

      setModelLoaded(true);
    } catch (err) {
      console.error("Otter model init failed:", err);
    }

    // Stockfish is a fully independent engine — initialize it regardless of
    // whether Otter's ONNX session above succeeded, so a broken/corrupt
    // Otter model download can't also take down engine analysis.
    await initStockfishWorker();
  };

  // Download Otter Model (62MB)
  const downloadOtterModel = async () => {
    if (isDownloadingModel) return;
    setIsDownloadingModel(true);
    setDownloadError(null);
    setModelProgress(0);
    try {
      const cache = await caches.open('otter-model-cache');
      const res = await fetch('/policy_model.onnx');
      if (!res.body) throw new Error("Null response body");

      const contentLength = res.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 62 * 1024 * 1024;
      const reader = res.body.getReader();
      let loaded = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        setModelProgress(Math.min(99, Math.round((loaded / total) * 100)));
      }

      const blob = new Blob(chunks as any);
      const cacheResponse = new Response(blob, {
        headers: { 'content-type': 'application/octet-stream', 'content-length': blob.size.toString() }
      });
      await cache.put('/policy_model.onnx', cacheResponse);
      
      setModelAvailable(true);
      setModelProgress(100);
      
      // If Stockfish is already downloaded, warm up the model
      if (stockfishAvailable) {
        await loadAndInitModelFromCache();
      }
    } catch (err) {
      console.error("Otter download failed:", err);
      setDownloadError("Failed to download the Otter Chess model. Please check your connection and try again.");
    } finally {
      setIsDownloadingModel(false);
    }
  };

  // Download Stockfish Engine (1.5MB)
  const downloadStockfish = async () => {
    if (isDownloadingSf) return;
    setIsDownloadingSf(true);
    setDownloadError(null);
    setSfProgress(0);
    try {
      const cache = await caches.open('otter-model-cache');
      const res = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
      if (!res.body) throw new Error("Null response body");

      const contentLength = res.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 1.5 * 1024 * 1024;
      const reader = res.body.getReader();
      let loaded = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        setSfProgress(Math.min(99, Math.round((loaded / total) * 100)));
      }

      const blob = new Blob(chunks as any);
      const cacheResponse = new Response(blob, {
        headers: { 'content-type': 'application/javascript', 'content-length': blob.size.toString() }
      });
      await cache.put('/stockfish.js', cacheResponse);
      
      setStockfishAvailable(true);
      setSfProgress(100);

      // If Otter is already downloaded, warm up the model
      if (modelAvailable) {
        await loadAndInitModelFromCache();
      }
    } catch (err) {
      console.error("Stockfish download failed:", err);
      setDownloadError("Failed to download Stockfish. Please check your connection and try again.");
    } finally {
      setIsDownloadingSf(false);
    }
  };

  // Start configured match
  const startMatch = () => {
    if (!game) return;
    
    // Resolve color
    let side: 'w' | 'b' = chosenSide === 'random' 
      ? (Math.random() < 0.5 ? 'w' : 'b') 
      : chosenSide;
    setPlayerColor(side);
    setIsFlipped(side === 'b');

    const baseSec = getBaseSeconds(timeControl);
    setPlayerTime(baseSec);
    setOtterTime(baseSec);
    
    // Reset game state
    const cleanChess = new Chess();
    setGame(cleanChess);
    setHistoryMoves([]);
    setHistoryMovesSan([]);
    setSelectedSquare(null);
    setPossibleSquares([]);
    setTopMoves([]);
    setWinProbability(0.0);
    setAuxMovingPiece("-");
    setAuxCapturedPiece("-");
    setAuxCheckProb("-");
    setAuxFromTo("-");
    setModelPredMove(null);
    
    updateGameState(cleanChess);
    setIsConfigModalOpen(false);
    setIsMatchActive(true);
    if (cgRef.current) {
      cgRef.current.set({
        lastMove: undefined,
        drawable: {
          shapes: [],
          autoShapes: []
        }
      });
    }
  };

  // Resign match
  const resignMatch = () => {
    setShowResignConfirm(false);
    recordMatch('loss');
  };

  // Shared exit handlers — used by both the in-app Exit/Cancel buttons and
  // the browser/mobile back-button handling below, so the two paths can
  // never drift out of sync with each other.
  const exitAnalyzeMode = () => {
    setIsAnalyzeMode(false);
    setAnalysisMoves([]);
    setCurrentMoveIdx(-1);
    setBranchesByBase(new Map());
    setActiveBranchBase(null);
    setBranchViewIdx(-1);
    resetBoard();
  };

  const exitEditorMode = () => {
    setIsEditorMode(false);
    resetBoard();
  };

  // Browser/mobile back-button handling. Without this, pressing back while
  // in Analyze/Match/Editor mode leaves /play entirely (e.g. straight to
  // Home) instead of first backing out to the Lobby, which isn't how any of
  // these sub-views feel like they should behave. Approach: push a history
  // checkpoint (same URL, just a new entry) whenever entering one of these
  // modes; a back-press then lands on that checkpoint as a popstate event
  // instead of actually leaving the page, and we use it to trigger the same
  // exit each mode's own button already performs. If the user exits via that
  // button instead of the back button, we consume the now-unneeded
  // checkpoint ourselves via history.back() so it doesn't linger and eat an
  // extra back-press later.
  const wasInSubViewRef = useRef(false);
  const suppressNextPopRef = useRef(false);

  useEffect(() => {
    const inSubView = isAnalyzeMode || isMatchActive || isEditorMode;
    const wasInSubView = wasInSubViewRef.current;

    if (inSubView && !wasInSubView) {
      window.history.pushState({ otterSubView: true }, '', window.location.href);
    } else if (!inSubView && wasInSubView) {
      if (suppressNextPopRef.current) {
        suppressNextPopRef.current = false;
      } else {
        window.history.back();
      }
    }
    wasInSubViewRef.current = inSubView;
  }, [isAnalyzeMode, isMatchActive, isEditorMode]);

  useEffect(() => {
    const handlePopState = () => {
      if (!wasInSubViewRef.current) {
        // Already in the Lobby — this is a real back-navigation away from
        // /play (e.g. to Home). Let it proceed untouched.
        return;
      }
      suppressNextPopRef.current = true;
      if (isMatchActive) {
        resignMatch(); // auto-resign, no confirmation — matches "back" intent
      } else if (isAnalyzeMode) {
        exitAnalyzeMode();
      } else if (isEditorMode) {
        exitEditorMode();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAnalyzeMode, isMatchActive, isEditorMode]);

  // Otter's own subjective win probability, regardless of whose turn it
  // currently is. `winProbability` (range -1..+1) is computed each move from
  // the perspective of the active mover, so it needs flipping when it isn't
  // currently Otter's turn.
  const getOtterWinProbability = (): number => {
    if (!game) return 0;
    const otterColor = playerColor === 'w' ? 'b' : 'w';
    return game.turn() === otterColor ? winProbability : -winProbability;
  };

  const offerDraw = () => {
    // Otter won't consider a draw before move 15 (30 plies).
    if (historyMoves.length < 30) {
      setDrawDeclined(true);
      return;
    }
    const otterEval = getOtterWinProbability();
    // Accept if the position is roughly balanced, or if Otter is clearly
    // losing. Reject if Otter is clearly winning (or anything in between).
    const accepts = Math.abs(otterEval) < 0.2 || otterEval <= -0.4;
    if (accepts) {
      recordMatch('draw');
    } else {
      setDrawDeclined(true);
    }
  };

  const takeback = () => {
    if (!game || historyMoves.length === 0) return;
    // "Take back" always means undo the PLAYER's last move. If Otter has
    // already replied (it's the player's turn again), that reply needs
    // undoing too so the player lands back at their own turn to reconsider
    // — otherwise only the player's own move needs undoing. Check whose
    // turn it is BEFORE undoing anything, since undoing changes game.turn().
    const otterAlreadyReplied = game.turn() === playerColor;

    // Undo on the live `game` instance — it's the one with real move
    // history from the .move() calls made during play. Reconstructing via
    // `new Chess(game.fen())` would start with an empty history stack,
    // making .undo() a silent no-op.
    game.undo();
    if (otterAlreadyReplied) {
      game.undo();
    }
    // Clone with history preserved (via cloneGameWithHistory) rather than
    // `new Chess(game.fen())`, so the move list reflects the remaining
    // moves after the takeback instead of resetting to empty.
    const newGame = cloneGameWithHistory(game);
    setGame(newGame);
    updateGameState(newGame);
    if (cgRef.current) {
      cgRef.current.set({ fen: newGame.fen() });
    }
  };

  // Record completed match in history
  const recordMatch = (result: 'win' | 'loss' | 'draw') => {
    // Clear top predictions
    setTopMoves([]);

    // Highlight winning/losing kings
    if (cgRef.current && game) {
      const squares = [
        'a1','b1','c1','d1','e1','f1','g1','h1',
        'a2','b2','c2','d2','e2','f2','g2','h2',
        'a3','b3','c3','d3','e3','f3','g3','h3',
        'a4','b4','c4','d4','e4','f4','g4','h4',
        'a5','b5','c5','d5','e5','f5','g5','h5',
        'a6','b6','c6','d6','e6','f6','g6','h6',
        'a7','b7','c7','d7','e7','f7','g7','h7',
        'a8','b8','c8','d8','e8','f8','g8','h8'
      ];
      let whiteKing: string | undefined;
      let blackKing: string | undefined;
      for (const sq of squares) {
        const piece = game.get(sq as any);
        if (piece && piece.type === 'k') {
          if (piece.color === 'w') whiteKing = sq;
          else blackKing = sq;
        }
      }

      if (result === 'win' || result === 'loss') {
        const isWhiteWinner = (result === 'win' && playerColor === 'w') || (result === 'loss' && playerColor === 'b');
        const winnerKing = isWhiteWinner ? whiteKing : blackKing;
        const loserKing = isWhiteWinner ? blackKing : whiteKing;
        const shapes = [];
        if (loserKing) shapes.push({ orig: loserKing as any, brush: 'red' });
        if (winnerKing) shapes.push({ orig: winnerKing as any, brush: 'green' });
        cgRef.current.set({ drawable: { autoShapes: shapes as any } });
      }
    }
    
    // Update PGN Result Header on the game object before final render
    if (game) {
      const pgnResult = result === 'win' ? (playerColor === 'w' ? '1-0' : '0-1') :
                        result === 'loss' ? (playerColor === 'w' ? '0-1' : '1-0') :
                        '1/2-1/2';
      game.header('Result', pgnResult);
      setLivePgnInput(game.pgn());
    }

    // Calculate new ELO rating
    const outcome = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    const expected = 1 / (1 + Math.pow(10, (playerElo - playerRating) / 400));
    const newRating = Math.round(playerRating + 32 * (outcome - expected));
    setPlayerRating(newRating);
    localStorage.setItem('otter-player-rating', newRating.toString());

    const record: MatchRecord = {
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toLocaleDateString(),
      opponentElo: playerElo, // challenging target rating
      timeControl: timeControl,
      playerColor: playerColor,
      result: result,
      movesCount: historyMoves.length,
      pgn: game?.pgn() || ''
    };

    const newHistory = [record, ...matchHistory];
    setMatchHistory(newHistory);
    localStorage.setItem('otter-match-history', JSON.stringify(newHistory));
    
    setIsMatchActive(false);
    resetBoard();
  };

  const handleFenInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isMatchActive) return;
    const val = e.target.value;
    setLiveFenInput(val);

    try {
      const tempChess = new Chess();
      tempChess.load(val);
      setAnalysisStartingFen(val);
      setAnalysisMoves([]);
      setCurrentMoveIdx(-1);
      setBranchesByBase(new Map());
      setActiveBranchBase(null);
      setBranchViewIdx(-1);
      setGame(tempChess);
      updateGameState(tempChess);
    } catch (err) {
      // Allow partial typings
    }
  };

  const handlePgnInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isMatchActive) return;
    const val = e.target.value;
    setLivePgnInput(val);

    try {
      const tempChess = new Chess();
      tempChess.loadPgn(val);
      const verboseMoves = tempChess.history({ verbose: true });
      const chronologicalMoves: any[] = [];
      const timelineChess = new Chess();
      const initialFen = timelineChess.fen();

      for (const m of verboseMoves) {
        timelineChess.move(m.san);
        chronologicalMoves.push({
          san: m.san,
          uci: m.from + m.to + (m.promotion || ''),
          fen: timelineChess.fen(),
          from: m.from,
          to: m.to,
        });
      }

      setAnalysisMoves(chronologicalMoves);
      setCurrentMoveIdx(chronologicalMoves.length - 1);
      setBranchesByBase(new Map());
      setActiveBranchBase(null);
      setBranchViewIdx(-1);
      setAnalysisStartingFen(initialFen);
      setGame(timelineChess);
      updateGameState(timelineChess);
    } catch (err) {
      // Allow partial typings
    }
  };

  const handleAnalyzeClick = () => {
    if (!game) return;
    const isStartingFen = game.fen() === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const hasCustomPosition = !isStartingFen || analysisMoves.length > 0;

    // Always surface the modal — pre-filled with the current game so
    // "Load Analysis" is still one click when there's a position worth
    // continuing with, but "Start From Initial Position" is right there
    // too instead of only being reachable when the board happens to be
    // empty.
    setAnalyzeError(null);
    setAnalyzeInput(hasCustomPosition ? (game.pgn().trim() || game.fen()) : "");
    setIsAnalyzeModalOpen(true);
  };

  const openEditor = () => {
    if (!game) return;
    const currentFen = game.fen();
    const fields = currentFen.split(' ');
    setEditorTurn(fields[1] as any);
    
    const cStr = fields[2];
    setEditorCastling({
      wK: cStr.includes('K'),
      wQ: cStr.includes('Q'),
      bK: cStr.includes('k'),
      bQ: cStr.includes('q'),
    });
    
    currentFenRef.current = currentFen;
    setLiveFenInput(currentFen);
    setIsEditorMode(true);
  };

  const updateEditorFen = (turn: 'w' | 'b', castling: typeof editorCastling) => {
    const currentFen = currentFenRef.current || (game ? game.fen() : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    const fields = currentFen.split(' ');
    fields[1] = turn;
    
    let castlingStr = "";
    if (castling.wK) castlingStr += "K";
    if (castling.wQ) castlingStr += "Q";
    if (castling.bK) castlingStr += "k";
    if (castling.bQ) castlingStr += "q";
    fields[2] = castlingStr || "-";
    
    const targetFen = fields.join(' ');
    currentFenRef.current = targetFen;
    setLiveFenInput(targetFen);
    // Keep `game` (and therefore Chessground's movable.dests) in sync — without
    // this, toggling turn/castling updates the FEN text but the board keeps
    // enforcing the previous turn's legal moves until something else resyncs it.
    syncGameFromFen(targetFen);
  };

  // 4. Game Analysis Logic
  // Seeds the two Analyze-mode rating-bracket sliders. Prefers the PGN's
  // own WhiteElo/BlackElo headers (when both parse); otherwise falls back
  // to the ratings from the match just played — the human's configured
  // playerRating for whichever color they had, Otter's configured
  // playerElo for the other — so jumping into Analyze mode straight off
  // an active/finished match starts from the ratings that were actually
  // in play rather than a generic 1500/1500.
  const applyDefaultAnalyzeElos = (whiteHeader: string | null, blackHeader: string | null) => {
    const snap = (n: number) => Math.max(800, Math.min(2600, Math.round(n / 100) * 100));
    const hw = whiteHeader ? parseInt(whiteHeader, 10) : NaN;
    const hb = blackHeader ? parseInt(blackHeader, 10) : NaN;
    if (!isNaN(hw) && !isNaN(hb)) {
      setAnalyzeWhiteElo(snap(hw));
      setAnalyzeBlackElo(snap(hb));
    } else {
      setAnalyzeWhiteElo(snap(playerColor === 'w' ? playerRating : playerElo));
      setAnalyzeBlackElo(snap(playerColor === 'b' ? playerRating : playerElo));
    }
  };

  const loadGameForAnalysis = (input: string) => {
    const cleanInput = input.trim();
    if (!cleanInput) return;

    const tempChess = new Chess();
    setAnalyzeError(null);
    // Board defaults to White-at-bottom (standard convention) for every
    // freshly loaded analysis game — Flip still works manually afterward.
    setIsFlipped(false);

    // Try reading as FEN first
    try {
      tempChess.load(cleanInput);
      setAnalysisMoves([]);
      setCurrentMoveIdx(-1);
      setBranchesByBase(new Map());
      setActiveBranchBase(null);
      setBranchViewIdx(-1);
      setAnalysisStartingFen(cleanInput);
      setGame(tempChess);
      setIsAnalyzeMode(true);
      setIsAnalyzeModalOpen(false);
      updateGameState(tempChess);
      // A bare FEN has no player names/ratings to show.
      setAnalysisWhiteName(null);
      setAnalysisBlackName(null);
      setAnalysisWhiteElo(null);
      setAnalysisBlackElo(null);
      applyDefaultAnalyzeElos(null, null);
      return;
    } catch (e) {}

    // Try loading as PGN
    try {
      const tempPgnChess = new Chess();
      tempPgnChess.loadPgn(cleanInput);
      const moves = tempPgnChess.history({ verbose: true });
      const chronologicalMoves: any[] = [];
      const timelineChess = new Chess();
      const initialFen = timelineChess.fen();

      for (const m of moves) {
        timelineChess.move(m.san);
        chronologicalMoves.push({
          san: m.san,
          uci: m.from + m.to + (m.promotion || ''),
          fen: timelineChess.fen(),
          from: m.from,
          to: m.to,
        });
      }

      setAnalysisMoves(chronologicalMoves);
      setCurrentMoveIdx(-1);
      setBranchesByBase(new Map());
      setActiveBranchBase(null);
      setBranchViewIdx(-1);
      setAnalysisStartingFen(initialFen);

      const startChess = new Chess();
      setGame(startChess);
      setIsAnalyzeMode(true);
      setIsAnalyzeModalOpen(false);
      updateGameState(startChess);

      // Pull player names/ratings straight from the PGN headers — `game`
      // itself won't retain them since navigation reloads it from bare FENs.
      const headers = tempPgnChess.header();
      const cleanHeader = (v: string | undefined) => (v && v !== '?' ? v : null);
      const whiteEloHeader = cleanHeader(headers.WhiteElo);
      const blackEloHeader = cleanHeader(headers.BlackElo);
      setAnalysisWhiteName(cleanHeader(headers.White));
      setAnalysisBlackName(cleanHeader(headers.Black));
      setAnalysisWhiteElo(whiteEloHeader);
      setAnalysisBlackElo(blackEloHeader);
      applyDefaultAnalyzeElos(whiteEloHeader, blackEloHeader);
      return;
    } catch (e) {}

    setAnalyzeError("Invalid FEN or PGN. Please verify the format.");
  };

  const goToAnalysisMove = (idx: number) => {
    if (isMatchActive || !game) return;
    if (idx < -1 || idx >= analysisMoves.length) return;

    // Jumping to a real-line move exits whatever branch was being viewed —
    // but the branch itself stays saved in branchesByBase and reappears if
    // you navigate back to where it diverged.
    setActiveBranchBase(null);
    setBranchViewIdx(-1);
    setCurrentMoveIdx(idx);

    const c = new Chess();
    if (idx === -1) {
      c.load(analysisStartingFen);
    } else {
      c.load(analysisMoves[idx].fen);
    }

    setGame(c);
    updateGameState(c);
  };

  const goToBranchMove = (idx: number) => {
    if (isMatchActive || !game) return;
    if (idx < 0 || idx >= branchMoves.length) return;

    setBranchViewIdx(idx);
    const c = new Chess();
    c.load(branchMoves[idx].fen);
    setGame(c);
    updateGameState(c);
  };

  // Switches to a saved branch that isn't the one currently being viewed —
  // clicking into it from the move list. Unlike goToBranchMove (which
  // steps within whichever branch is already active), this also has to
  // pick which branch becomes active and re-pin currentMoveIdx to its
  // divergence point.
  const activateBranch = (baseIdx: number, idx: number) => {
    if (isMatchActive || !game) return;
    const branch = branchesByBase.get(baseIdx);
    if (!branch || idx < 0 || idx >= branch.length) return;

    setActiveBranchBase(baseIdx);
    setBranchViewIdx(idx);
    setCurrentMoveIdx(baseIdx);
    const c = new Chess();
    c.load(branch[idx].fen);
    setGame(c);
    updateGameState(c);
  };

  // Single "next/previous" that works whether you're on the real line or a
  // branch. Stepping past the branch's first move exits it and lands back
  // on the real line at the point it diverged from — from there, stepping
  // forward again just continues the real line, per the "branching is
  // temporary" rule.
  const stepAnalysis = (direction: 1 | -1) => {
    if (isMatchActive || !game) return;

    if (branchViewIdx !== -1) {
      const nextBranchIdx = branchViewIdx + direction;
      if (direction === 1) {
        if (nextBranchIdx < branchMoves.length) goToBranchMove(nextBranchIdx);
        return;
      }
      if (nextBranchIdx >= 0) {
        goToBranchMove(nextBranchIdx);
        return;
      }
      // Stepped back past the branch's first move — exit to the real line
      // at the divergence point. The branch stays saved (see
      // branchesByBase) and reappears if you come back to this point.
      setActiveBranchBase(null);
      setBranchViewIdx(-1);
      const c = new Chess();
      c.load(currentMoveIdx === -1 ? analysisStartingFen : analysisMoves[currentMoveIdx].fen);
      setGame(c);
      updateGameState(c);
      return;
    }

    goToAnalysisMove(currentMoveIdx + direction);
  };

  // "Go to start" always means the real game's actual start — exits any
  // branch. "Go to end" stays on whichever you're currently viewing: the
  // end of the branch if you're on one, otherwise the end of the real line.
  const jumpToAnalysisStart = () => goToAnalysisMove(-1);
  const jumpToAnalysisEnd = () => {
    if (branchViewIdx !== -1) {
      if (branchMoves.length > 0) goToBranchMove(branchMoves.length - 1);
    } else {
      goToAnalysisMove(analysisMoves.length - 1);
    }
  };

  // Keyboard navigation for analysis
  useEffect(() => {
    if (isMatchActive || analysisMoves.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepAnalysis(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepAnalysis(-1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        jumpToAnalysisStart();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        jumpToAnalysisEnd();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAnalyzeMode, analysisMoves, currentMoveIdx, branchesByBase, activeBranchBase, branchViewIdx]);

  // Dynamically compute played move quality and Otter human predictions match
  useEffect(() => {
    if (!isAnalyzeMode || currentMoveIdx < 0 || analysisMoves.length === 0) {
      setPlayedMoveEvaluation("");
      setSimilarityPct(0);
      return;
    }

    const idx = currentMoveIdx;
    const playedMove = analysisMoves[idx];
    const fenBefore = idx === 0 ? analysisStartingFen : analysisMoves[idx - 1].fen;
    const fenAfter = playedMove.fen;

    const scoreBefore = fenScores[fenBefore];
    const scoreAfter = fenScores[fenAfter];

    // 1. Label Stockfish move accuracy drops
    if (scoreBefore !== undefined && scoreAfter !== undefined) {
      const whiteMoved = idx % 2 === 0;
      const playerDrop = whiteMoved ? (scoreBefore - scoreAfter) : (scoreAfter - scoreBefore);

      let evalLabel = "Good Move";
      if (playerDrop > 200) {
        evalLabel = "Blunder";
      } else if (playerDrop > 100) {
        evalLabel = "Mistake";
      } else if (playerDrop > 50) {
        evalLabel = "Inaccuracy";
      } else if (playerDrop < -30) {
        evalLabel = "Best Move";
      }
      setPlayedMoveEvaluation(evalLabel);

      setAnalysisMoves(prev => {
        if (prev[idx] && prev[idx].classification !== evalLabel) {
          const next = [...prev];
          next[idx] = { ...next[idx], classification: evalLabel };
          return next;
        }
        return prev;
      });
    } else {
      setPlayedMoveEvaluation("Evaluating...");
    }

    // 2. Resolve Otter Human predictions similarity
    const prevPreds = fenPredictions[fenBefore] || [];
    const match = prevPreds.find(pm => pm.move === playedMove.uci);
    if (match) {
      setSimilarityPct(Math.round(match.probability * 100));
    } else {
      setSimilarityPct(0);
      if (modelLoaded) {
        try {
          const prevChess = new Chess(fenBefore);
          runModelInference(prevChess, []);
        } catch (e) {
          console.warn("Skipping similarity calculations for invalid FEN:", fenBefore);
        }
      }
    }
  }, [currentMoveIdx, fenScores, fenPredictions, isAnalyzeMode, analysisMoves, analysisStartingFen]);

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
  }, [isAnalyzeMode, game, historyMoves, modelLoaded, analyzeWhiteElo, analyzeBlackElo]);

  // Update board grid and game status
  const updateGameState = (c: Chess) => {
    setBoard(c.board() as (Piece | null)[][]);
    const verboseHistory = c.history({ verbose: true });
    const moves = verboseHistory.map(m => m.from + m.to + (m.promotion || ''));
    setHistoryMoves(moves);
    setHistoryMovesSan(verboseHistory.map(m => m.san));
    
    // Set standard PGN metadata headers if they are missing or contain default '?' placeholders
    const currentHeaders = c.header();
    const needsHeaders = !currentHeaders.Event || currentHeaders.Event === '?' || currentHeaders.White === '?';
    if (needsHeaders) {
      const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '.');
      c.header(
        'Event', isMatchActive ? 'Otter Chess Match' : 'Otter Chess Analysis',
        'Site', typeof window !== 'undefined' ? window.location.host : 'Otter Chess Web',
        'Date', dateStr,
        'Round', '1',
        'White', playerColor === 'w' ? 'Guest' : `Otter AI (${playerElo})`,
        'Black', playerColor === 'b' ? 'Guest' : `Otter AI (${playerElo})`,
        'Result', c.isGameOver() ? (c.isCheckmate() ? (c.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2') : '*'
      );
    } else {
      const expectedResult = c.isGameOver() ? (c.isCheckmate() ? (c.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2') : '*';
      if (currentHeaders.Result !== expectedResult) {
        c.header('Result', expectedResult);
      }
    }

    setLiveFenInput(c.fen());
    setLivePgnInput(c.pgn());
    
    currentFenRef.current = c.fen();
    activeTurnRef.current = c.turn();
    ignoreSearchLinesRef.current = true;
    // Drop the previous position's candidates immediately so the live
    // depth-by-depth updates for the new position don't briefly show
    // stale moves left over from the last one.
    sfMultiPvBufferRef.current.clear();
    setSfTopMoves([]);

    if (stockfishRef.current) {
      stockfishRef.current.postMessage('stop');
      stockfishRef.current.postMessage(`position fen ${c.fen()}`);
      stockfishRef.current.postMessage('go depth 13');
    }

    if (modelLoaded && (isAnalyzeMode || !isMatchActive || c.turn() === playerColor)) {
      runModelInference(c, moves);
    }
    
    // Calculate highlights on checkmate
    let endOfGameShapes: any[] = [];
    if (c.isCheckmate() || c.isDraw()) {
      setTopMoves([]); // Clear predictions upon game end
      
      if (c.isCheckmate()) {
        const squares = [
          'a1','b1','c1','d1','e1','f1','g1','h1',
          'a2','b2','c2','d2','e2','f2','g2','h2',
          'a3','b3','c3','d3','e3','f3','g3','h3',
          'a4','b4','c4','d4','e4','f4','g4','h4',
          'a5','b5','c5','d5','e5','f5','g5','h5',
          'a6','b6','c6','d6','e6','f6','g6','h6',
          'a7','b7','c7','d7','e7','f7','g7','h7',
          'a8','b8','c8','d8','e8','f8','g8','h8'
        ];
        let whiteKing: string | undefined;
        let blackKing: string | undefined;
        for (const sq of squares) {
          const piece = c.get(sq as any);
          if (piece && piece.type === 'k') {
            if (piece.color === 'w') whiteKing = sq;
            else blackKing = sq;
          }
        }
        const loserColor = c.turn();
        const loserKing = loserColor === 'w' ? whiteKing : blackKing;
        const winnerKing = loserColor === 'w' ? blackKing : whiteKing;
        if (loserKing) endOfGameShapes.push({ orig: loserKing as any, brush: 'red' });
        if (winnerKing) endOfGameShapes.push({ orig: winnerKing as any, brush: 'green' });
      }
    }

    if (cgRef.current) {
      cgRef.current.set({
        drawable: {
          autoShapes: endOfGameShapes as any
        }
      });
    }

    if (c.isCheckmate()) {
      const winnerColor = c.turn() === 'w' ? 'b' : 'w';
      setGameStatus(`Checkmate! ${winnerColor === 'w' ? 'White' : 'Black'} wins.`);
      if (isMatchActive && !isAnalyzeMode) {
        const outcome = winnerColor === playerColor ? 'win' : 'loss';
        setTimeout(() => recordMatch(outcome), 2500);
      }
    } else if (c.isDraw()) {
      setGameStatus("Game Over - Draw.");
      if (isMatchActive && !isAnalyzeMode) {
        setTimeout(() => recordMatch('draw'), 2500);
      }
    } else if (c.inCheck()) {
      setGameStatus(`Check! ${c.turn() === 'w' ? "White" : "Black"}'s turn.`);
    } else {
      setGameStatus(`${c.turn() === 'w' ? "White" : "Black"}'s turn.`);
    }
    setSelectedSquare(null);
    setPossibleSquares([]);
  };

  // Post one inference request to the Otter worker and resolve when its
  // matching response comes back. 'live' requests jump ahead of any queued
  // 'sweep' request on the worker side (see public/otter-worker.js) — the
  // per-move panel should never wait behind the rating-curve sweep.
  const callOtterWorker = (
    priority: 'live' | 'sweep',
    tensors: {
      board: Float32Array; historyIds: BigInt64Array; historyMask: Uint8Array;
      activeElo: number; opponentElo: number; tc: number; clock: number[];
    },
    wantAux: boolean
  ): Promise<{ policyLogits: Float32Array; auxLogits?: Float32Array; valuePred?: number }> => {
    const worker = otterWorkerRef.current;
    if (!worker) return Promise.reject(new Error('Otter worker not ready'));
    const id = ++otterReqIdRef.current;
    return new Promise((resolve, reject) => {
      otterPendingRef.current.set(id, { resolve, reject });
      worker.postMessage({
        type: 'run',
        id,
        priority,
        wantAux,
        board: tensors.board,
        historyIds: tensors.historyIds,
        historyMask: tensors.historyMask,
        activeElo: tensors.activeElo,
        opponentElo: tensors.opponentElo,
        tc: tensors.tc,
        clock: tensors.clock,
      }, [tensors.board.buffer, tensors.historyIds.buffer, tensors.historyMask.buffer]);
    });
  };

  // Run model prediction via ONNX
  const runModelInference = async (c: Chess, history: string[]): Promise<PredictedMove[] | null> => {
    // Validate FEN compatibility with chess.js to avoid throws during editing
    try {
      new Chess(c.fen());
    } catch (e) {
      console.warn("Skipping model inference for invalid FEN:", c.fen());
      return null;
    }

    if (!otterWorkerRef.current || !modelLoaded) return null;

    const currentSeq = ++lastInferenceSeqRef.current;

    try {
      // 1. Board Tensor mapping
      const boardData = boardToTensor(c);

      // 2. Map history sequence (canonicalize moves made by Black)
      const canonicalHistory: string[] = [];
      for (let i = 0; i < history.length; i++) {
        const move = history[i];
        const canon = (i % 2 === 1) ? mirrorMove(move) : move;
        canonicalHistory.push(canon);
      }

      const historyIds = new BigInt64Array(20);
      const historyMask = new Uint8Array(20);
      const k = 20;
      const windowMoves = canonicalHistory.slice(-k);
      const startIdx = k - windowMoves.length;

      for (let i = 0; i < windowMoves.length; i++) {
        const move = windowMoves[i];
        const token = historyMoveToIdRef.current[move] || 0;
        historyIds[startIdx + i] = BigInt(token);
        historyMask[startIdx + i] = 1;
      }

      // 3. Resolve rating brackets
      const eloToBucket = (elo: number) => {
        if (elo < 1100) return 0;
        if (elo >= 2000) return 10;
        return 1 + Math.floor((elo - 1100) / 100);
      };

      // In Analyze mode, both sides' ratings come from the two bracket
      // sliders at the top of the sidebar instead of the Challenge Otter
      // match config — "active" is whoever's turn it is right now.
      let activeElo: number;
      let opponentEloVal: number;
      if (isAnalyzeMode) {
        const whiteBucket = eloToBucket(analyzeWhiteElo);
        const blackBucket = eloToBucket(analyzeBlackElo);
        activeElo = c.turn() === 'w' ? whiteBucket : blackBucket;
        opponentEloVal = c.turn() === 'w' ? blackBucket : whiteBucket;
      } else {
        const isActivePlayerTurn = c.turn() === playerColor;
        activeElo = eloToBucket(isActivePlayerTurn ? playerRating : playerElo);
        opponentEloVal = eloToBucket(isActivePlayerTurn ? playerElo : playerRating);
      }

      // 4. Time format mapping
      const tcToBucket = (tc: string) => {
        if (!tc || !tc.includes('+')) return 4;
        try {
          const parts = tc.split('+');
          const base = parseInt(parts[0], 10);
          const inc = parseInt(parts[1], 10);
          const eff = base + 40 * inc;
          if (eff < 60) return 0;
          if (eff < 180) return 1;
          if (eff < 600) return 2;
          if (eff < 1800) return 3;
          return 4;
        } catch {
          return 4;
        }
      };
      const timeControlBucket = tcToBucket(timeControl);
      const activeTimeRemaining = c.turn() === playerColor ? playerTime : otterTime;
      const baseSec = getBaseSeconds(timeControl);
      const normalizedClockFraction = baseSec > 0 ? activeTimeRemaining / baseSec : 0.5;

      // 5. Run on the Otter worker (off the main thread)
      const { policyLogits, auxLogits, valuePred } = await callOtterWorker('live', {
        board: boardData,
        historyIds,
        historyMask,
        activeElo,
        opponentElo: opponentEloVal,
        tc: timeControlBucket,
        clock: [normalizedClockFraction, 0.0],
      }, true);

      // A newer inference started while this one was in flight — its
      // result is stale, drop it instead of clobbering fresher state.
      if (currentSeq !== lastInferenceSeqRef.current) {
        return null;
      }

      // Set win evaluation
      setWinProbability(valuePred as number);

      // Filter legal moves
      const legalMoves = c.history({ verbose: true }).length > 0
        ? c.history({ verbose: true }) // placeholder
        : [];
      
      const legalUcis = c.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
      const unsorted: PredictedMove[] = [];

      const isBlackTurn = c.turn() === 'b';
      legalUcis.forEach((moveUci) => {
        // Test if this move is mate in 1
        const temp = new Chess(c.fen());
        try {
          temp.move({
            from: moveUci.slice(0, 2),
            to: moveUci.slice(2, 4),
            promotion: moveUci.length > 4 ? moveUci.slice(4) : undefined
          });
          if (temp.isCheckmate()) {
            unsorted.push({
              move: moveUci,
              probability: 999.0
            });
            return;
          }
        } catch {}

        const canonMove = isBlackTurn ? mirrorMove(moveUci) : moveUci;
        const id = policyMoveToIdRef.current[canonMove];
        if (id !== undefined) {
          const logit = policyLogits[id];
          unsorted.push({
            move: moveUci,
            probability: logit
          });
        } else {
          unsorted.push({ move: moveUci, probability: -999.0 });
        }
      });

      // Apply softmax approximations on legal moves logit slice
      const maxLogit = Math.max(...unsorted.map(m => m.probability));
      const expSum = unsorted.reduce((acc, m) => acc + Math.exp(m.probability - maxLogit), 0);
      const sortedMoves = unsorted.map((m) => ({
        move: m.move,
        probability: Math.exp(m.probability - maxLogit) / expSum
      })).sort((a, b) => b.probability - a.probability);

      setTopMoves(sortedMoves);
      
      // Populate predictions cache
      setFenPredictions(prev => ({ ...prev, [c.fen()]: sortedMoves }));

      // Decode auxiliary metrics
      const sigmoid = (val: number) => 1 / (1 + Math.exp(-val));
      const softmax = (arr: number[]) => {
        const maxVal = Math.max(...arr);
        const exps = arr.map(v => Math.exp(v - maxVal));
        const sum = exps.reduce((a, b) => a + b, 0);
        return exps.map(v => v / sum);
      };

      const pieceNames = ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King"];

      const mvProbs = softmax(Array.from(auxLogits!.slice(0, 6)) as number[]);
      const mvIdx = mvProbs.indexOf(Math.max(...mvProbs));
      setAuxMovingPiece(`${pieceNames[mvIdx]} (${(mvProbs[mvIdx] * 100).toFixed(0)}%)`);

      let capText = "None";
      if (sortedMoves.length > 0) {
        const topMove = sortedMoves[0].move;
        const toSq = topMove.slice(2, 4);
        const targetPiece = c.get(toSq as any);
        if (targetPiece) {
          const capProbs = softmax(Array.from(auxLogits!.slice(6, 12)) as number[]);
          const capIdx = capProbs.indexOf(Math.max(...capProbs));
          capText = `${pieceNames[capIdx]} (${(capProbs[capIdx] * 100).toFixed(0)}%)`;
        }
      }
      setAuxCapturedPiece(capText);

      const checkProb = sigmoid(auxLogits![12] as number);
      setAuxCheckProb(`${(checkProb * 100).toFixed(0)}%`);

      // The aux head's own from/to square guess — independent of the
      // policy head above, decoded from the 128 dims (13:77 from-square,
      // 77:141 to-square) that were previously computed but never used.
      // Squares come out in the same canonical (rank-mirrored for Black)
      // space as policy moves, so they need the same un-mirror step.
      const squareFromAuxIndex = (idx: number): string => {
        const file = idx % 8;
        const rank0 = Math.floor(idx / 8);
        const canonicalSq = `${String.fromCharCode(97 + file)}${rank0 + 1}`;
        return isBlackTurn ? mirrorSquare(canonicalSq) : canonicalSq;
      };
      const fromProbs = softmax(Array.from(auxLogits!.slice(13, 77)) as number[]);
      const fromIdx = fromProbs.indexOf(Math.max(...fromProbs));
      setAuxIntuitionFrom(squareFromAuxIndex(fromIdx));
      setAuxIntuitionFromConf(fromProbs[fromIdx]);

      const toProbs = softmax(Array.from(auxLogits!.slice(77, 141)) as number[]);
      const toIdx = toProbs.indexOf(Math.max(...toProbs));
      setAuxIntuitionTo(squareFromAuxIndex(toIdx));
      setAuxIntuitionToConf(toProbs[toIdx]);

      if (sortedMoves.length > 0) {
        const topMove = sortedMoves[0].move;
        setAuxFromTo(`${topMove.slice(0, 2)} → ${topMove.slice(2, 4)}`);
        setModelPredMove({ from: topMove.slice(0, 2), to: topMove.slice(2, 4) });
      }

      return sortedMoves;

    } catch (err) {
      console.error("ORT evaluation error:", err);
      return null;
    }
  };

  // Side-effect-free variant of runModelInference for the "Moves by
  // Rating" curve: same tensors, but active_elo is pinned to whichever
  // bucket the caller asks about instead of the configured player rating,
  // and nothing here touches the live prediction state (topMoves, eval
  // bar, aux panels) — this is a background "what if" query, run in a
  // loop across every rating bucket for a single position.
  const runModelInferenceAtElo = async (c: Chess, history: string[], activeEloBucket: number): Promise<PredictedMove[] | null> => {
    if (!otterWorkerRef.current || !modelLoaded) return null;

    try {
      const boardData = boardToTensor(c);

      const canonicalHistory: string[] = [];
      for (let i = 0; i < history.length; i++) {
        const move = history[i];
        canonicalHistory.push((i % 2 === 1) ? mirrorMove(move) : move);
      }
      const historyIds = new BigInt64Array(20);
      const historyMask = new Uint8Array(20);
      const k = 20;
      const windowMoves = canonicalHistory.slice(-k);
      const startIdx = k - windowMoves.length;
      for (let i = 0; i < windowMoves.length; i++) {
        const token = historyMoveToIdRef.current[windowMoves[i]] || 0;
        historyIds[startIdx + i] = BigInt(token);
        historyMask[startIdx + i] = 1;
      }

      const eloToBucket = (elo: number) => {
        if (elo < 1100) return 0;
        if (elo >= 2000) return 10;
        return 1 + Math.floor((elo - 1100) / 100);
      };
      // Analyze-only helper (used by the rating-curve sweep) — the
      // opponent's rating comes from whichever slider belongs to the
      // *other* side, since activeEloBucket here is the value being swept.
      const opponentEloVal = eloToBucket(c.turn() === 'w' ? analyzeBlackElo : analyzeWhiteElo);

      const tcToBucket = (tc: string) => {
        if (!tc || !tc.includes('+')) return 4;
        try {
          const parts = tc.split('+');
          const base = parseInt(parts[0], 10);
          const inc = parseInt(parts[1], 10);
          const eff = base + 40 * inc;
          if (eff < 60) return 0;
          if (eff < 180) return 1;
          if (eff < 600) return 2;
          if (eff < 1800) return 3;
          return 4;
        } catch {
          return 4;
        }
      };
      const timeControlBucket = tcToBucket(timeControl);
      const activeTimeRemaining = c.turn() === playerColor ? playerTime : otterTime;
      const baseSec = getBaseSeconds(timeControl);
      const normalizedClockFraction = baseSec > 0 ? activeTimeRemaining / baseSec : 0.5;

      const { policyLogits } = await callOtterWorker('sweep', {
        board: boardData,
        historyIds,
        historyMask,
        activeElo: activeEloBucket,
        opponentElo: opponentEloVal,
        tc: timeControlBucket,
        clock: [normalizedClockFraction, 0.0],
      }, false);
      const legalUcis = c.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
      const isBlackTurn = c.turn() === 'b';
      const unsorted: PredictedMove[] = legalUcis.map((moveUci) => {
        const canonMove = isBlackTurn ? mirrorMove(moveUci) : moveUci;
        const id = policyMoveToIdRef.current[canonMove];
        return { move: moveUci, probability: id !== undefined ? (policyLogits[id] as number) : -999.0 };
      });
      const maxLogit = Math.max(...unsorted.map(m => m.probability));
      const expSum = unsorted.reduce((acc, m) => acc + Math.exp(m.probability - maxLogit), 0);
      return unsorted
        .map((m) => ({ move: m.move, probability: Math.exp(m.probability - maxLogit) / expSum }))
        .sort((a, b) => b.probability - a.probability);
    } catch (err) {
      console.error("Rating-curve inference error:", err);
      return null;
    }
  };

  // Dedicated background Stockfish instance for one-shot position
  // evaluations (move-quality classification for the rating curve) —
  // kept fully separate from stockfishRef so these queries never clobber
  // the live eval bar / comparison panel's in-flight search.
  const ensureBgStockfishWorker = async (): Promise<Worker | null> => {
    if (bgStockfishRef.current) return bgStockfishRef.current;
    try {
      const cache = await caches.open('otter-model-cache');
      const response = await cache.match('/stockfish.js');
      if (!response) return null;
      const blob = await response.blob();
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      await new Promise<void>((resolve) => {
        worker.onmessage = (e: MessageEvent) => {
          if (e.data === 'readyok') resolve();
        };
        worker.postMessage('uci');
        worker.postMessage('isready');
      });
      bgStockfishRef.current = worker;
      return worker;
    } catch (e) {
      console.error("Failed to init background stockfish worker:", e);
      return null;
    }
  };

  // Raw centipawn score (White's perspective; mate scores offset ±100000,
  // matching the live worker's convention) for a single position, via the
  // dedicated background worker. Resolves undefined on failure/timeout.
  const evaluatePositionOnce = (worker: Worker, fen: string, depth: number): Promise<number | undefined> => {
    return new Promise((resolve) => {
      const isBlackTurn = fen.split(' ')[1] === 'b';
      let lastScore: number | undefined;
      const timeout = setTimeout(() => {
        worker.onmessage = null as any;
        resolve(lastScore);
      }, 8000);
      worker.onmessage = (e: MessageEvent) => {
        const line = e.data;
        if (typeof line !== 'string') return;
        // No MultiPV option is set on this worker (stays at engine default
        // of 1), so every ' pv ' line already is the single best line —
        // no need to additionally filter on a "multipv 1" token some
        // engine builds omit entirely when MultiPV is left at its default.
        if (line.startsWith('info') && line.includes(' pv ')) {
          const parts = line.split(' ');
          if (line.includes('score cp')) {
            const cpIdx = parts.indexOf('cp');
            const cp = parseInt(parts[cpIdx + 1], 10);
            lastScore = isBlackTurn ? -cp : cp;
          } else if (line.includes('score mate')) {
            const mateIdx = parts.indexOf('mate');
            const mate = parseInt(parts[mateIdx + 1], 10);
            const normalizedMate = isBlackTurn ? -mate : mate;
            lastScore = normalizedMate > 0 ? 100000 - normalizedMate : -100000 - normalizedMate;
          }
        }
        if (line.startsWith('bestmove')) {
          clearTimeout(timeout);
          worker.onmessage = null as any;
          resolve(lastScore);
        }
      };
      worker.postMessage('stop');
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });
  };

  const classifyDrop = (drop: number): { label: string; color: string } => {
    if (drop > 200) return { label: 'Blunder', color: '#F43F5E' };
    if (drop > 100) return { label: 'Mistake', color: '#FB923C' };
    if (drop > 50) return { label: 'Inaccuracy', color: '#EAB308' };
    return { label: 'Good', color: '#5C8A2E' };
  };

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
  // made the whole app feel laggy, for a win that only paid off when you
  // happened to play one of the exact prefetched moves.
  const computeRatingCurve = async (c: Chess, history: string[]) => {
    if (!otterWorkerRef.current || !modelLoaded) return;
    const mySeq = ++ratingCurveSeqRef.current;
    // The opponent's bracket (whichever slider isn't the side being swept)
    // changes the sweep's results for the same FEN, so it has to be part
    // of the cache key — otherwise moving the sliders after a position was
    // already swept once would keep showing the stale numbers.
    const fen = `${c.fen()}|${analyzeWhiteElo}|${analyzeBlackElo}`;

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

  // Handle board square click
  const handleSquareClick = (square: string) => {
    if (!game || !isMatchActive || isThinking) return;
    if (game.turn() !== playerColor) return;

    // Check if player is clicking their own piece
    const piece = game.get(square as any);
    const expectedColor = game.turn();

    if (selectedSquare === square) {
      setSelectedSquare(null);
      setPossibleSquares([]);
      return;
    }

    if (piece && piece.color === expectedColor) {
      // Selecting own piece -> highlight moves
      const moves = game.moves({ square: square as any, verbose: true });
      const destinations = moves.map(m => m.to);
      setSelectedSquare(square);
      setPossibleSquares(destinations);
    } else if (selectedSquare) {
      // Trying to play a move
      if (possibleSquares.includes(square)) {
        const currentHistory = [...historyMoves];
        let moveObj: any = null;
        let newGame: Chess | null = null;
        try {
          newGame = cloneGameWithHistory(game);
          moveObj = newGame.move({ from: selectedSquare as any, to: square as any, promotion: 'q' });
        } catch (_) {}
        
        if (moveObj && newGame) {
          const moveUci = moveObj.from + moveObj.to + (moveObj.promotion || '');
          const newHistory = [...currentHistory, moveUci];
          setGame(newGame);
          updateGameState(newGame);
          
          if (modelLoaded) {
            runModelInference(newGame, newHistory);
          }
        }
      } else {
        setSelectedSquare(null);
        setPossibleSquares([]);
      }
    }
  };

  // Make Otter play its top predicted move automatically
  const playModelMove = (moveUci: string) => {
    if (!game || !modelLoaded) return;
    const currentHistory = [...historyMoves];
    let moveObj: any = null;
    let newGame: Chess | null = null;
    try {
      newGame = cloneGameWithHistory(game);
      moveObj = newGame.move({
        from: moveUci.slice(0, 2) as any,
        to: moveUci.slice(2, 4) as any,
        promotion: moveUci.length > 4 ? moveUci.slice(4) : undefined
      });
    } catch (e) {
      console.warn("Invalid model predicted move attempted:", moveUci);
    }
    if (moveObj && newGame) {
      const newHistory = [...currentHistory, moveUci];
      setGame(newGame);
      updateGameState(newGame);
    }
  };

  const resetBoard = () => {
    const cleanChess = new Chess();
    setGame(cleanChess);
    updateGameState(cleanChess);
    setTopMoves([]);
    setWinProbability(0.0);
    setAuxMovingPiece("-");
    setAuxCapturedPiece("-");
    setAuxCheckProb("-");
    setAuxFromTo("-");
    setModelPredMove(null);
    if (cgRef.current) {
      cgRef.current.set({
        lastMove: undefined,
        drawable: {
          shapes: [],
          autoShapes: []
        }
      });
    }
  };

  const getOtterWhiteWinPct = (): number => {
    if (!game) return 50;
    const activeTurn = game.turn();
    const normalized = (winProbability + 1) / 2;
    const whiteWinPct = activeTurn === 'w' ? normalized : (1 - normalized);
    return Math.round(whiteWinPct * 100);
  };
  const otterWinPct = getOtterWhiteWinPct();

  const whitePct = stockfishEvalPct;

  // A saved alternate line, shown indented with a connector under the ply
  // it diverged from, like a lichess-style variation, instead of vanishing
  // once you step off it. Branches are kept in branchesByBase (one per
  // divergence point) and stay visible whether or not they're the one
  // currently being viewed — clicking into a non-active one activates it.
  const renderBranchVariation = (baseIdx: number) => {
    const branch = branchesByBase.get(baseIdx);
    if (!branch || branch.length === 0) return null;
    const isActive = activeBranchBase === baseIdx;
    const branchStartPly = baseIdx + 2; // 1-based ply number of branch[0]
    return (
      <div className="relative pl-2.5 my-0.5 border-l-2 border-rose-500/50">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px] font-mono">
          {branch.map((bm, i) => {
            const plyNumber = branchStartPly + i;
            const moveNumber = Math.ceil(plyNumber / 2);
            const isWhite = plyNumber % 2 === 1;
            const label = isWhite ? `${moveNumber}. ${bm.san}` : `${moveNumber}... ${bm.san}`;
            return (
              <button
                key={i}
                onClick={() => (isActive ? goToBranchMove(i) : activateBranch(baseIdx, i))}
                className={`cursor-pointer truncate transition-colors ${
                  isActive && branchViewIdx === i ? 'text-rose-400 font-bold' : 'text-rose-500/70 hover:text-rose-400'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-grow flex flex-col lg:flex-row min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-line lg:h-[calc(100vh-68px)]">

      {/* COLUMN 1 (LEFT): Move History in Analyze mode (FEN/PGN moved into a
          copy-only dialog, opened via the button below — not important
          enough to stay pinned on screen); Live FEN & PGN Notation
          everywhere else. Collapsible below lg either way. */}
      <div className="w-full lg:w-[280px] shrink-0 flex flex-col bg-panel min-h-0 divide-y divide-line">
        <button
          type="button"
          onClick={() => setMobileNotationOpen((v) => !v)}
          aria-expanded={mobileNotationOpen}
          aria-controls="mobile-notation-panel"
          className="lg:hidden flex items-center justify-between p-4 px-6 bg-panel/30 cursor-pointer"
        >
          <span className="block-label font-mono text-[9.5px] text-pear tracking-[0.12em] uppercase font-bold">
            {isAnalyzeMode ? 'Move History' : 'Live Game Notation'}
          </span>
          <span className={`text-muted transition-transform duration-150 ${mobileNotationOpen ? 'rotate-180' : ''}`}>&#8964;</span>
        </button>
        <div id="mobile-notation-panel" className={`${mobileNotationOpen ? 'flex' : 'hidden'} lg:flex flex-grow flex-col min-h-0 divide-y divide-line`}>
        {isAnalyzeMode ? (
          <>
            <div className="hidden lg:flex p-5 px-6 bg-panel/30 items-center justify-between shrink-0">
              <span className="block-label font-mono text-[9.5px] text-pear tracking-[0.12em] uppercase font-bold">
                Move History
              </span>
              <button
                onClick={() => setShowFenPgnModal(true)}
                className="font-mono text-[10px] uppercase font-bold text-muted hover:text-pear border border-[#7a856f]/35 hover:border-pear px-2 py-1 rounded-[2px] transition-all cursor-pointer"
              >
                FEN / PGN
              </button>
            </div>
            <button
              onClick={() => setShowFenPgnModal(true)}
              className="lg:hidden m-4 font-mono text-[10px] uppercase font-bold text-muted hover:text-pear border border-[#7a856f]/35 hover:border-pear px-2 py-1 rounded-[2px] transition-all cursor-pointer self-start"
            >
              FEN / PGN
            </button>

            {/* Move List */}
            <div className="p-4 px-6 overflow-y-auto flex-grow">
              <div className="block-label font-mono text-[10.5px] text-pear tracking-[0.12em] mb-2 uppercase font-bold">
                Move List ({analysisMoves.length} moves)
              </div>
              {analysisMoves.length > 0 ? (
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[14px] font-mono">
                  {/* A branch played before the very first mainline move
                      (base index -1) renders above row 0. */}
                  {branchesByBase.has(-1) && (
                    <div className="col-span-2">{renderBranchVariation(-1)}</div>
                  )}
                  {Array.from({ length: Math.ceil(analysisMoves.length / 2) }).map((_, movePairIdx) => {
                    const move1Idx = movePairIdx * 2;
                    const move2Idx = movePairIdx * 2 + 1;
                    const m1 = analysisMoves[move1Idx];
                    const m2 = analysisMoves[move2Idx];
                    const move1Active = branchViewIdx === -1 && currentMoveIdx === move1Idx;
                    const move2Active = branchViewIdx === -1 && currentMoveIdx === move2Idx;

                    return (
                      <React.Fragment key={movePairIdx}>
                        <button
                          onClick={() => goToAnalysisMove(move1Idx)}
                          className={`text-left truncate cursor-pointer px-2 py-1 rounded-[3px] border-l-2 transition-all ${
                            move1Active
                              ? 'bg-pear-tint/15 text-pear font-bold border-pear'
                              : 'text-paper/90 border-transparent hover:bg-bg hover:border-line hover:text-pear'
                          }`}
                        >
                          <span className={`text-[11px] mr-1 ${move1Active ? 'text-pear/70' : 'text-muted'}`}>{movePairIdx + 1}.</span>
                          {m1.san}
                        </button>
                        {/* A branch diverging right after white's move sits
                            here — before black's actual reply, pushing it
                            onto its own row below, same as the reference. */}
                        {branchesByBase.has(move1Idx) && (
                          <div className="col-span-2">{renderBranchVariation(move1Idx)}</div>
                        )}
                        {m2 ? (
                          <button
                            onClick={() => goToAnalysisMove(move2Idx)}
                            className={`text-left truncate cursor-pointer px-2 py-1 rounded-[3px] border-l-2 transition-all ${
                              move2Active
                                ? 'bg-pear-tint/15 text-pear font-bold border-pear'
                                : 'text-paper/90 border-transparent hover:bg-bg hover:border-line hover:text-pear'
                            }`}
                          >
                            {m2.san}
                          </button>
                        ) : (
                          <div className="py-1" />
                        )}
                        {branchesByBase.has(move2Idx) && (
                          <div className="col-span-2">{renderBranchVariation(move2Idx)}</div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted italic text-center py-4 border border-dashed border-[#7a856f]/35 rounded-[3px]">
                  Make moves on the board to review.
                </div>
              )}
            </div>

            {/* Navigation Controls */}
            <div className="p-4 px-6 bg-panel/10 flex flex-col gap-2 shrink-0">
              <div className="flex justify-between items-center gap-2">
                <button
                  onClick={jumpToAnalysisStart}
                  disabled={branchViewIdx === -1 && currentMoveIdx === -1}
                  className="flex-1 py-1.5 bg-bg border border-[#7a856f]/35 hover:border-pear hover:text-pear disabled:opacity-30 disabled:hover:border-[#7a856f]/35 disabled:hover:text-paper font-mono text-center font-bold rounded-[3px] transition-all cursor-pointer text-xs"
                  title="Go to Start"
                >
                  &lt;&lt;
                </button>
                <button
                  onClick={() => stepAnalysis(-1)}
                  disabled={branchViewIdx === -1 && currentMoveIdx === -1}
                  className="flex-1 py-1.5 bg-bg border border-[#7a856f]/35 hover:border-pear hover:text-pear disabled:opacity-30 disabled:hover:border-[#7a856f]/35 disabled:hover:text-paper font-mono text-center font-bold rounded-[3px] transition-all cursor-pointer text-xs"
                  title="Previous Move"
                >
                  &lt;
                </button>
                <button
                  onClick={() => stepAnalysis(1)}
                  disabled={branchViewIdx !== -1 ? branchViewIdx === branchMoves.length - 1 : currentMoveIdx === analysisMoves.length - 1}
                  className="flex-1 py-1.5 bg-bg border border-[#7a856f]/35 hover:border-pear hover:text-pear disabled:opacity-30 disabled:hover:border-[#7a856f]/35 disabled:hover:text-paper font-mono text-center font-bold rounded-[3px] transition-all cursor-pointer text-xs"
                  title="Next Move"
                >
                  &gt;
                </button>
                <button
                  onClick={jumpToAnalysisEnd}
                  disabled={branchViewIdx !== -1 ? branchViewIdx === branchMoves.length - 1 : currentMoveIdx === analysisMoves.length - 1}
                  className="flex-1 py-1.5 bg-bg border border-[#7a856f]/35 hover:border-pear hover:text-pear disabled:opacity-30 disabled:hover:border-[#7a856f]/35 disabled:hover:text-paper font-mono text-center font-bold rounded-[3px] transition-all cursor-pointer text-xs"
                  title="Go to End"
                >
                  &gt;&gt;
                </button>
              </div>
              <div className="text-[9px] text-muted text-center font-mono uppercase tracking-wide leading-none">
                Use Arrow keys to step through moves
              </div>
            </div>
          </>
        ) : (
          <>
        <div className="p-5 px-6 space-y-4 bg-panel/30 flex-grow flex flex-col min-h-0">
          <div className="hidden lg:block block-label font-mono text-[9.5px] text-pear tracking-[0.12em] uppercase font-bold">
            <span>Live Game Notation</span>
          </div>
          <div className="space-y-3.5 flex-grow flex flex-col min-h-0">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[11.5px] font-mono text-muted uppercase font-bold">FEN</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(game?.fen() || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
                  }}
                  className="text-[11px] font-mono text-pear hover:underline cursor-pointer uppercase font-bold"
                >
                  Copy
                </button>
              </div>
              <input
                type="text"
                readOnly={isMatchActive || (!isAnalyzeMode && !isEditorMode)}
                value={liveFenInput}
                onChange={handleFenInputChange}
                className="w-full px-2.5 py-1.5 bg-bg border border-[#7a856f]/40 text-[12.5px] font-mono text-paper rounded-[2px] focus:outline-none focus:border-pear/50"
              />
            </div>
            <div className="flex-grow flex flex-col min-h-0">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[11.5px] font-mono text-muted uppercase font-bold">PGN</span>
                <button
                  disabled={isEditorMode && isFreeform}
                  onClick={() => {
                    navigator.clipboard.writeText(game?.pgn() || "");
                  }}
                  className={`text-[11px] font-mono text-pear hover:underline cursor-pointer uppercase font-bold ${(isEditorMode && isFreeform) ? 'opacity-40 pointer-events-none' : ''}`}
                >
                  Copy
                </button>
              </div>
              <textarea
                readOnly={isMatchActive || (!isAnalyzeMode && !isEditorMode) || (isEditorMode && isFreeform)}
                value={isEditorMode && isFreeform ? "" : livePgnInput}
                onChange={handlePgnInputChange}
                placeholder={isEditorMode && isFreeform ? "PGN is disabled in Freeform Mode." : "No moves recorded yet."}
                className={`w-full flex-grow px-2.5 py-1.5 bg-bg border border-[#7a856f]/40 text-[12.5px] font-mono text-paper rounded-[2px] focus:outline-none focus:border-pear/50 resize-none min-h-[220px] ${(isEditorMode && isFreeform) ? 'opacity-40 pointer-events-none select-none' : ''}`}
              />
            </div>
          </div>
        </div>

        {/* ELO Rating Badge */}
        <div className="p-6 px-8 border-t border-line bg-panel/30 space-y-2 shrink-0">
          <div className="text-muted text-[10px] uppercase font-bold font-mono">Your Rating</div>
          <div className="text-2xl font-space font-medium text-pear font-bold tracking-tight">{playerRating} ELO</div>
        </div>
          </>
        )}
        </div>
      </div>

      {/* COLUMN 2 (MIDDLE): Chessboard Column */}
      <div className="flex-grow flex flex-col items-center justify-center bg-bg relative min-h-0 p-4 md:p-6 space-y-3.5">
        
        {/* Flip Board Button (top-right, 10px from sidebar) */}
        <button
          onClick={() => setIsFlipped(!isFlipped)}
          className="absolute top-2 right-2.5 font-mono text-[10px] uppercase tracking-wider text-muted border border-line px-2 py-1 hover:text-pear hover:border-pear transition-all cursor-pointer flex items-center gap-1.5 z-10"
          title="Flip board"
        >
          <span>⟳</span>
          <span>Flip</span>
        </button>

        {/* Profile cards: one anchored above the board, one below — matching
            whichever color sits on that side of the CURRENT orientation, so
            "your" card stays on the near side (bottom) and swaps with the
            opponent's card when the board is flipped, instead of both cards
            merely reordering while staying stacked above the board. */}
        {(() => {
          type Card = { key: string; label: string; rating: string | number | null; dotBlack: boolean; isOtter: boolean; time: number; turnActive: boolean };
          let topCard: Card;
          let bottomCard: Card;

          if (isAnalyzeMode) {
            // Arbitrary loaded game — use the PGN's own player names/ratings
            // when available, and default to the standard White-at-bottom
            // orientation (Flip still swaps it) since there's no reliable way
            // to know which side is "you" from the PGN alone.
            const whiteCard: Card = { key: 'white', label: analysisWhiteName || 'White', rating: analysisWhiteElo, dotBlack: false, isOtter: false, time: 0, turnActive: game?.turn() === 'w' };
            const blackCard: Card = { key: 'black', label: analysisBlackName || 'Black', rating: analysisBlackElo, dotBlack: true, isOtter: false, time: 0, turnActive: game?.turn() === 'b' };
            topCard = isFlipped ? whiteCard : blackCard;
            bottomCard = isFlipped ? blackCard : whiteCard;
          } else {
            const otterColor: 'w' | 'b' = playerColor === 'w' ? 'b' : 'w';
            const otterCard: Card = { key: 'otter', label: 'Otter AI', rating: playerElo, dotBlack: otterColor === 'b', isOtter: true, time: otterTime, turnActive: game?.turn() !== playerColor };
            const guestCard: Card = { key: 'guest', label: 'Guest', rating: playerRating, dotBlack: playerColor === 'b', isOtter: false, time: playerTime, turnActive: game?.turn() === playerColor };
            // White-orientation (not flipped) shows rank 8 on top, so the
            // black-side card belongs on top; flipped orientation reverses that.
            const topColor: 'w' | 'b' = isFlipped ? 'w' : 'b';
            topCard = otterColor === topColor ? otterCard : guestCard;
            bottomCard = otterColor === topColor ? guestCard : otterCard;
          }

          // The board's own max-size PERMANENTLY reserves room for the eval
          // bars — one flanking each side (24px bar + 16px gap-4 = 40px per
          // side, 80px total) — regardless of whether Analyze mode is
          // currently on. That's what makes the board's size and position
          // fixed: if the reservation only applied while bars were visible,
          // the board would resize/shift every time you entered or left
          // Analyze mode, which is exactly what "never move" rules out.
          const boardSizeClasses = "w-[min(calc(92vw-80px),82vh,720px)] lg:w-[min(calc(100vw-760px),82vh,720px)]";
          // Same size expression, but as a height class — the eval bar
          // containers match the (square) board's size on the cross axis.
          const evalBarHeightClasses = "h-[min(calc(92vw-80px),82vh,720px)] lg:h-[min(calc(100vw-760px),82vh,720px)]";

          const renderCard = (card: Card) => (
            <div key={card.key} className={`${boardSizeClasses} flex justify-between items-center px-4 py-2 border border-[#7a856f]/30 bg-panel/30 rounded-[3px]`}>
              <div className="flex items-center gap-2.5">
                <span className={`w-3 h-3 rounded-full border border-[#7a856f]/40 ${card.dotBlack ? 'bg-[#1a1b15]' : 'bg-[#FFFFFF]'}`} />
                <div className="font-mono text-xs text-paper font-semibold">
                  {card.label} {card.rating != null && <span className={card.isOtter ? 'text-pear' : 'text-muted'}>({card.rating})</span>}
                </div>
              </div>
              {isMatchActive && (
                <div className={`font-mono text-[13px] font-bold px-2 py-0.5 border rounded-[2px] ${
                  card.turnActive
                    ? 'border-pear/85 bg-pear-tint/10 text-pear shadow-[0_0_10px_rgba(92,138,46,0.12)]'
                    : 'border-line bg-bg/50 text-paper/85'
                }`}>
                  {(() => {
                    const m = Math.floor(card.time / 60);
                    const s = card.time % 60;
                    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                  })()}
                </div>
              )}
            </div>
          );

          // Otter always flanks the left of the board, Stockfish the right —
          // fixed sides, not swapped on flip. Each bar is a solid two-tone
          // split — no gradient blend — where the COLOURED region's size
          // always equals bar.pct (matching the number in the pill; it
          // used to be sized to 100-pct, which visually read backwards —
          // e.g. a 47% pill sitting over a 53%-tall green region). The
          // coloured region anchors to whichever physical edge White
          // currently sits at (bottom normally, top when flipped), same
          // as the original fill-bar behavior before this restyle. Outer
          // footprint (w-6 / boardPx height) is unchanged so the board's
          // size formula, tuned around that exact reserved width, still
          // holds — only the pill is allowed to spill past it visually
          // via overflow-visible.
          const renderEvalBar = (bar: { key: string; pct: number; color: string; text: string; title: string }) => {
            const colorAtTop = isFlipped;
            const topHeight = colorAtTop ? bar.pct : 100 - bar.pct;
            const topColor = colorAtTop ? bar.color : '#000000';
            const bottomColor = colorAtTop ? '#000000' : bar.color;
            const pillTop = topHeight;
            return (
              <div
                key={bar.key}
                className={`w-6 shrink-0 ${evalBarHeightClasses} relative overflow-visible`}
                style={boardPx !== null ? { height: boardPx } : undefined}
                title={isAnalyzeMode ? bar.title : undefined}
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
                      {bar.text}
                    </div>
                  </>
                )}
              </div>
            );
          };

          return (
            <>
              {renderCard(topCard)}

              {/* Board and Dual Eval Bars Wrapper. The bar SLOTS are always
                  rendered — just empty outside Analyze mode — so the row's
                  total width (and therefore the board's centered position)
                  never changes when Analyze mode toggles their content. */}
              <div className="flex items-center gap-4 relative">
                {renderEvalBar({ key: 'otter', pct: otterWinPct, color: '#7CB342', text: `${otterWinPct.toFixed(1)}%`, title: `Otter Win Prob: ${otterWinPct}%` })}

                {/* Chessboard Sizing Wrapper — CSS-driven responsive size, observed but
                    never overridden by JS, so it keeps tracking the viewport. */}
                <div
                  ref={boardWrapperRef}
                  className={`${boardSizeClasses} shrink-0 aspect-square flex items-center justify-center`}
                >
                  {/* Chessboard View Container — pinned to a multiple of 8px so
                      chessground's own crisp-square snapping is a no-op (see 1b above). */}
                  <div
                    onMouseDown={handleBoardMouseDown}
                    onMouseUp={handleBoardMouseUp}
                    style={boardPx !== null ? { width: boardPx, height: boardPx } : { width: '100%', height: '100%' }}
                    className="relative outline outline-1 outline-line bg-sq-dark overflow-hidden"
                  >
                    <div ref={containerRef} className="w-full h-full" />
                  </div>
                </div>

                {renderEvalBar({ key: 'sf', pct: whitePct, color: '#F0605F', text: formatSfPoints(sfTopMoves[0]?.evalCp), title: `Stockfish eval: ${formatSfPoints(sfTopMoves[0]?.evalCp)}` })}
              </div>

              {renderCard(bottomCard)}
            </>
          );
        })()}

      </div>

      {/* COLUMN 3 (RIGHT): Controls & Move History */}
      <div className="w-full lg:w-[400px] shrink-0 flex flex-col bg-panel min-h-0 divide-y divide-line lg:overflow-y-auto">
        
        {/* Move History / Lobby Middle Area */}
        {isAnalyzeMode ? (
          /* ================= Analysis Mode Sidebar ================= */
          <div className="flex-grow flex flex-col min-h-0">
            {/* Header info */}
            <div className="p-3 px-6 lg:pt-4 bg-panel/30 space-y-2.5 lg:space-y-3">
              <div className="flex justify-between items-center pb-2.5 border-b border-line">
                <div>
                  <span className="font-mono text-[10.5px] text-pear uppercase font-bold tracking-wider">Analysis Mode</span>
                  <h3 className="font-space font-medium text-[15px] text-paper mt-0.5">
                    Game Review
                  </h3>
                </div>
                <button
                  onClick={exitAnalyzeMode}
                  className="font-mono text-[10px] text-rose-500 uppercase font-bold hover:underline cursor-pointer border border-red-500/20 px-2 py-0.5 rounded hover:bg-rose-500/5 transition-all"
                >
                  Exit
                </button>
              </div>

              {/* Rating bracket sliders — control which Elo bucket Otter's
                  predictions (both the Otter · Human panel and the "Moves
                  by Rating" sweep's opponent side) are conditioned on for
                  each side, independent of the Challenge Otter match
                  settings. Defaults to the loaded PGN's WhiteElo/BlackElo
                  headers, or the just-played match's ratings when there's
                  no PGN — see applyDefaultAnalyzeElos. */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-muted uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full border border-line bg-paper shrink-0" />
                    White Bracket
                  </label>
                  <span className="font-space text-[12px] font-medium text-pear">{analyzeWhiteElo}</span>
                </div>
                <input
                  type="range"
                  min="800"
                  max="2600"
                  step="100"
                  value={analyzeWhiteElo}
                  onChange={(e) => setAnalyzeWhiteElo(parseInt(e.target.value))}
                  className="w-full accent-pear h-[4px] bg-[#7a856f]/40 rounded-full appearance-none cursor-pointer block"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-muted uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-[#2a2a2a] shrink-0" />
                    Black Bracket
                  </label>
                  <span className="font-space text-[12px] font-medium text-pear">{analyzeBlackElo}</span>
                </div>
                <input
                  type="range"
                  min="800"
                  max="2600"
                  step="100"
                  value={analyzeBlackElo}
                  onChange={(e) => setAnalyzeBlackElo(parseInt(e.target.value))}
                  className="w-full accent-pear h-[4px] bg-[#7a856f]/40 rounded-full appearance-none cursor-pointer block"
                />
              </div>
            </div>

            {/* Analysis Stats (Accuracy & Engine evaluations) */}
            <div className="p-3 px-6 lg:pt-4 bg-panel/10 flex-grow flex flex-col space-y-2.5 lg:space-y-4 min-h-0">
              {/* Analysis — Otter's top predicted moves side by side with
                  Stockfish's own top candidate lines (UCI MultiPV). Kept
                  first in this column so it's the first thing visible in
                  the sidebar below the mode header. */}
              <div className="lg:pt-[10px]">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11.5px] font-mono font-bold text-pear uppercase tracking-wide mb-1.5 truncate" title="Otter — human-like predicted moves">
                      Otter · Human
                    </div>
                    <div className="flex justify-between text-[10.5px] text-muted uppercase font-bold font-mono pb-1 mb-1 border-b border-line/50">
                      <span>Move</span><span>Prob</span>
                    </div>
                    <div className="space-y-1 min-h-[92px]">
                      {topMoves.slice(0, 4).map((pm) => (
                        <div key={pm.move} className="flex justify-between items-center h-5 text-[14px] font-mono">
                          <span className="text-paper font-semibold">{formatUciAsSan(pm.move, game?.fen())}</span>
                          <span className="text-pear font-bold">{(pm.probability * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                      {topMoves.length === 0 && (
                        <div className="flex items-center h-5 text-[12.5px] text-muted italic">Running...</div>
                      )}
                    </div>
                  </div>
                  <div className="border-l border-line pl-3">
                    <div className="flex items-center gap-1 mb-1.5 relative group">
                      <div className="text-[11.5px] font-mono font-bold text-[#F0605F] uppercase tracking-wide truncate" title="Stockfish — engine's top candidate lines, searched to depth 13">
                        Stockfish · d13
                      </div>
                      <span className="w-[13px] h-[13px] rounded-full border border-muted/60 text-muted group-hover:border-[#F0605F] group-hover:text-[#F0605F] flex items-center justify-center text-[9px] font-bold leading-none transition-colors shrink-0">
                        i
                      </span>
                      <div className="absolute top-full mt-2 right-0 z-20 w-[220px] px-2.5 py-2 border border-line/60 bg-panel shadow-lg rounded-[3px] text-left normal-case whitespace-normal opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150">
                        <p className="text-[11.5px] text-paper leading-[1.5]">
                          Stockfish runs at full throttle here, no rating cap, so every eval and move-quality call stays objective. At depth 13 it plays like a ~3000+ Elo engine — well past super-grandmaster strength.
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-between text-[10.5px] text-muted uppercase font-bold font-mono pb-1 mb-1 border-b border-line/50">
                      <span>Move</span><span>Eval</span>
                    </div>
                    <div className="space-y-1 min-h-[92px]">
                      {sfTopMoves.slice(0, 4).map((m, idx) => (
                        <div key={idx} className="flex justify-between items-center h-5 text-[14px] font-mono">
                          <span className="text-paper font-semibold">{m.san}</span>
                          <span className={`font-bold ${m.evalCp >= 0 ? 'text-pear' : 'text-rose-500'}`}>
                            {m.evalCp > 0 ? '+' : ''}{(m.evalCp / 100).toFixed(2)}
                          </span>
                        </div>
                      ))}
                      {sfTopMoves.length === 0 && (
                        <div className="flex items-center h-5 text-[12.5px] text-muted italic">Running...</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Arrow colour legend — matches the custom chessground
                  brushes registered on the board (see the Chessground
                  init above): green for Otter, light red for Stockfish,
                  yellow for the player's actual move. */}
              <div className="flex items-center justify-center gap-3 whitespace-nowrap text-[11.5px] font-mono text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#5C8A2E' }} />
                  Otter
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#F0605F' }} />
                  Stockfish
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#EAB308' }} />
                  Player
                </span>
              </div>

              {/* Moves by Rating — Otter's candidate moves re-run across
                  every rating bucket for the current position, each
                  line coloured by a Stockfish-judged quality label
                  (see computeRatingCurve). */}
              {isAnalyzeMode && (() => {
                // Fixed axis, matching what sweepRatingCurve computes
                // against — always the full range, regardless of how many
                // buckets have actually resolved yet. Series' own `points`
                // arrays are shorter while a sweep is still live-streaming
                // in (see sweepRatingCurve), so their lines simply stop
                // partway across this fixed axis and grow rightward as
                // more buckets land, instead of the whole axis rescaling
                // under them as data streams in.
                const eloLabels = [800, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2200, 2400, 2600];
                // Fixed 0/25/50/75/100 scale (not rescaled to the data) so
                // the shape of each curve stays visually comparable across
                // different positions instead of the axis jumping around.
                const maxY = 100;
                const chartW = 380, chartH = 195, padL = 44, padB = 20, padT = 8, padR = 40;
                const plotW = chartW - padL - padR;
                const plotH = chartH - padT - padB;
                const baseline = chartH - padB;
                const xForIdx = (i: number) => padL + (eloLabels.length > 1 ? (i / (eloLabels.length - 1)) * plotW : plotW / 2);
                const yForProb = (p: number) => padT + (1 - p / maxY) * plotH;
                const gridSteps = [0, 25, 50, 75, 100];
                const hoverIdx = ratingCurveHoverIdx !== null ? Math.max(0, Math.min(eloLabels.length - 1, ratingCurveHoverIdx)) : null;

                // Smooth curve through the points instead of straight
                // joints — quadratic Beziers using each point as the
                // control and the midpoint between consecutive points as
                // the on-curve waypoint. Simple, no extra deps, and keeps
                // the line passing close to the actual data.
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
                  <div className="pt-4 lg:pt-[26px] flex-grow flex flex-col min-h-0 lg:max-h-[320px]">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2 shrink-0">
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
                    {/* The chart shell (axes, gridlines) always renders,
                        even with zero data — the graph must never
                        disappear, whether that's on first load before any
                        sweep has finished, or between positions. */}
                    {(
                      <div className="relative flex-grow min-h-[90px]">
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
                              probability) so the leading move's large area sits at
                              the back and thinner trailing bands layer on top. */}
                          {[...ratingCurveData].reverse().map((s, ri) => {
                            const si = ratingCurveData.length - 1 - ri;
                            const pts = s.points.map((p, i) => ({ x: xForIdx(i), y: yForProb(p.probability) }));
                            return <path key={si} d={smoothArea(pts, baseline)} fill={`url(#rcgrad-${si})`} stroke="none" className="transition-[d] duration-250 ease-in-out" />;
                          })}
                          {/* One smooth curve + dots per candidate move, coloured by quality —
                              keyed by rank (not move identity) so when a new sweep swaps in a
                              different move at the same rank, the SAME dot/line/label elements
                              are reused and just glide + relabel instead of vanishing and
                              reappearing. */}
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
                          {/* Crosshair + highlighted dots for whichever rating column
                              the cursor is over. */}
                          {hoverIdx !== null && ratingCurveData.length > 0 && (
                            <g pointerEvents="none">
                              <line x1={xForIdx(hoverIdx)} x2={xForIdx(hoverIdx)} y1={padT} y2={baseline} stroke="var(--paper)" strokeWidth={1} strokeDasharray="3,2" opacity={0.5} />
                              {ratingCurveData.map((s, si) => (
                                // A series mid-live-sweep may not have a point at this
                                // column yet — skip its dot rather than reading past
                                // the end of its (still growing) points array.
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
                          {/* Invisible full-plot overlay that drives the crosshair —
                              on top of everything so it always receives the pointer. */}
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
              })()}

              {/* AI Intuition Dashboard — pinned to the bottom of the column so
                  the Otter/Stockfish comparison stays the first thing seen. */}
              <div className="pt-2.5 lg:pt-3">
                <div className="flex items-center gap-1 mb-1.5 relative group">
                  <div className="block-label font-mono text-[12px] text-pear tracking-[0.12em] uppercase font-bold">
                    Otter AI Intuition
                  </div>
                  <span className="w-[13px] h-[13px] rounded-full border border-muted/60 text-muted group-hover:border-pear group-hover:text-pear flex items-center justify-center text-[9px] font-bold leading-none transition-colors shrink-0">
                    i
                  </span>
                  <div className="absolute top-full mt-2 left-0 z-20 w-[240px] px-2.5 py-2 border border-line/60 bg-panel shadow-lg rounded-[3px] text-left normal-case whitespace-normal opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150">
                    <p className="text-[11.5px] text-paper leading-[1.5]">
                      Otter's auxiliary prediction head — a second set of outputs the model computes alongside its main move choice: which piece is moving, what it captures, check probability, and (in the meter below) its own independent guess at the from/to squares, which can occasionally disagree with Otter's top move.
                    </p>
                  </div>
                </div>

                {/* Otter's Intuition Squares — the aux head's own from/to
                    square prediction (aux_logits[13:141], 128 dims computed
                    on every inference but never decoded before now).
                    Trained independently from the policy head, so it's a
                    genuine second opinion from the model itself, not a
                    restatement of topMoves[0] — flagged when the two
                    disagree. */}
                {auxIntuitionFrom && auxIntuitionTo && (() => {
                  const topMove = topMoves[0]?.move;
                  const agrees = !!topMove && topMove.slice(0, 2) === auxIntuitionFrom && topMove.slice(2, 4) === auxIntuitionTo;
                  return (
                    <div className="p-2.5 border border-line bg-bg rounded-[3px] flex items-center justify-between gap-2 flex-wrap mb-1.5">
                      <div className="flex items-baseline gap-1.5 text-[13px] font-mono">
                        <span className="font-bold text-paper">{auxIntuitionFrom}</span>
                        <span className="text-muted text-[10px]">{(auxIntuitionFromConf * 100).toFixed(0)}%</span>
                        <span className="text-muted">→</span>
                        <span className="font-bold text-paper">{auxIntuitionTo}</span>
                        <span className="text-muted text-[10px]">{(auxIntuitionToConf * 100).toFixed(0)}%</span>
                      </div>
                      <span className={`text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                        agrees ? 'text-pear border-pear/30 bg-pear-tint/10' : 'text-orange-400 border-orange-400/30 bg-orange-400/10'
                      }`}>
                        {agrees ? 'Matches top move' : 'Independent guess'}
                      </span>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-1.5 text-[12.5px] font-mono">
                  <div className="p-1.5 border border-line bg-bg rounded-[3px]">
                    <div className="text-muted text-[10px] uppercase font-bold mb-0.5">Subjective Eval</div>
                    <div className={`text-[13px] font-bold ${winProbability > 0.15 ? 'text-pear' : winProbability < -0.15 ? 'text-rose-500' : 'text-paper'}`}>
                      {winProbability > 0 ? '+' : ''}{winProbability.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-1.5 border border-line bg-bg rounded-[3px]">
                    <div className="text-muted text-[10px] uppercase font-bold mb-0.5">Check Prob</div>
                    <div className="text-[13px] font-bold text-paper">
                      {auxCheckProb}
                    </div>
                  </div>
                  <div className="p-1.5 border border-line bg-bg rounded-[3px]">
                    <div className="text-muted text-[10px] uppercase font-bold mb-0.5">Moving Piece</div>
                    <div className="text-[12.5px] font-bold text-paper truncate" title={auxMovingPiece}>
                      {auxMovingPiece}
                    </div>
                  </div>
                  <div className="p-1.5 border border-line bg-bg rounded-[3px]">
                    <div className="text-muted text-[10px] uppercase font-bold mb-0.5">Target Capture</div>
                    <div className="text-[12.5px] font-bold text-paper truncate" title={auxCapturedPiece}>
                      {auxCapturedPiece}
                    </div>
                  </div>
                  <div className="col-span-2 p-1.5 border border-line bg-bg rounded-[3px] flex justify-between items-center text-[11.5px]">
                    <div className="text-muted uppercase font-bold">Est. Human Think Time</div>
                    <div className="font-bold text-pear">
                      {getExpectedHumanTime(topMoves, timeControl, 600)}s
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : isEditorMode ? (
          /* ================= Board Editor Mode Sidebar ================= */
          <div className="flex-grow flex flex-col min-h-0 divide-y divide-line">
            {/* Header info */}
            <div className="p-4 px-6 bg-panel/30 flex justify-between items-center">
              <div>
                <span className="font-mono text-[10.5px] text-pear uppercase font-bold tracking-wider">Board Editor</span>
                <h3 className="font-space font-medium text-[15px] text-paper mt-0.5">
                  Setup Position
                </h3>
              </div>
              <button
                onClick={exitEditorMode}
                className="font-mono text-[10px] text-rose-500 uppercase font-bold hover:underline cursor-pointer border border-rose-500/20 px-2 py-0.5 rounded hover:bg-rose-500/5 transition-all"
              >
                Cancel
              </button>
            </div>

            {/* Editor Configuration Panel */}
            <div className="p-5 px-6 space-y-4 overflow-y-auto flex-grow">
              {/* Freeform / Record PGN Toggle */}
              <div>
                <div className="block-label font-mono text-[9px] text-pear tracking-[0.1em] mb-2 uppercase font-bold">
                  Editing Mode
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setIsFreeform(true);
                      setEditorMoveSource(null);
                      const fen = currentFenRef.current || (game ? game.fen() : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
                      try {
                        const c = new Chess(fen);
                        setGame(c);
                      } catch (_) {}
                      setAnalysisMoves([]);
                      setCurrentMoveIdx(-1);
                      setBranchesByBase(new Map());
                      setActiveBranchBase(null);
                      setBranchViewIdx(-1);
                    }}
                    className={`flex-1 py-2 border rounded text-[11px] font-mono cursor-pointer transition-all ${
                      isFreeform ? 'border-pear bg-pear-tint/10 text-pear font-bold' : 'border-line/45 text-paper hover:border-pear'
                    }`}
                  >
                    Freeform (FEN)
                  </button>
                  <button
                    onClick={() => {
                      setIsFreeform(false);
                      setEditorMoveSource(null);
                      const fen = currentFenRef.current || (game ? game.fen() : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
                      try {
                        const c = new Chess(fen);
                        setGame(c);
                        updateGameState(c);
                      } catch (_) {}
                    }}
                    className={`flex-1 py-2 border rounded text-[11px] font-mono cursor-pointer transition-all ${
                      !isFreeform ? 'border-pear bg-pear-tint/10 text-pear font-bold' : 'border-line/45 text-paper hover:border-pear'
                    }`}
                  >
                    Record PGN
                  </button>
                </div>
              </div>

              {isFreeform ? (
                <div>
                  <div className="block-label font-mono text-[9px] text-pear tracking-[0.1em] mb-2 uppercase font-bold">
                    Select Piece to Place
                  </div>
                  <div className="grid grid-cols-6 gap-1.5 mb-2">
                    {['wK', 'wQ', 'wR', 'wB', 'wN', 'wP'].map((p) => {
                      const symbols: Record<string, string> = {
                        wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙'
                      };
                      return (
                        <button 
                          key={p}
                          onClick={() => setEditorSelectedPiece(p as any)}
                          className={`h-9 border rounded flex items-center justify-center text-xl cursor-pointer transition-all ${
                            editorSelectedPiece === p ? 'border-pear bg-pear-tint/15 text-pear font-bold' : 'border-line/45 text-paper hover:border-pear'
                          }`}
                          title={`White ${p[1]}`}
                        >
                          {symbols[p]}
                        </button>
                      );
                    })}
                    {['bK', 'bQ', 'bR', 'bB', 'bN', 'bP'].map((p) => {
                      const symbols: Record<string, string> = {
                        bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
                      };
                      return (
                        <button 
                          key={p}
                          onClick={() => setEditorSelectedPiece(p as any)}
                          className={`h-9 border rounded flex items-center justify-center text-xl cursor-pointer transition-all ${
                            editorSelectedPiece === p ? 'border-pear bg-pear-tint/15 text-pear font-bold' : 'border-line/45 text-paper hover:border-pear'
                          }`}
                          title={`Black ${p[1]}`}
                        >
                          {symbols[p]}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setEditorSelectedPiece('move')}
                    className={`w-full py-2 border rounded flex items-center justify-center gap-2 text-[10.5px] font-mono cursor-pointer transition-all ${
                      editorSelectedPiece === 'move' ? 'border-amber-500 bg-amber-500/10 text-amber-500 font-bold' : 'border-line/45 text-paper hover:border-amber-500/60'
                    }`}
                  >
                    <span>↔</span>
                    <span>Move Tool (Click to move piece)</span>
                  </button>
                  <button
                    onClick={() => setEditorSelectedPiece('erase')}
                    className={`w-full py-2 border rounded flex items-center justify-center gap-2 text-[10.5px] font-mono cursor-pointer transition-all ${
                      editorSelectedPiece === 'erase' ? 'border-rose-500 bg-rose-500/10 text-rose-500 font-bold' : 'border-line/45 text-paper hover:border-rose-500/60'
                    }`}
                  >
                    <span>🗑️</span>
                    <span>Eraser Tool (Delete Piece)</span>
                  </button>
                  {editorSelectedPiece === 'move' && (
                    <div className="text-[10px] text-amber-500 font-mono text-center pt-1">
                      {editorMoveSource ? `Selected: ${editorMoveSource} — click destination` : 'Click a piece to select, then click destination'}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 border border-[#7a856f]/35 bg-bg/50 rounded-[3px] space-y-2">
                  <div className="text-[11.5px] text-paper font-bold uppercase font-mono">Sequential Move Recording</div>
                  <p className="text-[10px] text-muted leading-relaxed">
                    Make normal chess moves on the board following the standard white/black sequence. Your moves are recorded chronologically for PGN building.
                  </p>
                  {analysisMoves.length > 0 && (
                    <div className="block-label font-mono text-[8px] text-pear tracking-[0.1em] pt-1 uppercase font-bold shrink-0">
                      Moves Played ({analysisMoves.length})
                    </div>
                  )}
                  <div className="max-h-[140px] overflow-y-auto pr-1 text-[11px] font-mono text-paper space-y-1">
                    {analysisMoves.reduce<React.ReactElement[]>((acc, m, idx) => {
                      if (idx % 2 === 0) {
                        const next = analysisMoves[idx + 1];
                        acc.push(
                          <div key={idx} className="flex gap-2 py-0.5 border-b border-line/10">
                            <span className="text-muted w-6">{Math.floor(idx / 2) + 1}.</span>
                            <span className="w-16">{m.san}</span>
                            {next && <span>{next.san}</span>}
                          </div>
                        );
                      }
                      return acc;
                    }, [])}
                  </div>
                </div>
              )}

              {/* Turn Selector */}
              <div>
                <div className="block-label font-mono text-[9px] text-pear tracking-[0.1em] mb-2 uppercase font-bold">
                  Turn to Move
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditorTurn('w');
                      updateEditorFen('w', editorCastling);
                    }}
                    className={`flex-1 py-2 border rounded text-xs font-mono cursor-pointer transition-all ${
                      editorTurn === 'w' ? 'border-pear bg-pear-tint/10 text-pear font-bold' : 'border-line/45 text-paper hover:border-pear'
                    }`}
                  >
                    White to play
                  </button>
                  <button
                    onClick={() => {
                      setEditorTurn('b');
                      updateEditorFen('b', editorCastling);
                    }}
                    className={`flex-1 py-2 border rounded text-xs font-mono cursor-pointer transition-all ${
                      editorTurn === 'b' ? 'border-pear bg-pear-tint/10 text-pear font-bold' : 'border-line/45 text-paper hover:border-pear'
                    }`}
                  >
                    Black to play
                  </button>
                </div>
              </div>

              {/* Castling rights */}
              <div>
                <div className="block-label font-mono text-[9px] text-pear tracking-[0.1em] mb-2 uppercase font-bold">
                  Castling Rights
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10.5px] font-mono text-paper">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorCastling.wK}
                      onChange={(e) => {
                        const next = { ...editorCastling, wK: e.target.checked };
                        setEditorCastling(next);
                        updateEditorFen(editorTurn, next);
                      }}
                      className="accent-pear"
                    />
                    <span>White O-O</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorCastling.wQ}
                      onChange={(e) => {
                        const next = { ...editorCastling, wQ: e.target.checked };
                        setEditorCastling(next);
                        updateEditorFen(editorTurn, next);
                      }}
                      className="accent-pear"
                    />
                    <span>White O-O-O</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorCastling.bK}
                      onChange={(e) => {
                        const next = { ...editorCastling, bK: e.target.checked };
                        setEditorCastling(next);
                        updateEditorFen(editorTurn, next);
                      }}
                      className="accent-pear"
                    />
                    <span>Black O-O</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorCastling.bQ}
                      onChange={(e) => {
                        const next = { ...editorCastling, bQ: e.target.checked };
                        setEditorCastling(next);
                        updateEditorFen(editorTurn, next);
                      }}
                      className="accent-pear"
                    />
                    <span>Black O-O-O</span>
                  </label>
                </div>
              </div>

              {/* Global Editor Actions */}
              <div className="space-y-2 pt-2 border-t border-line">
                <button
                  onClick={() => {
                    const cleanChess = new Chess();
                    setGame(cleanChess);
                    currentFenRef.current = cleanChess.fen();
                    setLiveFenInput(cleanChess.fen());
                    updateGameState(cleanChess);
                    setEditorTurn('w');
                    setEditorCastling({ wK: true, wQ: true, bK: true, bQ: true });
                  }}
                  className="w-full py-2 border border-[#7a856f]/35 rounded text-xs font-mono text-paper bg-bg hover:border-pear transition-all cursor-pointer"
                >
                  Reset Starting Board
                </button>
                <button
                  onClick={() => {
                    try {
                      const cleanChess = new Chess("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
                      setGame(cleanChess);
                      currentFenRef.current = cleanChess.fen();
                      setLiveFenInput(cleanChess.fen());
                      updateGameState(cleanChess);
                      setEditorTurn('w');
                      setEditorCastling({ wK: false, wQ: false, bK: false, bQ: false });
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  className="w-full py-2 border border-[#7a856f]/35 rounded text-xs font-mono text-paper bg-bg hover:border-pear transition-all cursor-pointer"
                >
                  Clear Board
                </button>
                {editorPositionError && (
                  <div className="text-[10.5px] text-rose-500 font-mono bg-rose-500/10 border border-rose-500/30 rounded px-2.5 py-2 leading-relaxed">
                    Invalid position: {editorPositionError}
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => {
                      if (validateAndApplyEditorPosition()) {
                        setIsAnalyzeMode(true);
                        setIsEditorMode(false);
                      }
                    }}
                    className="flex-1 py-2.5 bg-pear border border-pear rounded text-[11px] font-space font-semibold uppercase text-bg hover:bg-[#4d7524] transition-all cursor-pointer text-center"
                  >
                    Analyze
                  </button>
                  <button
                    onClick={() => {
                      if (validateAndApplyEditorPosition()) {
                        setIsEditorMode(false);
                        setIsConfigModalOpen(true);
                      }
                    }}
                    className="flex-1 py-2.5 bg-bg border border-[#7a856f]/55 rounded text-[11px] font-space font-semibold uppercase text-paper hover:border-pear hover:text-pear transition-all cursor-pointer text-center"
                  >
                    Play Otter
                  </button>
                </div>
                <button
                  onClick={() => {
                    const cleanChess = new Chess();
                    setGame(cleanChess);
                    setLiveFenInput(cleanChess.fen());
                    updateGameState(cleanChess);
                    setIsEditorMode(false);
                  }}
                  className="w-full py-2 border border-red-500/30 hover:border-red-500 rounded text-xs font-mono text-red-400 bg-bg hover:text-red-300 transition-all cursor-pointer text-center mt-2"
                >
                  Cancel & Discard Setup
                </button>
              </div>
            </div>
          </div>
        ) : !isMatchActive ? (
          /* ================= Lobby Mode ================= */
          <div className="flex-grow flex flex-col min-h-0 divide-y divide-line">
            <div className="p-6 px-8 space-y-4">
              <div className="flex items-center gap-2 font-mono text-[9px] text-pear tracking-[0.08em] uppercase">
                <span className="border border-pear px-1.5 py-0.5 font-bold">LOBBY</span>
                <span>Otter Chess Arena</span>
              </div>
              <h2 className="font-space font-medium text-[18px] text-paper">Otter Arena</h2>
              <p className="text-[11.5px] text-muted leading-relaxed">
                Configure your match variables, setup custom positions using the editor, or import notation files.
              </p>
            </div>

            {/* Lobby Play Game, Analyze, & Board Editor buttons */}
            <div className="p-6 px-8 space-y-2.5">
              <button
                onClick={() => setIsConfigModalOpen(true)}
                disabled={!enginesReady}
                className="w-full py-3 font-space text-[12px] tracking-wider uppercase font-semibold text-bg bg-pear border border-pear hover:bg-[#4d7524] hover:border-[#4d7524] transition-all flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>Challenge Otter AI</span>
              </button>

              <button
                onClick={handleAnalyzeClick}
                disabled={!enginesReady}
                className="w-full py-3 font-space text-[12px] tracking-wider uppercase font-semibold text-paper bg-bg border border-[#7a856f]/55 hover:border-pear hover:text-pear transition-all flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>Analyze Game</span>
              </button>

              <button
                onClick={openEditor}
                disabled={!enginesReady}
                className="w-full py-3 font-space text-[12px] tracking-wider uppercase font-semibold text-paper bg-bg border border-[#7a856f]/55 hover:border-pear hover:text-pear transition-all flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>Board Editor</span>
              </button>
            </div>

            {/* Match history list */}
            <div className="flex-grow p-6 px-8 flex flex-col min-h-0">
              <div className="block-label font-mono text-[9.5px] text-pear tracking-[0.12em] mb-3 uppercase font-bold shrink-0">
                Match History
              </div>
              {matchHistory.length > 0 ? (
                <div className="space-y-2 flex-grow overflow-y-auto pr-1 min-h-[240px]">
                  {matchHistory.map((rec) => (
                    <div
                      key={rec.id}
                      onClick={() => rec.pgn && loadGameForAnalysis(rec.pgn)}
                      title={rec.pgn ? 'Analyze this game' : undefined}
                      className={`group p-2 border border-line bg-bg/50 rounded-[3px] text-[10.5px] font-mono flex justify-between items-center ${rec.pgn ? 'cursor-pointer hover:border-pear/60 hover:bg-pear-tint/5' : ''} transition-all`}
                    >
                      <div>
                        <div className="font-bold text-paper flex items-center gap-1.5">
                          vs Otter ({rec.opponentElo})
                          {rec.pgn && (
                            <span className="text-pear opacity-0 group-hover:opacity-100 transition-opacity text-[9px] normal-case font-normal">Analyze &rarr;</span>
                          )}
                        </div>
                        <div className="text-[9px] text-muted">{rec.date} • {rec.movesCount} moves</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-[2px] font-bold uppercase text-[9px] shrink-0 ${
                        rec.result === 'win' ? 'bg-pear-tint/15 text-pear border border-pear/30' :
                        rec.result === 'loss' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                        'bg-paper/10 text-muted border border-[#7a856f]/30'
                      }`}>
                        {rec.result}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted italic text-center py-6 border border-dashed border-[#7a856f]/30 rounded-[3px]">
                  No matches completed yet.
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ================= Active Match Mode ================= */
          <div className="flex-grow flex flex-col min-h-0 divide-y divide-line">
            {/* Header info */}
            <div className="p-4 px-6 bg-panel/30">
              <h3 className="font-space font-medium text-[14.5px] text-paper">
                {isThinking ? 'Otter is thinking...' : gameStatus}
              </h3>
            </div>

            {/* Plies list */}
            <div className="p-4 px-6 flex-grow flex flex-col min-h-0">
              <div className="block-label font-mono text-[9px] text-pear tracking-[0.1em] mb-2 uppercase font-bold">
                Move List
              </div>
              <div className="movelist overflow-y-auto flex-grow pr-1 flex flex-col gap-1 text-[11px] font-mono max-h-[300px]">
                {historyMovesSan.length > 0 ? (
                  historyMovesSan.reduce<React.ReactElement[]>((acc, move, idx) => {
                    if (idx % 2 === 0) {
                      const moveNum = Math.floor(idx / 2) + 1;
                      const nextMove = historyMovesSan[idx + 1];
                      acc.push(
                        <div key={idx} className="move-row flex gap-2.5 py-0.5 border-b border-line/10">
                          <span className="move-num text-muted w-6">{moveNum}.</span>
                          <span className="move-w text-paper w-[64px]">{move}</span>
                          {nextMove && <span className="move-b text-pear">{nextMove}</span>}
                        </div>
                      );
                    }
                    return acc;
                  }, [])
                ) : (
                  <div className="move-row flex gap-2.5 text-muted italic">
                    No moves played yet.
                  </div>
                )}
              </div>
            </div>

            {/* Action block: takeback, draw offer, resign */}
            <div className="p-4 px-6 space-y-2">
              <button
                onClick={takeback}
                disabled={historyMoves.length === 0}
                className="w-full font-mono text-[10.5px] tracking-[0.01em] py-2 text-center border border-pear/30 bg-pear/10 text-pear hover:border-pear hover:bg-pear/20 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Request Takeback
              </button>
              <button
                onClick={offerDraw}
                className="w-full font-mono text-[10.5px] tracking-[0.01em] py-2 text-center border border-pear/30 bg-pear/10 text-pear hover:border-pear hover:bg-pear/20 transition-all cursor-pointer"
              >
                Offer Draw
              </button>
              <button
                onClick={() => setShowResignConfirm(true)}
                className="w-full font-mono text-[10.5px] tracking-[0.01em] py-2 text-center border border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:border-red-500 transition-all cursor-pointer"
              >
                Resign Match
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Floating Status Toast (Bottom Right) */}
      {showReadyToast && (
        <div className="static lg:fixed m-4 lg:m-0 lg:bottom-6 lg:right-6 z-40 flex items-center gap-3 p-3.5 px-4 bg-panel border border-[#7a856f]/35 rounded-[4px] shadow-2xl text-paper text-xs font-mono lg:max-w-sm transition-all duration-300 transform select-none">
          {/* Status Indicator Dot */}
          <span className="relative flex h-2 w-2">
            {(!enginesReady || checkingAvailability) && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pear opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${enginesReady ? 'bg-pear' : 'bg-orange-400'}`}></span>
          </span>
          
          <div className="flex-grow">
            {checkingAvailability ? (
              <span className="text-muted">Checking engines...</span>
            ) : !enginesReady ? (
              (!modelAvailable || !stockfishAvailable) ? (
                <div className="flex items-center gap-2">
                  <span className="text-paper/85">Engines offline</span>
                  <button
                    onClick={() => setShowSetupModal(true)}
                    className="text-[10px] font-bold text-pear uppercase hover:underline cursor-pointer border border-pear/30 bg-pear-tint/10 px-2 py-0.5 rounded"
                  >
                    Setup
                  </button>
                </div>
              ) : (
                <span className="text-muted">Loading weights...</span>
              )
            ) : (
              <span className="text-pear font-semibold flex items-center gap-1">
                <span>Engines ready</span>
                <span className="text-[10px]">✓</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL: FEN / PGN (Analyze mode) ================= */}
      {showFenPgnModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
          <div className="w-full max-w-md p-8 bg-panel border border-[#7a856f]/55 space-y-5 shadow-2xl relative text-paper rounded-[4px]">
            <div className="border-b border-[#7a856f]/35 pb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-space font-medium text-paper">FEN / PGN</h2>
              <button
                onClick={() => setShowFenPgnModal(false)}
                className="text-muted hover:text-paper font-mono text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-mono text-muted uppercase font-bold">FEN</span>
                <button
                  onClick={() => navigator.clipboard.writeText(game?.fen() || "")}
                  className="text-[11px] font-mono text-pear hover:underline cursor-pointer uppercase font-bold"
                >
                  Copy
                </button>
              </div>
              <div className="w-full px-2.5 py-1.5 bg-bg border border-[#7a856f]/40 text-[12.5px] font-mono text-paper rounded-[2px] break-all select-all">
                {game?.fen() || ""}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-mono text-muted uppercase font-bold">PGN</span>
                <button
                  onClick={() => navigator.clipboard.writeText(game?.pgn() || "")}
                  className="text-[11px] font-mono text-pear hover:underline cursor-pointer uppercase font-bold"
                >
                  Copy
                </button>
              </div>
              <div className="w-full px-2.5 py-1.5 bg-bg border border-[#7a856f]/40 text-[12.5px] font-mono text-paper rounded-[2px] whitespace-pre-wrap break-words max-h-[220px] overflow-y-auto select-all">
                {game?.pgn() || "No moves recorded yet."}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: PAWN PROMOTION ================= */}
      {pendingPromotion && (
        <div className="fixed inset-0 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
          <div className="w-full max-w-xs p-6 bg-panel border border-[#7a856f]/55 space-y-4 shadow-2xl relative text-paper rounded-[4px]">
            <div className="border-b border-[#7a856f]/35 pb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-space font-medium text-paper">Promote pawn to</h2>
              <button
                onClick={cancelPromotion}
                className="text-muted hover:text-paper font-mono text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['q', 'r', 'b', 'n'] as const).map((p) => {
                const symbols = pendingPromotion.color === 'w'
                  ? { q: '♕', r: '♖', b: '♗', n: '♘' }
                  : { q: '♛', r: '♜', b: '♝', n: '♞' };
                const labels = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
                return (
                  <button
                    key={p}
                    onClick={() => resolvePromotion(p)}
                    title={labels[p]}
                    className="h-16 border border-line rounded flex items-center justify-center text-4xl text-paper hover:border-pear hover:bg-pear-tint/10 transition-all cursor-pointer"
                  >
                    {symbols[p]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: DRAW OFFER DECLINED ================= */}
      {drawDeclined && (
        <div className="fixed inset-0 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
          <div className="w-full max-w-xs p-6 bg-panel border border-[#7a856f]/55 space-y-5 shadow-2xl relative text-paper rounded-[4px]">
            <div className="border-b border-[#7a856f]/35 pb-3">
              <h2 className="text-[16px] font-space font-medium text-paper">Draw declined</h2>
              <p className="text-[12px] text-muted leading-relaxed mt-1">
                {historyMoves.length < 30
                  ? "Otter won't consider a draw this early in the game."
                  : 'Otter likes its position too much to agree to a draw right now.'}
              </p>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setDrawDeclined(false)}
                className="font-mono text-xs uppercase tracking-[0.04em] px-6 py-2.5 bg-pear border border-pear text-bg font-semibold hover:bg-pear-tint hover:border-pear-tint transition-all cursor-pointer"
              >
                Continue playing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: RESIGN CONFIRMATION ================= */}
      {showResignConfirm && (
        <div className="fixed inset-0 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
          <div className="w-full max-w-xs p-6 bg-panel border border-[#7a856f]/55 space-y-5 shadow-2xl relative text-paper rounded-[4px]">
            <div className="border-b border-[#7a856f]/35 pb-3">
              <h2 className="text-[16px] font-space font-medium text-paper">Resign match?</h2>
              <p className="text-[12px] text-muted leading-relaxed mt-1">This counts as a loss in your match history and can't be undone.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResignConfirm(false)}
                className="font-mono text-xs uppercase tracking-[0.04em] px-4 py-2.5 text-muted hover:text-paper hover:bg-bg/40 transition-all cursor-pointer border border-[#7a856f]/30 hover:border-pear/40"
              >
                Cancel
              </button>
              <button
                onClick={resignMatch}
                className="font-mono text-xs uppercase tracking-[0.04em] px-6 py-2.5 bg-red-500 border border-red-500 text-bg font-semibold hover:bg-red-600 hover:border-red-600 transition-all cursor-pointer"
              >
                Resign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: INITIALIZE / DOWNLOAD ENGINES ================= */}
      {showSetupModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
          <div className="w-full max-w-md p-8 bg-panel border border-[#7a856f]/55 space-y-6 shadow-2xl relative text-paper rounded-[4px]">
            
            {/* Close button */}
            <button
              onClick={() => setShowSetupModal(false)}
              className="absolute top-4 right-4 text-muted hover:text-paper font-mono text-sm cursor-pointer"
            >
              ✕
            </button>

            <div className="border-b border-[#7a856f]/35 pb-3">
              <h2 className="text-xl font-space font-bold text-paper">
                Initialize
              </h2>
            </div>

            <p className="text-xs text-muted leading-relaxed font-sans">
              We need to download the models to challenge Otter.
            </p>
            
            <div className="space-y-4">
              {/* Otter model download */}
              <div className="p-4 border border-[#7a856f]/55 bg-bg rounded-[3px]">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h3 className="text-xs font-mono font-bold text-paper">1. Otter Chess Model</h3>
                    <span className="text-[10px] text-muted">Neural weights file (62MB)</span>
                  </div>
                  {modelAvailable ? (
                    <span className="text-[10.5px] font-mono text-pear font-semibold border border-pear/30 bg-pear-tint/10 px-2 py-0.5">Downloaded ✓</span>
                  ) : (
                    <button
                      onClick={downloadOtterModel}
                      disabled={isDownloadingModel}
                      className="text-[11px] font-mono font-bold uppercase text-pear border border-pear px-2.5 py-1 hover:bg-pear hover:text-bg transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isDownloadingModel ? 'Downloading...' : 'Download'}
                    </button>
                  )}
                </div>
                {isDownloadingModel && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full bg-panel border border-[#7a856f]/35 overflow-hidden">
                      <div className="h-full bg-pear transition-all duration-300" style={{ width: `${modelProgress}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px] font-mono text-muted">
                      <span>Fetching Otter ONNX model...</span>
                      <span>{modelProgress}%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Stockfish download */}
              <div className="p-4 border border-[#7a856f]/55 bg-bg rounded-[3px]">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h3 className="text-xs font-mono font-bold text-paper">2. Stockfish Engine</h3>
                    <span className="text-[10px] text-muted">Evaluation bundle (1.5MB)</span>
                  </div>
                  {stockfishAvailable ? (
                    <span className="text-[10.5px] font-mono text-pear font-semibold border border-pear/30 bg-pear-tint/10 px-2 py-0.5">Downloaded ✓</span>
                  ) : (
                    <button
                      onClick={downloadStockfish}
                      disabled={isDownloadingSf}
                      className="text-[11px] font-mono font-bold uppercase text-pear border border-pear px-2.5 py-1 hover:bg-pear hover:text-bg transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isDownloadingSf ? 'Downloading...' : 'Download'}
                    </button>
                  )}
                </div>
                {isDownloadingSf && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full bg-panel border border-[#7a856f]/35 overflow-hidden">
                      <div className="h-full bg-pear transition-all duration-300" style={{ width: `${sfProgress}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px] font-mono text-muted">
                      <span>Fetching Stockfish bundle...</span>
                      <span>{sfProgress}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {downloadError && (
              <div className="text-[10.5px] text-rose-500 font-mono bg-rose-500/10 border border-rose-500/30 rounded px-2.5 py-2 leading-relaxed text-center">
                {downloadError}
              </div>
            )}

            <div className="text-[11px] text-muted italic font-mono pt-1 text-center">
              Engines will run locally. No positions or moves ever leave your device.
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: CONFIGURE MATCH ================= */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-paper/25 backdrop-blur-sm z-50 transition-opacity">
          <div className="w-full max-w-md p-8 bg-panel border border-[#7a856f]/55 space-y-6 shadow-2xl relative text-paper rounded-[4px]">
            
            <div className="border-b border-[#7a856f]/35 pb-3">
              <h2 className="text-[20px] font-space font-medium text-paper">Configure Match vs Otter</h2>
              <p className="text-[12px] text-muted leading-relaxed mt-1">Challenge Otter's neural network to a custom game.</p>
            </div>

            {/* Slider strength */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-mono font-bold text-muted uppercase tracking-wider">Otter Rating Strength</label>
                <span className="font-space text-[17px] font-medium text-pear">{playerElo}</span>
              </div>
              <input
                type="range"
                min="800"
                max="2600"
                step="100"
                value={playerElo}
                onChange={(e) => {
                  setPlayerElo(parseInt(e.target.value));
                  setOpponentElo(parseInt(e.target.value));
                }}
                className="w-full accent-pear h-[4px] bg-[#7a856f]/40 rounded-full appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted font-mono font-medium leading-none mt-1">
                <span>Novice (800)</span>
                <span>Club (1500)</span>
                <span>Super GM (2600)</span>
              </div>
            </div>

            {/* Time control selection */}
            <div className="space-y-2">
              <label className="block text-xs font-mono font-bold text-muted uppercase tracking-wider">Time Control Format</label>
              <select
                value={timeControl}
                onChange={(e) => setTimeControl(e.target.value)}
                className="w-full px-3 py-2.5 bg-bg border border-[#7a856f]/55 text-xs text-paper focus:outline-none focus:border-pear font-semibold font-mono rounded-[3px]"
              >
                <option value="60+0">Bullet (1+0)</option>
                <option value="180+2">Blitz (3+2)</option>
                <option value="600+0">Rapid (10+0)</option>
                <option value="900+10">Rapid (15+10)</option>
                <option value="1800+0">Classical (30+0)</option>
              </select>
            </div>

            {/* Thinking Speed */}
            <div className="space-y-2">
              <label className="block text-xs font-mono font-bold text-muted uppercase tracking-wider">Otter Thinking Mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setThinkingMode('instant')}
                  className={`flex-1 py-2 px-3 text-xs font-mono uppercase tracking-[0.02em] font-semibold border transition-all cursor-pointer ${
                    thinkingMode === 'instant' 
                      ? 'border-pear text-pear bg-pear-tint/10' 
                      : 'border-[#7a856f]/55 text-muted hover:border-pear/60 hover:text-paper bg-transparent'
                  }`}
                >
                  Instant response
                </button>
                <button
                  onClick={() => setThinkingMode('human')}
                  className={`flex-1 py-2 px-3 text-xs font-mono uppercase tracking-[0.02em] font-semibold border transition-all cursor-pointer ${
                    thinkingMode === 'human' 
                      ? 'border-pear text-pear bg-pear-tint/10' 
                      : 'border-[#7a856f]/55 text-muted hover:border-pear/60 hover:text-paper bg-transparent'
                  }`}
                >
                  Human-like delay
                </button>
              </div>
            </div>

            {/* Side selection */}
            <div className="space-y-2">
              <label className="block text-xs font-mono font-bold text-muted uppercase tracking-wider">Your Side Selection</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setChosenSide('w')}
                  className={`flex-1 py-2.5 px-3 text-xs font-semibold font-space border transition-all cursor-pointer ${
                    chosenSide === 'w' 
                      ? 'border-pear text-pear bg-pear-tint/5' 
                      : 'border-[#7a856f]/55 text-muted hover:text-paper bg-transparent'
                  }`}
                >
                  White
                </button>
                <button
                  onClick={() => setChosenSide('random')}
                  className={`flex-1 py-2.5 px-3 text-xs font-semibold font-space border transition-all cursor-pointer ${
                    chosenSide === 'random' 
                      ? 'border-pear text-pear bg-pear-tint/5' 
                      : 'border-[#7a856f]/55 text-muted hover:text-paper bg-transparent'
                  }`}
                >
                  Random
                </button>
                <button
                  onClick={() => setChosenSide('b')}
                  className={`flex-1 py-2.5 px-3 text-xs font-semibold font-space border transition-all cursor-pointer ${
                    chosenSide === 'b' 
                      ? 'border-pear text-pear bg-pear-tint/5' 
                      : 'border-[#7a856f]/55 text-muted hover:text-paper bg-transparent'
                  }`}
                >
                  Black
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-[#7a856f]/35">
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="font-mono text-xs uppercase tracking-[0.04em] px-4 py-2.5 text-muted hover:text-paper hover:bg-bg/40 transition-all cursor-pointer border border-[#7a856f]/30 hover:border-pear/40"
              >
                Cancel
              </button>
              <button
                onClick={startMatch}
                className="font-mono text-xs uppercase tracking-[0.04em] px-6 py-2.5 bg-pear border border-pear text-bg font-semibold hover:bg-pear-tint hover:border-pear-tint transition-all cursor-pointer"
              >
                Start Match
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ANALYZE GAME ================= */}
      {isAnalyzeModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-paper/25 backdrop-blur-sm z-50 transition-opacity">
          <div className="w-full max-w-md p-8 bg-panel border border-[#7a856f]/55 space-y-6 shadow-2xl relative text-paper rounded-[4px]">
            
            <div className="border-b border-[#7a856f]/35 pb-3">
              <h2 className="text-[20px] font-space font-medium text-paper">Analyze Chess Game</h2>
              <p className="text-[12px] text-muted leading-relaxed mt-1">Paste PGN game history or a starting FEN string.</p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-mono font-bold text-muted uppercase tracking-wider">PGN or FEN Input</label>
              <textarea
                value={analyzeInput}
                onChange={(e) => setAnalyzeInput(e.target.value)}
                placeholder="e.g. 1. e4 e5 2. Nf3 Nc6 or paste FEN..."
                className="w-full px-3.5 py-3 bg-bg border border-[#7a856f]/55 text-xs text-paper focus:outline-none focus:border-pear font-mono h-[140px] resize-none rounded-[3px]"
              />
            </div>

            {analyzeError && (
              <div className="text-xs text-rose-500 font-mono">
                {analyzeError}
              </div>
            )}

            <div className="flex justify-between items-center gap-3 pt-4 border-t border-[#7a856f]/35">
              <button
                onClick={() => loadGameForAnalysis("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")}
                className="font-mono text-xs uppercase tracking-[0.04em] px-3 py-2.5 text-muted hover:text-pear transition-all cursor-pointer"
              >
                Start From Initial Position
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setIsAnalyzeModalOpen(false);
                    setAnalyzeError(null);
                  }}
                  className="font-mono text-xs uppercase tracking-[0.04em] px-4 py-2.5 text-muted hover:text-paper hover:bg-bg/40 transition-all cursor-pointer border border-[#7a856f]/30 hover:border-pear/40"
                >
                  Cancel
                </button>
                <button
                  onClick={() => loadGameForAnalysis(analyzeInput)}
                  className="font-mono text-xs uppercase tracking-[0.04em] px-6 py-2.5 bg-pear border border-pear text-bg font-semibold hover:bg-pear-tint hover:border-pear-tint transition-all cursor-pointer"
                >
                  Load Analysis
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
