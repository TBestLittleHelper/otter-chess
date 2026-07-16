'use client';

import React from 'react';
import type { AnalysisMove } from '@/lib/play/types';

type EditorPiece = 'erase' | 'move' | 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP' | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP';
type EditorCastling = { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };

export default function EditorSidebar({
  exitEditorMode,
  isFreeform,
  onFreeformClick,
  onRecordPgnClick,
  editorSelectedPiece,
  setEditorSelectedPiece,
  editorMoveSource,
  analysisMoves,
  editorTurn,
  onTurnChange,
  editorCastling,
  onCastlingChange,
  onResetBoard,
  onClearBoard,
  editorPositionError,
  onAnalyzeClick,
  onPlayOtterClick,
  onCancelClick,
}: {
  exitEditorMode: () => void;
  isFreeform: boolean;
  onFreeformClick: () => void;
  onRecordPgnClick: () => void;
  editorSelectedPiece: EditorPiece;
  setEditorSelectedPiece: (p: EditorPiece) => void;
  editorMoveSource: string | null;
  analysisMoves: AnalysisMove[];
  editorTurn: 'w' | 'b';
  onTurnChange: (turn: 'w' | 'b') => void;
  editorCastling: EditorCastling;
  onCastlingChange: (next: EditorCastling) => void;
  onResetBoard: () => void;
  onClearBoard: () => void;
  editorPositionError: string | null;
  onAnalyzeClick: () => void;
  onPlayOtterClick: () => void;
  onCancelClick: () => void;
}) {
  return (
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
              onClick={onFreeformClick}
              className={`flex-1 py-2 border rounded text-[11px] font-mono cursor-pointer transition-all ${
                isFreeform ? 'border-pear bg-pear-tint/10 text-pear font-bold' : 'border-line/45 text-paper hover:border-pear'
              }`}
            >
              Freeform (FEN)
            </button>
            <button
              onClick={onRecordPgnClick}
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
                    onClick={() => setEditorSelectedPiece(p as EditorPiece)}
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
                    onClick={() => setEditorSelectedPiece(p as EditorPiece)}
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
              onClick={() => onTurnChange('w')}
              className={`flex-1 py-2 border rounded text-xs font-mono cursor-pointer transition-all ${
                editorTurn === 'w' ? 'border-pear bg-pear-tint/10 text-pear font-bold' : 'border-line/45 text-paper hover:border-pear'
              }`}
            >
              White to play
            </button>
            <button
              onClick={() => onTurnChange('b')}
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
                onChange={(e) => onCastlingChange({ ...editorCastling, wK: e.target.checked })}
                className="accent-pear"
              />
              <span>White O-O</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editorCastling.wQ}
                onChange={(e) => onCastlingChange({ ...editorCastling, wQ: e.target.checked })}
                className="accent-pear"
              />
              <span>White O-O-O</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editorCastling.bK}
                onChange={(e) => onCastlingChange({ ...editorCastling, bK: e.target.checked })}
                className="accent-pear"
              />
              <span>Black O-O</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editorCastling.bQ}
                onChange={(e) => onCastlingChange({ ...editorCastling, bQ: e.target.checked })}
                className="accent-pear"
              />
              <span>Black O-O-O</span>
            </label>
          </div>
        </div>

        {/* Global Editor Actions */}
        <div className="space-y-2 pt-2 border-t border-line">
          <button
            onClick={onResetBoard}
            className="w-full py-2 border border-[#7a856f]/35 rounded text-xs font-mono text-paper bg-bg hover:border-pear transition-all cursor-pointer"
          >
            Reset Starting Board
          </button>
          <button
            onClick={onClearBoard}
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
              onClick={onAnalyzeClick}
              className="flex-1 py-2.5 bg-pear border border-pear rounded text-[11px] font-space font-semibold uppercase text-bg hover:bg-[#4d7524] transition-all cursor-pointer text-center"
            >
              Analyze
            </button>
            <button
              onClick={onPlayOtterClick}
              className="flex-1 py-2.5 bg-bg border border-[#7a856f]/55 rounded text-[11px] font-space font-semibold uppercase text-paper hover:border-pear hover:text-pear transition-all cursor-pointer text-center"
            >
              Play Otter
            </button>
          </div>
          <button
            onClick={onCancelClick}
            className="w-full py-2 border border-red-500/30 hover:border-red-500 rounded text-xs font-mono text-red-400 bg-bg hover:text-red-300 transition-all cursor-pointer text-center mt-2"
          >
            Cancel & Discard Setup
          </button>
        </div>
      </div>
    </div>
  );
}
