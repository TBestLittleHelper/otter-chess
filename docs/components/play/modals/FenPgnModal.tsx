'use client';

import type { Chess } from 'chess.js';

export default function FenPgnModal({
  onClose,
  game,
}: {
  onClose: () => void;
  game: Chess | null;
}) {
  return (
    <div className="fixed inset-0 p-4 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
      <div className="w-full max-w-md max-h-[calc(100dvh-32px)] overflow-y-auto p-6 sm:p-8 bg-panel border border-[#7a856f]/55 space-y-5 shadow-2xl relative text-paper rounded-[4px]">
        <div className="border-b border-[#7a856f]/35 pb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-space font-medium text-paper">FEN / PGN</h2>
          <button
            onClick={onClose}
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
  );
}
