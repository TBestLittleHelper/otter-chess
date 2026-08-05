'use client';

import React from 'react';

export default function ActiveMatchSidebar({
  isThinking,
  gameStatus,
  historyMovesSan,
  historyMoves,
  takeback,
  offerDraw,
  onResignClick,
}: {
  isThinking: boolean;
  gameStatus: string;
  historyMovesSan: string[];
  historyMoves: string[];
  takeback: () => void;
  offerDraw: () => void;
  onResignClick: () => void;
}) {
  return (
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
        <div className="movelist lg:overflow-y-auto flex-grow pr-1 flex flex-col gap-1 text-[11px] font-mono lg:max-h-[300px]">
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
          onClick={onResignClick}
          className="w-full font-mono text-[10.5px] tracking-[0.01em] py-2 text-center border border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:border-red-500 transition-all cursor-pointer"
        >
          Resign Match
        </button>
      </div>
    </div>
  );
}
