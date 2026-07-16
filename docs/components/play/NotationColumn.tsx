'use client';

import React from 'react';
import type { Chess } from 'chess.js';
import type { AnalysisMove, BranchMove } from '@/lib/play/types';

// Column 1: "Move History" (with branch rendering) in Analyze mode, or
// "Live Game Notation" (editable FEN/PGN) everywhere else. Collapsible
// below lg either way.
export default function NotationColumn({
  mobileNotationOpen,
  setMobileNotationOpen,
  isAnalyzeMode,
  setShowFenPgnModal,
  analysisMoves,
  branchesByBase,
  branchViewIdx,
  currentMoveIdx,
  branchMoves,
  renderBranchVariation,
  goToAnalysisMove,
  jumpToAnalysisStart,
  jumpToAnalysisEnd,
  stepAnalysis,
  game,
  liveFenInput,
  handleFenInputChange,
  isMatchActive,
  isEditorMode,
  isFreeform,
  livePgnInput,
  handlePgnInputChange,
  playerRating,
}: {
  mobileNotationOpen: boolean;
  setMobileNotationOpen: (fn: (v: boolean) => boolean) => void;
  isAnalyzeMode: boolean;
  setShowFenPgnModal: (v: boolean) => void;
  analysisMoves: AnalysisMove[];
  branchesByBase: Map<number, BranchMove[]>;
  branchViewIdx: number;
  currentMoveIdx: number;
  branchMoves: BranchMove[];
  renderBranchVariation: (baseIdx: number) => React.ReactNode;
  goToAnalysisMove: (idx: number) => void;
  jumpToAnalysisStart: () => void;
  jumpToAnalysisEnd: () => void;
  stepAnalysis: (direction: 1 | -1) => void;
  game: Chess | null;
  liveFenInput: string;
  handleFenInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isMatchActive: boolean;
  isEditorMode: boolean;
  isFreeform: boolean;
  livePgnInput: string;
  handlePgnInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  playerRating: number;
}) {
  return (
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
  );
}
