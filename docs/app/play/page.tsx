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
        const row = isWhite ? r : 7 - r;
        const color = isWhite ? piece.color : (piece.color === 'w' ? 'b' : 'w');
        const ch = pieceToCh[piece.type] + (color === 'w' ? 0 : 6);
        setVal(ch, row, cIdx, 1.0);
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
    setVal(16, row, file, 1.0);
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
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [possibleSquares, setPossibleSquares] = useState<string[]>([]);
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [gameStatus, setGameStatus] = useState<string>("White to move");

  // Model Parameters
  const [playerElo, setPlayerElo] = useState<number>(1500);
  const [opponentElo, setOpponentElo] = useState<number>(1500);
  const [timeControl, setTimeControl] = useState<string>("600+0");
  const [clockFraction, setClockFraction] = useState<number>(50); // percentage
  const [playerTime, setPlayerTime] = useState<number>(600);
  const [otterTime, setOtterTime] = useState<number>(600);

  // Model Loading & Execution State
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

  // ONNX Session & Vocabs
  const sessionRef = useRef<any>(null);
  const policyMoveToIdRef = useRef<Record<string, number>>({});
  const idToMoveRef = useRef<Record<number, string>>({});
  const historyMoveToIdRef = useRef<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<Api | null>(null);

  // 1. Check cached engines & load match history on mount
  useEffect(() => {
    const initializePage = async () => {
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
      
      const thinkingDelay = thinkingMode === 'human' 
        ? Math.floor(Math.random() * 1500) + 1200 // 1.2s to 2.7s simulated delay
        : 50;

      const timer = setTimeout(async () => {
        try {
          // Run model inference to refresh topMoves
          const currentMoves = game.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
          const inferenceResult = await runModelInference(game, currentMoves);
          
          if (inferenceResult && inferenceResult.length > 0) {
            const bestMove = inferenceResult[0].move;
            playModelMove(bestMove);
          }
        } catch (e) {
          console.error("Otter move generation failed:", e);
        } finally {
          setIsThinking(false);
        }
      }, thinkingDelay);

      return () => clearTimeout(timer);
    }
  }, [historyMoves, isMatchActive, modelLoaded, playerColor, thinkingMode]);

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

  // Real-time ticking clock loop
  useEffect(() => {
    if (!isMatchActive || !game) return;

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

    const moveObj = game.move({
      from: orig as any,
      to: dest as any,
      promotion: promotionPiece
    });

    if (moveObj) {
      updateGameState(game);
    } else {
      // Revert move
      if (cgRef.current) {
        cgRef.current.set({ fen: game.fen() });
      }
    }
  };

  // 1. Initial Chessground instantiation
  useEffect(() => {
    if (containerRef.current && game && !cgRef.current) {
      const cg = Chessground(containerRef.current, {
        fen: game.fen(),
        orientation: isFlipped ? 'black' : 'white',
        turnColor: game.turn() === 'w' ? 'white' : 'black',
        movable: {
          free: false,
          color: playerColor === 'w' ? 'white' : 'black',
          dests: game.turn() === playerColor ? getDests(game) : new Map(),
        },
        events: {
          move: (orig, dest) => {
            handleMoveFromCg(orig, dest);
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

  // 2. Keep Chessground options in sync with external game changes
  useEffect(() => {
    if (cgRef.current && game) {
      cgRef.current.set({
        fen: game.fen(),
        orientation: isFlipped ? 'black' : 'white',
        turnColor: game.turn() === 'w' ? 'white' : 'black',
        movable: {
          dests: game.turn() === playerColor ? getDests(game) : new Map(),
          color: playerColor === 'w' ? 'white' : 'black',
        }
      });
    }
  }, [historyMoves, isFlipped, playerColor]);

  // 3. Render top model predictions as standard Lichess-style analysis arrows
  useEffect(() => {
    if (cgRef.current && isMatchActive && topMoves.length > 0) {
      const shapes = topMoves.slice(0, 3).map((m, idx) => {
        const from = m.move.slice(0, 2);
        const to = m.move.slice(2, 4);
        const colors = ['green', 'yellow', 'blue'];
        return {
          orig: from,
          dest: to,
          brush: colors[idx] || 'green'
        };
      });
      cgRef.current.set({
        drawable: {
          shapes: shapes as any
        }
      });
    } else if (cgRef.current) {
      cgRef.current.set({
        drawable: {
          shapes: []
        }
      });
    }
  }, [topMoves, isMatchActive]);

  // Check if both engines are fully ready
  const enginesReady = modelAvailable && stockfishAvailable;

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
        
        let depth = 0;
        if (line.includes('depth')) {
          const parts = line.split(' ');
          const dIdx = parts.indexOf('depth');
          if (dIdx !== -1 && parts[dIdx + 1]) {
            depth = parseInt(parts[dIdx + 1], 10);
          }
        }

        const isMate = line.includes('score mate');
        if (depth >= 8 || isMate) {
          if (line.includes('score cp')) {
            const parts = line.split(' ');
            const cpIdx = parts.indexOf('cp');
            if (cpIdx !== -1 && parts[cpIdx + 1]) {
              const cp = parseInt(parts[cpIdx + 1], 10);
              const maxCp = 400;
              const bounded = Math.max(-maxCp, Math.min(maxCp, cp));
              const pct = Math.round(((bounded + maxCp) / (maxCp * 2)) * 100);
              setStockfishEvalPct(pct);
            }
          } else if (isMate) {
            const parts = line.split(' ');
            const mateIdx = parts.indexOf('mate');
            if (mateIdx !== -1 && parts[mateIdx + 1]) {
              const mate = parseInt(parts[mateIdx + 1], 10);
              setStockfishEvalPct(mate > 0 ? 100 : 0);
            }
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
    game.reset();
    setHistoryMoves([]);
    setSelectedSquare(null);
    setPossibleSquares([]);
    setTopMoves([]);
    setWinProbability(0.0);
    setAuxMovingPiece("-");
    setAuxCapturedPiece("-");
    setAuxCheckProb("-");
    setAuxFromTo("-");
    setModelPredMove(null);
    
    updateGameState(game);
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

  // Update board grid and game status
  const updateGameState = (c: Chess) => {
    setBoard(c.board() as (Piece | null)[][]);
    const moves = c.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
    setHistoryMoves(moves);
    
    if (stockfishRef.current) {
      stockfishRef.current.postMessage('stop');
      stockfishRef.current.postMessage(`position fen ${c.fen()}`);
      stockfishRef.current.postMessage('go depth 10');
    }
    
    if (c.isCheckmate()) {
      const winnerColor = c.turn() === 'w' ? 'b' : 'w';
      const outcome = winnerColor === playerColor ? 'win' : 'loss';
      setGameStatus(`Checkmate! ${winnerColor === 'w' ? 'White' : 'Black'} wins.`);
      setTimeout(() => recordMatch(outcome), 2500);
    } else if (c.isDraw()) {
      setGameStatus("Game Over - Draw.");
      setTimeout(() => recordMatch('draw'), 2500);
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
    if (!sessionRef.current || !modelLoaded) return null;

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

      const activeElo = eloToBucket(playerElo);
      const opponentEloVal = eloToBucket(opponentElo);

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

      // Decode auxiliary metrics
      const sigmoid = (val: number) => 1 / (1 + Math.exp(-val));
      const mvProbs = Array.from(auxLogits.slice(0, 6)).map(v => sigmoid(v as number));
      const mvIdx = mvProbs.indexOf(Math.max(...mvProbs));
      const pieceNames = ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King"];
      setAuxMovingPiece(`${pieceNames[mvIdx]} (${(mvProbs[mvIdx] * 100).toFixed(0)}%)`);

      const capProbs = Array.from(auxLogits.slice(6, 12)).map(v => sigmoid(v as number));
      const capIdx = capProbs.indexOf(Math.max(...capProbs));
      setAuxCapturedPiece(capProbs[capIdx] > 0.45 ? `${pieceNames[capIdx]} (${(capProbs[capIdx] * 100).toFixed(0)}%)` : "None");

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
        const moveObj = game.move({ from: selectedSquare as any, to: square as any, promotion: 'q' });
        
        if (moveObj) {
          const moveUci = moveObj.from + moveObj.to + (moveObj.promotion || '');
          const newHistory = [...currentHistory, moveUci];
          updateGameState(game);
          
          if (modelLoaded) {
            runModelInference(game, newHistory);
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
    const moveObj = game.move({
      from: moveUci.slice(0, 2) as any,
      to: moveUci.slice(2, 4) as any,
      promotion: moveUci.length > 4 ? moveUci.slice(4) : undefined
    });
    if (moveObj) {
      const newHistory = [...currentHistory, moveUci];
      updateGameState(game);
    }
  };

  const resetBoard = () => {
    if (!game) return;
    game.reset();
    updateGameState(game);
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

  const whitePct = stockfishEvalPct;

  return (
    <div className="flex-grow flex flex-col md:flex-row min-h-0 divide-x divide-line h-[calc(100vh-68px)]">
      
      {/* Left Chessboard Column */}
      <div className="flex-grow flex items-center justify-center bg-bg relative min-h-0 p-4 md:p-6">
        
        {/* Evaluation Bar */}
        {isMatchActive && (
          <div className="absolute left-[34px] top-8 bottom-8 w-[14px] bg-[#1a1b15] border border-line flex flex-col justify-end overflow-hidden z-10 rounded-[2px] hidden md:flex">
            <div 
              className="w-full bg-[#FFFFFF] border-t border-line transition-all duration-500 ease-out"
              style={{ height: `${whitePct}%` }}
            ></div>
          </div>
        )}

        <div className={`relative w-[min(84vh,740px)] aspect-square border border-line ${!isMatchActive ? 'opacity-85 pointer-events-none' : ''}`}>
          <div ref={containerRef} className="w-full h-full" />
        </div>
      </div>

      {/* Right control panel column */}
      <div className="w-[340px] shrink-0 flex flex-col bg-panel min-h-0 divide-y divide-line overflow-y-auto">
        
        {!isMatchActive ? (
          /* ================= Lobby Mode ================= */
          <div className="flex-grow flex flex-col justify-between p-6 px-8 min-h-0">
            <div className="space-y-6 flex-grow flex flex-col min-h-0">
              <div className="pt-2">
                <div className="flex items-center gap-2 font-mono text-[10px] text-pear tracking-[0.08em] mb-2 uppercase">
                  <span className="border border-pear px-1 py-0.5 font-bold">LOBBY</span>
                  <span>Otter Chess Arena</span>
                </div>
                <h2 className="font-space font-medium text-[22px] text-paper">Play Against Otter</h2>
                <p className="text-[12.5px] text-muted leading-relaxed mt-2.5">
                  Challenge Otter directly in your browser. It evaluates chess matches using natural human-style heuristics trained on millions of games.
                </p>
              </div>

              <button
                onClick={() => setIsConfigModalOpen(true)}
                disabled={!enginesReady}
                className={`w-full py-[14px] font-space text-[13px] tracking-wider uppercase font-semibold text-bg bg-pear border border-pear hover:bg-pear-tint hover:border-pear-tint transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span>Challenge Otter AI</span>
                <span className="text-sm font-bold">→</span>
              </button>
            </div>
          </div>
        ) : (
          /* ================= Active Match Mode ================= */
          <div className="flex-grow flex flex-col min-h-0">
            {/* Header info */}
            <div className="p-[22px] px-[28px] border-b border-line bg-panel/30">
              <div className="flex justify-between items-center mb-1">
                <span className="font-mono text-[11px] text-pear uppercase font-bold tracking-wider">Active Match</span>
                <span className="font-mono text-[11px] text-muted">vs Otter ({playerElo})</span>
              </div>
              <h3 className="font-space font-medium text-[16px] text-paper">
                {isThinking ? 'Otter is thinking...' : gameStatus}
              </h3>
            </div>

            {/* Chess Clocks */}
            <div className="p-[22px] px-[28px] grid grid-cols-2 gap-3.5 bg-panel/10">
              <div className={`p-3.5 border rounded-[3px] font-mono text-center transition-all duration-200 ${
                game?.turn() === playerColor 
                  ? 'border-pear/85 bg-pear-tint/10 shadow-[0_0_10px_rgba(92,138,46,0.12)]' 
                  : 'border-line bg-bg/50'
              }`}>
                <div className="text-[9.5px] text-muted font-bold uppercase tracking-wider mb-1">You</div>
                <div className={`text-[20px] font-bold tracking-tight ${game?.turn() === playerColor ? 'text-pear' : 'text-paper/85'}`}>
                  {(() => {
                    const m = Math.floor(playerTime / 60);
                    const s = playerTime % 60;
                    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                  })()}
                </div>
              </div>

              <div className={`p-3.5 border rounded-[3px] font-mono text-center transition-all duration-200 ${
                game?.turn() !== playerColor 
                  ? 'border-pear/85 bg-pear-tint/10 shadow-[0_0_10px_rgba(92,138,46,0.12)]' 
                  : 'border-line bg-bg/50'
              }`}>
                <div className="text-[9.5px] text-muted font-bold uppercase tracking-wider mb-1">Otter AI</div>
                <div className={`text-[20px] font-bold tracking-tight ${game?.turn() !== playerColor ? 'text-pear' : 'text-paper/85'}`}>
                  {(() => {
                    const m = Math.floor(otterTime / 60);
                    const s = otterTime % 60;
                    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                  })()}
                </div>
              </div>
            </div>

            {/* Plies list */}
            <div className="p-[22px] px-[28px] flex-grow flex flex-col min-h-0">
              <div className="block-label font-mono text-[10.5px] text-pear-dim tracking-[0.1em] mb-3 uppercase flex items-center gap-2">
                Moves Play List
              </div>
              <div className="movelist overflow-y-auto flex-grow pr-1 flex flex-col gap-1.5 text-xs font-mono">
                {historyMoves.length > 0 ? (
                  historyMoves.reduce<React.ReactElement[]>((acc, move, idx) => {
                    if (idx % 2 === 0) {
                      const moveNum = Math.floor(idx / 2) + 1;
                      const nextMove = historyMoves[idx + 1];
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

            {/* AI Intuition Dashboard */}
            <div className="p-[22px] px-[28px] border-t border-line bg-panel/10">
              <div className="block-label font-mono text-[10px] text-pear-dim tracking-[0.12em] mb-3.5 uppercase font-bold">
                Otter AI Intuition
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-2.5 border border-line bg-bg rounded-[3px]">
                  <div className="text-muted text-[9px] uppercase font-bold mb-1">Subjective Eval</div>
                  <div className={`text-[12.5px] font-bold ${winProbability > 0.15 ? 'text-pear' : winProbability < -0.15 ? 'text-rose-500' : 'text-paper'}`}>
                    {winProbability > 0 ? '+' : ''}{winProbability.toFixed(2)}
                  </div>
                </div>

                <div className="p-2.5 border border-line bg-bg rounded-[3px]">
                  <div className="text-muted text-[9px] uppercase font-bold mb-1">Check Prob</div>
                  <div className="text-[12.5px] font-bold text-paper">
                    {auxCheckProb}
                  </div>
                </div>

                <div className="p-2.5 border border-line bg-bg rounded-[3px]">
                  <div className="text-muted text-[9px] uppercase font-bold mb-1">Moving Piece</div>
                  <div className="text-[11.5px] font-bold text-paper truncate" title={auxMovingPiece}>
                    {auxMovingPiece}
                  </div>
                </div>

                <div className="p-2.5 border border-line bg-bg rounded-[3px]">
                  <div className="text-muted text-[9px] uppercase font-bold mb-1">Target Capture</div>
                  <div className="text-[11.5px] font-bold text-paper truncate" title={auxCapturedPiece}>
                    {auxCapturedPiece}
                  </div>
                </div>
              </div>
            </div>

            {/* Predictions panel */}
            <div className="p-[22px] px-[28px] border-t border-line">
              <div className="block-label font-mono text-[10.5px] text-pear-dim tracking-[0.1em] mb-3.5 uppercase">
                Predictions Evaluation
              </div>
              <div className="space-y-2">
                {topMoves.length > 0 ? (
                  topMoves.slice(0, 3).map((m, idx) => (
                    <div key={idx} className="flex justify-between items-center text-[12px] font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-pear font-bold bg-pear-tint px-1 py-0.5 border border-pear-dim/20">#{idx+1}</span>
                        <span className="font-bold text-paper">{m.move}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted font-bold">{(m.probability * 100).toFixed(1)}%</span>
                        {game && game.turn() === playerColor && (
                          <button
                            onClick={() => playModelMove(m.move)}
                            className="font-mono text-[10px] uppercase text-pear border border-pear-dim/30 px-2 py-0.5 hover:bg-bg hover:border-pear transition-all cursor-pointer"
                          >
                            Play
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <span className="text-[12.5px] text-muted italic font-mono">
                    Awaiting calculations...
                  </span>
                )}
              </div>
            </div>

            {/* Action resigning block */}
            <div className="p-[22px] px-[28px] border-t border-line">
              <button
                onClick={resignMatch}
                className="w-full font-mono text-[12px] tracking-[0.01em] py-[11px] text-center border border-red-500/40 text-red-500 bg-transparent hover:bg-red-500/5 hover:border-red-500 transition-all cursor-pointer"
              >
                Resign Match
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ================= MODAL: INITIALIZE / DOWNLOAD ENGINES ================= */}
      {checkingAvailability === false && !enginesReady && (
        <div className="fixed inset-0 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
          <div className="w-full max-w-md p-8 bg-panel border border-line space-y-6 shadow-2xl relative text-paper">
            
            <div className="border-b border-line pb-3">
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
              <div className="p-4 border border-line bg-bg rounded-[3px]">
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
                    <div className="h-1.5 w-full bg-panel border border-line overflow-hidden">
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
              <div className="p-4 border border-line bg-bg rounded-[3px]">
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
                    <div className="h-1.5 w-full bg-panel border border-line overflow-hidden">
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
          <div className="w-full max-w-md p-8 bg-panel border border-line space-y-6 shadow-2xl relative text-paper">
            
            <div className="border-b border-line pb-3">
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
                className="w-full accent-pear h-[1.5px] bg-line appearance-none cursor-pointer"
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
                className="w-full px-3 py-2.5 bg-bg border border-line text-xs text-paper focus:outline-none focus:border-pear font-semibold font-mono"
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
                      : 'border-line text-muted hover:border-line/80 hover:text-paper bg-transparent'
                  }`}
                >
                  Instant response
                </button>
                <button
                  onClick={() => setThinkingMode('human')}
                  className={`flex-1 py-2 px-3 text-xs font-mono uppercase tracking-[0.02em] font-semibold border transition-all cursor-pointer ${
                    thinkingMode === 'human' 
                      ? 'border-pear text-pear bg-pear-tint/10' 
                      : 'border-line text-muted hover:border-line/80 hover:text-paper bg-transparent'
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
                      : 'border-line text-muted hover:text-paper bg-transparent'
                  }`}
                >
                  White
                </button>
                <button
                  onClick={() => setChosenSide('random')}
                  className={`flex-1 py-2.5 px-3 text-xs font-semibold font-space border transition-all cursor-pointer ${
                    chosenSide === 'random' 
                      ? 'border-pear text-pear bg-pear-tint/5' 
                      : 'border-line text-muted hover:text-paper bg-transparent'
                  }`}
                >
                  Random
                </button>
                <button
                  onClick={() => setChosenSide('b')}
                  className={`flex-1 py-2.5 px-3 text-xs font-semibold font-space border transition-all cursor-pointer ${
                    chosenSide === 'b' 
                      ? 'border-pear text-pear bg-pear-tint/5' 
                      : 'border-line text-muted hover:text-paper bg-transparent'
                  }`}
                >
                  Black
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-line">
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="font-mono text-xs uppercase tracking-[0.04em] px-4 py-2.5 text-muted hover:text-paper hover:bg-bg/40 transition-all cursor-pointer"
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

    </div>
  );
}
