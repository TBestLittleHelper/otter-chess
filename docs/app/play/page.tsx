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

interface MatchRecord {
  id: string;
  date: string;
  opponentElo: number;
  timeControl: string;
  playerColor: 'w' | 'b';
  result: 'win' | 'loss' | 'draw';
  movesCount: number;
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
  const [auxMovingPiece, setAuxMovingPiece] = useState<string>("-");
  const [auxCapturedPiece, setAuxCapturedPiece] = useState<string>("-");
  const [auxCheckProb, setAuxCheckProb] = useState<string>("-");
  const [auxFromTo, setAuxFromTo] = useState<string>("-");
  const [modelPredMove, setModelPredMove] = useState<{ from: string; to: string } | null> (null);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

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
  const [editorSelectedPiece, setEditorSelectedPiece] = useState<'erase' | 'move' | 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP' | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP'>('wP');
  const [editorMoveSource, setEditorMoveSource] = useState<string | null>(null);
  const [editorTurn, setEditorTurn] = useState<'w' | 'b'>('w');
  const [editorCastling, setEditorCastling] = useState({ wK: true, wQ: true, bK: true, bQ: true });
  const [isFreeform, setIsFreeform] = useState<boolean>(true);

  // refs to avoid stale closure bindings
  const activeTurnRef = useRef<'w' | 'b'>('w');
  const currentFenRef = useRef<string>("");
  const ignoreSearchLinesRef = useRef<boolean>(true);

  // ONNX Session & Vocabs
  const sessionRef = useRef<any>(null);
  const policyMoveToIdRef = useRef<Record<string, number>>({});
  const idToMoveRef = useRef<Record<number, string>>({});
  const historyMoveToIdRef = useRef<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<Api | null>(null);
  const mouseDownCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const lastInferenceSeqRef = useRef<number>(0);
  const currentInferencePromiseRef = useRef<Promise<any> | null>(null);

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

  // 3. Automated Otter Game Loop
  useEffect(() => {
    if (!isMatchActive || !game || !modelLoaded || isThinking) return;

    const turn = game.turn();
    if (turn !== playerColor) {
      setIsThinking(true);
      
      const runOtterTurn = async () => {
        try {
          const currentMoves = game.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
          const inferenceResult = await runModelInference(game, currentMoves);
          
          if (inferenceResult && inferenceResult.length > 0) {
            const bestMove = inferenceResult[0].move;
            const delaySec = getExpectedHumanTime(inferenceResult, timeControl, otterTime);
            const thinkingDelay = thinkingMode === 'human' ? delaySec * 1000 : 50;
            
            setTimeout(() => {
              playModelMove(bestMove);
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

  // Real-time ticking clock loop
  useEffect(() => {
    if (!isMatchActive || !game || game.isGameOver()) return;

    const interval = setInterval(() => {
      const turn = game.turn();
      if (turn === playerColor) {
        setPlayerTime(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            recordMatch('loss');
            alert("You lost on time!");
            return 0;
          }
          return prev - 1;
        });
      } else {
        setOtterTime(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            recordMatch('win');
            alert("Otter lost on time!");
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isMatchActive, game, playerColor]);

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
    
    // Detect promotion
    const pieceObj = game.get(orig as any);
    const isPawn = pieceObj && pieceObj.type === 'p';
    const isPromoRank = dest[1] === '8' || dest[1] === '1';
    let promotionPiece: 'q' | 'r' | 'b' | 'n' | undefined = undefined;
    
    if (isPawn && isPromoRank) {
      const choice = prompt("Pawn promotion! Choose: q (Queen), r (Rook), b (Bishop), n (Knight)", "q");
      if (choice && ['q', 'r', 'b', 'n'].includes(choice.toLowerCase())) {
        promotionPiece = choice.toLowerCase() as any;
      } else {
        promotionPiece = 'q';
      }
    }

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
          setEditorMoveSource(null);

          try {
            const newGame = new Chess(newFen);
            setGame(newGame);
          } catch (_) {}
        }
        return;
      }

      if (currentMoveIdx < analysisMoves.length - 1) {
        const nextMoves = analysisMoves.slice(0, currentMoveIdx + 1);
        setAnalysisMoves(nextMoves);
        
        const temp = new Chess(currentMoveIdx === -1 ? analysisStartingFen : analysisMoves[currentMoveIdx].fen);
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
          const updatedMoves = [...nextMoves, newMove];
          setAnalysisMoves(updatedMoves);
          setCurrentMoveIdx(updatedMoves.length - 1);
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
      newGame = new Chess(game.fen());
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
      return true;
    } catch (e: any) {
      alert(`Invalid Chess Position: ${e.message || e}`);
      return false;
    }
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
          free: isEditorMode && isFreeform,
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
          enabled: true,
          eraseOnClick: true,
        }
      });
      cgRef.current = cg;
    }
  }, [game]);

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
      } else if (isAnalyzeMode && topMoves.length > 0) {
        finalShapes = topMoves.slice(0, 3).map((m, idx) => {
          const from = m.move.slice(0, 2);
          const to = m.move.slice(2, 4);
          const colors = ['green', 'yellow', 'blue'];
          return {
            orig: from,
            dest: to,
            brush: colors[idx] || 'green'
          };
        });
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
          free: isEditorMode && isFreeform,
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
          shapes: finalShapes as any
        }
      });
    }
  }, [historyMoves, isFlipped, playerColor, topMoves, isMatchActive, isAnalyzeMode, isEditorMode, isFreeform, game, liveFenInput, editorSelectedPiece, editorMoveSource]);

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
        
        let depth = 0;
        if (line.includes('depth')) {
          const parts = line.split(' ');
          const dIdx = parts.indexOf('depth');
          if (dIdx !== -1 && parts[dIdx + 1]) {
            depth = parseInt(parts[dIdx + 1], 10);
          }
        }

        const isMate = line.includes('score mate');
        if (depth >= 10 || isMate) {
          const isBlackTurn = activeTurnRef.current === 'b';
          let scoreVal = 0;

          if (line.includes('score cp')) {
            const parts = line.split(' ');
            const cpIdx = parts.indexOf('cp');
            if (cpIdx !== -1 && parts[cpIdx + 1]) {
              const cp = parseInt(parts[cpIdx + 1], 10);
              
              // Standardize centipawns relative to White's perspective
              scoreVal = isBlackTurn ? -cp : cp;
              
              const maxCp = 400;
              const bounded = Math.max(-maxCp, Math.min(maxCp, scoreVal));
              const pct = Math.round(((bounded + maxCp) / (maxCp * 2)) * 100);
              setStockfishEvalPct(pct);
            }
          } else if (isMate) {
            const parts = line.split(' ');
            const mateIdx = parts.indexOf('mate');
            if (mateIdx !== -1 && parts[mateIdx + 1]) {
              const mate = parseInt(parts[mateIdx + 1], 10);
              const isWhiteWinning = (mate > 0 && !isBlackTurn) || (mate < 0 && isBlackTurn);
              setStockfishEvalPct(isWhiteWinning ? 100 : 0);
              scoreVal = isWhiteWinning ? 10000 : -10000;
            }
          }

          // Cache the score for the current FEN
          const currentFen = currentFenRef.current;
          if (currentFen) {
            setFenScores(prev => ({ ...prev, [currentFen]: scoreVal }));
          }
        }
      };

      sfWorker.postMessage('uci');
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

      // 3. Initialize ORT
      const ort = require('onnxruntime-web');
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
      
      const sessionOptions = {
        executionProviders: provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm']
      };

      const session = await ort.InferenceSession.create(modelBuffer, sessionOptions);
      sessionRef.current = session;
      
      setModelLoaded(true);
      await initStockfishWorker();
    } catch (err) {
      console.error("Background engine init failed:", err);
    }
  };

  // Download Otter Model (62MB)
  const downloadOtterModel = async () => {
    if (isDownloadingModel) return;
    setIsDownloadingModel(true);
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
      alert("Failed to download Otter Chess model. Please check connection.");
    } finally {
      setIsDownloadingModel(false);
    }
  };

  // Download Stockfish Engine (1.5MB)
  const downloadStockfish = async () => {
    if (isDownloadingSf) return;
    setIsDownloadingSf(true);
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
      alert("Failed to download Stockfish. Please check connection.");
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
          shapes: []
        }
      });
    }
  };

  // Resign match
  const resignMatch = () => {
    if (confirm("Are you sure you want to resign the match?")) {
      recordMatch('loss');
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
        cgRef.current.set({ drawable: { shapes: shapes as any } });
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
      movesCount: historyMoves.length
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

    if (hasCustomPosition) {
      if (confirm("Do you want to use the pasted FEN or PGN?")) {
        setIsAnalyzeMode(true);
      } else {
        setAnalyzeInput("");
        setAnalyzeError(null);
        setIsAnalyzeModalOpen(true);
      }
    } else {
      alert("Please paste a FEN or PGN to start analysis.");
      setAnalyzeInput("");
      setAnalyzeError(null);
      setIsAnalyzeModalOpen(true);
    }
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
  };

  // 4. Game Analysis Logic
  const loadGameForAnalysis = (input: string) => {
    const cleanInput = input.trim();
    if (!cleanInput) return;

    const tempChess = new Chess();
    setAnalyzeError(null);

    // Try reading as FEN first
    try {
      tempChess.load(cleanInput);
      setAnalysisMoves([]);
      setCurrentMoveIdx(-1);
      setAnalysisStartingFen(cleanInput);
      setGame(tempChess);
      setIsAnalyzeMode(true);
      setIsAnalyzeModalOpen(false);
      updateGameState(tempChess);
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
      setAnalysisStartingFen(initialFen);

      const startChess = new Chess();
      setGame(startChess);
      setIsAnalyzeMode(true);
      setIsAnalyzeModalOpen(false);
      updateGameState(startChess);
      return;
    } catch (e) {}

    setAnalyzeError("Invalid FEN or PGN. Please verify the format.");
  };

  const goToAnalysisMove = (idx: number) => {
    if (isMatchActive || !game) return;
    if (idx < -1 || idx >= analysisMoves.length) return;

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
        goToAnalysisMove(currentMoveIdx + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToAnalysisMove(currentMoveIdx - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        goToAnalysisMove(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        goToAnalysisMove(analysisMoves.length - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAnalyzeMode, analysisMoves, currentMoveIdx]);

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
          shapes: endOfGameShapes as any
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

  // Run model prediction via ONNX
  const runModelInference = async (c: Chess, history: string[]): Promise<PredictedMove[] | null> => {
    // Validate FEN compatibility with chess.js to avoid throws during editing
    try {
      new Chess(c.fen());
    } catch (e) {
      console.warn("Skipping model inference for invalid FEN:", c.fen());
      return null;
    }

    if (!sessionRef.current || !modelLoaded) return null;

    const currentSeq = ++lastInferenceSeqRef.current;

    // Wait for any running inference to complete to prevent concurrent session.run calls
    if (currentInferencePromiseRef.current) {
      try {
        await currentInferencePromiseRef.current;
      } catch (_) {}
    }

    // If a newer inference has started while we were waiting, discard this stale run
    if (currentSeq !== lastInferenceSeqRef.current) {
      return null;
    }

    let resolvePromise: () => void = () => {};
    const inferencePromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    currentInferencePromiseRef.current = inferencePromise;

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

      const isActivePlayerTurn = c.turn() === playerColor;
      const activeElo = eloToBucket(isActivePlayerTurn ? playerRating : playerElo);
      const opponentEloVal = eloToBucket(isActivePlayerTurn ? playerElo : playerRating);

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

      // 5. Construct ORT inputs
      const ort = require('onnxruntime-web');
      const feeds = {
        board: new ort.Tensor('float32', boardData, [1, 18, 8, 8]),
        history_ids: new ort.Tensor('int64', historyIds, [1, 20]),
        history_mask: new ort.Tensor('bool', historyMask, [1, 20]),
        active_elo: new ort.Tensor('int64', new BigInt64Array([BigInt(activeElo)]), [1]),
        opponent_elo: new ort.Tensor('int64', new BigInt64Array([BigInt(opponentEloVal)]), [1]),
        tc: new ort.Tensor('int64', new BigInt64Array([BigInt(timeControlBucket)]), [1]),
        clock: new ort.Tensor('float32', Float32Array.from([normalizedClockFraction, 0.0]), [1, 2]),
      };

      const results = await sessionRef.current.run(feeds);
      
      const policyLogits = results.policy_logits.data;
      const auxLogits = results.aux_logits.data;
      const valuePred = results.value_pred.data[0];

      // Set win evaluation
      setWinProbability(valuePred);

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

      const mvProbs = softmax(Array.from(auxLogits.slice(0, 6)) as number[]);
      const mvIdx = mvProbs.indexOf(Math.max(...mvProbs));
      setAuxMovingPiece(`${pieceNames[mvIdx]} (${(mvProbs[mvIdx] * 100).toFixed(0)}%)`);

      let capText = "None";
      if (sortedMoves.length > 0) {
        const topMove = sortedMoves[0].move;
        const toSq = topMove.slice(2, 4);
        const targetPiece = c.get(toSq as any);
        if (targetPiece) {
          const capProbs = softmax(Array.from(auxLogits.slice(6, 12)) as number[]);
          const capIdx = capProbs.indexOf(Math.max(...capProbs));
          capText = `${pieceNames[capIdx]} (${(capProbs[capIdx] * 100).toFixed(0)}%)`;
        }
      }
      setAuxCapturedPiece(capText);

      const checkProb = sigmoid(auxLogits[12] as number);
      setAuxCheckProb(`${(checkProb * 100).toFixed(0)}%`);

      if (sortedMoves.length > 0) {
        const topMove = sortedMoves[0].move;
        setAuxFromTo(`${topMove.slice(0, 2)} → ${topMove.slice(2, 4)}`);
        setModelPredMove({ from: topMove.slice(0, 2), to: topMove.slice(2, 4) });
      }

      return sortedMoves;

    } catch (err) {
      console.error("ORT evaluation error:", err);
      return null;
    } finally {
      resolvePromise();
      if (currentInferencePromiseRef.current === inferencePromise) {
        currentInferencePromiseRef.current = null;
      }
    }
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
          newGame = new Chess(game.fen());
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
      newGame = new Chess(game.fen());
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
          shapes: []
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

  return (
    <div className="flex-grow flex flex-col md:flex-row min-h-0 divide-x divide-line h-[calc(100vh-68px)]">
      
      {/* COLUMN 1 (LEFT): Live FEN & PGN Notation */}
      <div className="w-[280px] shrink-0 flex flex-col bg-panel min-h-0 divide-y divide-line">
        <div className="p-5 px-6 space-y-4 bg-panel/30 flex-grow flex flex-col min-h-0">
          <div className="block-label font-mono text-[9.5px] text-pear tracking-[0.12em] uppercase font-bold">
            <span>Live Game Notation</span>
          </div>
          <div className="space-y-3.5 flex-grow flex flex-col min-h-0">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-mono text-muted uppercase font-bold">FEN</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(game?.fen() || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
                  }}
                  className="text-[9px] font-mono text-pear hover:underline cursor-pointer uppercase font-bold"
                >
                  Copy
                </button>
              </div>
              <input
                type="text"
                readOnly={isMatchActive || (!isAnalyzeMode && !isEditorMode)}
                value={liveFenInput}
                onChange={handleFenInputChange}
                className="w-full px-2.5 py-1.5 bg-bg border border-[#7a856f]/40 text-[10.5px] font-mono text-paper rounded-[2px] focus:outline-none focus:border-pear/50"
              />
            </div>
            <div className="flex-grow flex flex-col min-h-0">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-mono text-muted uppercase font-bold">PGN</span>
                <button
                  disabled={isEditorMode && isFreeform}
                  onClick={() => {
                    navigator.clipboard.writeText(game?.pgn() || "");
                  }}
                  className={`text-[9px] font-mono text-pear hover:underline cursor-pointer uppercase font-bold ${(isEditorMode && isFreeform) ? 'opacity-40 pointer-events-none' : ''}`}
                >
                  Copy
                </button>
              </div>
              <textarea
                readOnly={isMatchActive || (!isAnalyzeMode && !isEditorMode) || (isEditorMode && isFreeform)}
                value={isEditorMode && isFreeform ? "" : livePgnInput}
                onChange={handlePgnInputChange}
                placeholder={isEditorMode && isFreeform ? "PGN is disabled in Freeform Mode." : "No moves recorded yet."}
                className={`w-full flex-grow px-2.5 py-1.5 bg-bg border border-[#7a856f]/40 text-[10.5px] font-mono text-paper rounded-[2px] focus:outline-none focus:border-pear/50 resize-none min-h-[220px] ${(isEditorMode && isFreeform) ? 'opacity-40 pointer-events-none select-none' : ''}`}
              />
            </div>
          </div>
        </div>

        {/* ELO Rating Badge */}
        <div className="p-6 px-8 border-t border-line bg-panel/30 space-y-2 shrink-0">
          <div className="text-muted text-[10px] uppercase font-bold font-mono">Your Rating</div>
          <div className="text-2xl font-space font-medium text-pear font-bold tracking-tight">{playerRating} ELO</div>
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

        {/* Profile cards swapped on flip — Otter goes below when flipped */}
        {(isFlipped ? [
          { key: 'guest', label: 'Guest', rating: playerRating, dotBlack: playerColor !== 'w', isOtter: false, time: playerTime, turnActive: game?.turn() === playerColor },
          { key: 'otter', label: 'Otter AI', rating: playerElo, dotBlack: playerColor === 'w', isOtter: true, time: otterTime, turnActive: game?.turn() !== playerColor },
        ] : [
          { key: 'otter', label: 'Otter AI', rating: playerElo, dotBlack: playerColor === 'w', isOtter: true, time: otterTime, turnActive: game?.turn() !== playerColor },
          { key: 'guest', label: 'Guest', rating: playerRating, dotBlack: playerColor !== 'w', isOtter: false, time: playerTime, turnActive: game?.turn() === playerColor },
        ]).map((card) => (
          <div key={card.key} className="w-[min(82vh,720px)] flex justify-between items-center px-4 py-2 border border-[#7a856f]/30 bg-panel/30 rounded-[3px]">
            <div className="flex items-center gap-2.5">
              <span className={`w-3 h-3 rounded-full border border-[#7a856f]/40 ${card.dotBlack ? 'bg-[#1a1b15]' : 'bg-[#FFFFFF]'}`} />
              <div className="font-mono text-xs text-paper font-semibold">
                {card.label} <span className={card.isOtter ? 'text-pear' : 'text-muted'}>({card.rating})</span>
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
        ))}
        {/* Board and Dual Eval Bars Wrapper */}
        <div className="flex items-center gap-4 relative">
                   {/* Evaluation Bars (Shown on the Left side of Chessboard, visible during analysis) */}
          {isAnalyzeMode && (
            <div className="flex gap-2 h-[min(82vh,720px)]">
              {/* Stockfish Eval Bar */}
              <div 
                className="w-[14px] bg-[#1a1b15] border border-line flex flex-col justify-end overflow-hidden rounded-[2px] relative group cursor-help h-full"
                title={`Stockfish Eval: ${((stockfishEvalPct - 50) / 10).toFixed(2)}`}
              >
                <div 
                  className="w-full bg-[#FFFFFF] border-t border-line transition-all duration-300 ease-out"
                  style={{ height: `${whitePct}%` }}
                ></div>
                <div className="absolute inset-x-0 bottom-2 text-center text-[8px] font-mono font-bold pointer-events-none select-none text-bg mix-blend-difference">
                  {((stockfishEvalPct - 50) / 10).toFixed(1)}
                </div>
              </div>

              {/* Otter Subjective Eval Bar */}
              <div 
                className="w-[14px] bg-[#1a1b15] border border-line flex flex-col justify-end overflow-hidden rounded-[2px] relative group cursor-help h-full"
                title={`Otter Win Prob: ${otterWinPct}%`}
              >
                <div 
                  className="w-full bg-pear border-t border-line transition-all duration-300 ease-out"
                  style={{ height: `${otterWinPct}%` }}
                ></div>
                <div className="absolute inset-x-0 bottom-2 text-center text-[8px] font-mono font-bold pointer-events-none select-none text-bg mix-blend-difference">
                  {otterWinPct}%
                </div>
              </div>
            </div>
          )}

          {/* Chessboard View Container */}
          <div 
            onMouseDown={handleBoardMouseDown}
            onMouseUp={handleBoardMouseUp}
            className="relative w-[min(82vh,720px)] aspect-square border border-line bg-sq-dark overflow-hidden"
          >
            <div ref={containerRef} className="w-full h-full" />
          </div>
        </div>

      </div>

      {/* COLUMN 3 (RIGHT): Controls & Move History */}
      <div className="w-[340px] shrink-0 flex flex-col bg-panel min-h-0 divide-y divide-line overflow-y-auto">
        
        {/* Move History / Lobby Middle Area */}
        {isAnalyzeMode ? (
          /* ================= Analysis Mode Sidebar ================= */
          <div className="flex-grow flex flex-col min-h-0 divide-y divide-line">
            {/* Header info */}
            <div className="p-4 px-6 bg-panel/30 flex justify-between items-center">
              <div>
                <span className="font-mono text-[10.5px] text-pear uppercase font-bold tracking-wider">Analysis Mode</span>
                <h3 className="font-space font-medium text-[15px] text-paper mt-0.5">
                  Game Review
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsAnalyzeMode(false);
                  setAnalysisMoves([]);
                  setCurrentMoveIdx(-1);
                  resetBoard();
                }}
                className="font-mono text-[10px] text-rose-500 uppercase font-bold hover:underline cursor-pointer border border-red-500/20 px-2 py-0.5 rounded hover:bg-rose-500/5 transition-all"
              >
                Exit
              </button>
            </div>

            {/* Navigation Controls */}
            <div className="p-4 px-6 bg-panel/10 flex flex-col gap-2">
              <div className="flex justify-between items-center gap-2">
                <button
                  onClick={() => goToAnalysisMove(-1)}
                  disabled={currentMoveIdx === -1}
                  className="flex-1 py-1.5 bg-bg border border-[#7a856f]/35 hover:border-pear hover:text-pear disabled:opacity-30 disabled:hover:border-[#7a856f]/35 disabled:hover:text-paper font-mono text-center font-bold rounded-[3px] transition-all cursor-pointer text-xs"
                  title="Go to Start"
                >
                  &lt;&lt;
                </button>
                <button
                  onClick={() => goToAnalysisMove(currentMoveIdx - 1)}
                  disabled={currentMoveIdx === -1}
                  className="flex-1 py-1.5 bg-bg border border-[#7a856f]/35 hover:border-pear hover:text-pear disabled:opacity-30 disabled:hover:border-[#7a856f]/35 disabled:hover:text-paper font-mono text-center font-bold rounded-[3px] transition-all cursor-pointer text-xs"
                  title="Previous Move"
                >
                  &lt;
                </button>
                <button
                  onClick={() => goToAnalysisMove(currentMoveIdx + 1)}
                  disabled={currentMoveIdx === analysisMoves.length - 1}
                  className="flex-1 py-1.5 bg-bg border border-[#7a856f]/35 hover:border-pear hover:text-pear disabled:opacity-30 disabled:hover:border-[#7a856f]/35 disabled:hover:text-paper font-mono text-center font-bold rounded-[3px] transition-all cursor-pointer text-xs"
                  title="Next Move"
                >
                  &gt;
                </button>
                <button
                  onClick={() => goToAnalysisMove(analysisMoves.length - 1)}
                  disabled={currentMoveIdx === analysisMoves.length - 1}
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

            {/* Move List */}
            <div className="p-4 px-6 overflow-y-auto max-h-[300px]">
              <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.12em] mb-2 uppercase font-bold">
                Move List ({analysisMoves.length} moves)
              </div>
              {analysisMoves.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                  {Array.from({ length: Math.ceil(analysisMoves.length / 2) }).map((_, movePairIdx) => {
                    const move1Idx = movePairIdx * 2;
                    const move2Idx = movePairIdx * 2 + 1;
                    const m1 = analysisMoves[move1Idx];
                    const m2 = analysisMoves[move2Idx];

                    return (
                      <React.Fragment key={movePairIdx}>
                        <button
                          onClick={() => goToAnalysisMove(move1Idx)}
                          className={`p-1.5 border text-left rounded-[2px] transition-all truncate cursor-pointer text-[11px] ${
                            currentMoveIdx === move1Idx
                              ? 'border-pear text-pear bg-pear-tint/10 font-bold'
                              : 'border-line text-paper/85 bg-bg hover:border-line/75'
                          }`}
                        >
                          {movePairIdx + 1}. {m1.san} {m1.classification ? `(${m1.classification === 'Good Move' ? 'Good' : m1.classification === 'Best Move' ? 'Best' : m1.classification})` : ''}
                        </button>
                        {m2 ? (
                          <button
                            onClick={() => goToAnalysisMove(move2Idx)}
                            className={`p-1.5 border text-left rounded-[2px] transition-all truncate cursor-pointer text-[11px] ${
                              currentMoveIdx === move2Idx
                                ? 'border-pear text-pear bg-pear-tint/10 font-bold'
                                : 'border-line text-paper/85 bg-bg hover:border-line/75'
                            }`}
                          >
                            {m2.san} {m2.classification ? `(${m2.classification === 'Good Move' ? 'Good' : m2.classification === 'Best Move' ? 'Best' : m2.classification})` : ''}
                          </button>
                        ) : (
                          <div className="p-1.5" />
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

            {/* Analysis Stats (Accuracy & Engine evaluations) */}
            <div className="p-4 px-6 bg-panel/10 flex-grow flex flex-col justify-end space-y-3">
              {currentMoveIdx >= 0 && (
                <div className="space-y-2.5 font-mono text-xs">
                  <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.12em] uppercase font-bold">
                    Move Performance
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 border border-[#7a856f]/35 bg-bg rounded-[3px]">
                      <div className="text-muted text-[8px] uppercase font-bold mb-0.5 text-center">Move Quality</div>
                      <div className={`text-[11.5px] font-bold text-center ${
                        playedMoveEvaluation === 'Blunder' ? 'text-rose-500 font-extrabold animate-pulse' :
                        playedMoveEvaluation === 'Mistake' ? 'text-orange-400' :
                        playedMoveEvaluation === 'Inaccuracy' ? 'text-yellow-500' :
                        playedMoveEvaluation === 'Best Move' ? 'text-pear font-extrabold' : 'text-paper'
                      }`}>
                        {playedMoveEvaluation || 'Evaluating...'}
                      </div>
                    </div>

                    <div className="p-2 border border-[#7a856f]/35 bg-bg rounded-[3px]">
                      <div className="text-muted text-[8px] uppercase font-bold mb-0.5 text-center">Human Match</div>
                      <div className={`text-[11.5px] font-bold text-center ${similarityPct > 60 ? 'text-pear' : 'text-paper'}`}>
                        {similarityPct}%
                      </div>
                    </div>

                    <div className="col-span-2 p-2 border border-[#7a856f]/35 bg-bg rounded-[3px] flex justify-between items-center text-[10px]">
                      <div className="text-muted uppercase font-bold">Est. Human Think Time</div>
                      <div className="font-bold text-pear">
                        {getExpectedHumanTime(
                          fenPredictions[currentMoveIdx === 0 ? analysisStartingFen : analysisMoves[currentMoveIdx - 1]?.fen || ""] || [],
                          timeControl,
                          600
                        )}s
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Otter AI Predictions */}
              <div className="pt-2">
                <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.12em] mb-2 uppercase font-bold">
                  Otter Predictions
                </div>
                <div className="space-y-1 font-mono text-xs max-h-[90px] overflow-y-auto pr-1">
                  {topMoves.slice(0, 3).map((pm, idx) => (
                    <div key={pm.move} className="flex justify-between items-center py-0.5 border-b border-line/20 last:border-0 text-[11px]">
                      <span className="font-semibold text-paper">{idx + 1}. {pm.move}</span>
                      <span className="text-pear font-bold">{(pm.probability * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                  {topMoves.length === 0 && (
                    <div className="text-[11px] text-muted italic">Running predictions...</div>
                  )}
                </div>
              </div>

              {/* AI Intuition Dashboard */}
              <div className="pt-4">
                <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.12em] mb-2 uppercase font-bold">
                  Otter AI Intuition
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2 border border-line bg-bg rounded-[3px]">
                    <div className="text-muted text-[8px] uppercase font-bold mb-0.5">Subjective Eval</div>
                    <div className={`text-[11.5px] font-bold ${winProbability > 0.15 ? 'text-pear' : winProbability < -0.15 ? 'text-rose-500' : 'text-paper'}`}>
                      {winProbability > 0 ? '+' : ''}{winProbability.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-2 border border-line bg-bg rounded-[3px]">
                    <div className="text-muted text-[8px] uppercase font-bold mb-0.5">Check Prob</div>
                    <div className="text-[11.5px] font-bold text-paper">
                      {auxCheckProb}
                    </div>
                  </div>
                  <div className="p-2 border border-line bg-bg rounded-[3px]">
                    <div className="text-muted text-[8px] uppercase font-bold mb-0.5">Moving Piece</div>
                    <div className="text-[11px] font-bold text-paper truncate" title={auxMovingPiece}>
                      {auxMovingPiece}
                    </div>
                  </div>
                  <div className="p-2 border border-line bg-bg rounded-[3px]">
                    <div className="text-muted text-[8px] uppercase font-bold mb-0.5">Target Capture</div>
                    <div className="text-[11px] font-bold text-paper truncate" title={auxCapturedPiece}>
                      {auxCapturedPiece}
                    </div>
                  </div>
                  <div className="col-span-2 p-2 border border-line bg-bg rounded-[3px] flex justify-between items-center text-[10px]">
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
                onClick={() => {
                  setIsEditorMode(false);
                  resetBoard();
                }}
                className="font-mono text-[10px] text-rose-500 uppercase font-bold hover:underline cursor-pointer border border-rose-500/20 px-2 py-0.5 rounded hover:bg-rose-500/5 transition-all"
              >
                Cancel
              </button>
            </div>

            {/* Editor Configuration Panel */}
            <div className="p-5 px-6 space-y-4 overflow-y-auto flex-grow">
              {/* Freeform / Record PGN Toggle */}
              <div>
                <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.1em] mb-2 uppercase font-bold">
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
                  <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.1em] mb-2 uppercase font-bold">
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
                    <div className="block-label font-mono text-[8px] text-pear-dim tracking-[0.1em] pt-1 uppercase font-bold shrink-0">
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
                <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.1em] mb-2 uppercase font-bold">
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
                <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.1em] mb-2 uppercase font-bold">
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
              <div className="block-label font-mono text-[9.5px] text-pear-dim tracking-[0.12em] mb-3 uppercase font-bold shrink-0">
                Match History
              </div>
              {matchHistory.length > 0 ? (
                <div className="space-y-2 flex-grow overflow-y-auto pr-1 min-h-[240px]">
                  {matchHistory.map((rec) => (
                    <div key={rec.id} className="p-2 border border-line bg-bg/50 rounded-[3px] text-[10.5px] font-mono flex justify-between items-center">
                      <div>
                        <div className="font-bold text-paper">vs Otter ({rec.opponentElo})</div>
                        <div className="text-[9px] text-muted">{rec.date} • {rec.movesCount} moves</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-[2px] font-bold uppercase text-[9px] ${
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
              <div className="block-label font-mono text-[9px] text-pear-dim tracking-[0.1em] mb-2 uppercase font-bold">
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

            {/* Action resigning block */}
            <div className="p-4 px-6">
              <button
                onClick={resignMatch}
                className="w-full font-mono text-[10.5px] tracking-[0.01em] py-2 text-center border border-red-500/40 text-red-500 bg-transparent hover:bg-red-500/5 hover:border-red-500 transition-all cursor-pointer"
              >
                Resign Match
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Floating Status Toast (Bottom Right) */}
      {showReadyToast && (
        <div className="fixed bottom-6 right-6 z-40 flex items-center gap-3 p-3.5 px-4 bg-panel border border-[#7a856f]/35 rounded-[4px] shadow-2xl text-paper text-xs font-mono max-w-sm transition-all duration-300 transform select-none">
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
              <div className="flex items-center gap-2 font-mono text-[10px] text-pear tracking-[0.08em] uppercase">
                <span className="border border-pear px-1.5 py-0.5">INITIALIZE</span>
                <span>Requires local engines</span>
              </div>
              <h2 className="text-xl font-space font-bold text-paper mt-2">
                Challenge Setup Required
              </h2>
            </div>
            
            <p className="text-xs text-muted leading-relaxed font-sans">
              To challenge the Otter AI directly inside your browser, we download and load the execution engines locally.
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

            <div className="flex justify-end gap-3 pt-4 border-t border-[#7a856f]/35">
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
      )}

    </div>
  );
}
