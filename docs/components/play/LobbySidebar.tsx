'use client';

import type { MatchRecord } from '@/lib/play/types';

export default function LobbySidebar({
  enginesReady,
  matchHistory,
  onChallengeClick,
  onAnalyzeClick,
  onEditorClick,
  loadGameForAnalysis,
}: {
  enginesReady: boolean;
  matchHistory: MatchRecord[];
  onChallengeClick: () => void;
  onAnalyzeClick: () => void;
  onEditorClick: () => void;
  loadGameForAnalysis: (input: string) => void;
}) {
  return (
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
          onClick={onChallengeClick}
          disabled={!enginesReady}
          className="w-full py-3 font-space text-[12px] tracking-wider uppercase font-semibold text-bg bg-pear border border-pear hover:bg-[#4d7524] hover:border-[#4d7524] transition-all flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <span>Challenge Otter AI</span>
        </button>

        <button
          onClick={onAnalyzeClick}
          disabled={!enginesReady}
          className="w-full py-3 font-space text-[12px] tracking-wider uppercase font-semibold text-paper bg-bg border border-[#7a856f]/55 hover:border-pear hover:text-pear transition-all flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <span>Analyze Game</span>
        </button>

        <button
          onClick={onEditorClick}
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
  );
}
