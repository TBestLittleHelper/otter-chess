// Shared types for the /play page (docs/app/play/page.tsx and its
// extracted hooks/components).

// Simple type for Chess piece representation
export interface Piece {
  type: 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
  color: 'w' | 'b';
  square: string;
}

// Predicted move object
export interface PredictedMove {
  move: string;
  probability: number;
}

export interface RatingCurveSeries {
  move: string;
  san: string;
  color: string;
  label: string;
  points: { eloBucket: number; probability: number }[];
}

export interface MatchRecord {
  id: string;
  date: string;
  opponentElo: number;
  timeControl: string;
  playerColor: 'w' | 'b';
  result: 'win' | 'loss' | 'draw';
  movesCount: number;
  pgn: string;
}

// One ply of a loaded game or a saved branch/variation.
export interface BranchMove {
  san: string;
  uci: string;
  fen: string;
  from: string;
  to: string;
}

// A ply of the real (loaded) game line — same shape as a branch move plus
// an optional Stockfish-derived quality label.
export interface AnalysisMove extends BranchMove {
  classification?: string;
}
