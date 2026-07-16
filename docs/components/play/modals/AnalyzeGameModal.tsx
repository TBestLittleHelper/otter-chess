'use client';

export default function AnalyzeGameModal({
  analyzeInput,
  setAnalyzeInput,
  analyzeError,
  onCancel,
  loadGameForAnalysis,
}: {
  analyzeInput: string;
  setAnalyzeInput: (v: string) => void;
  analyzeError: string | null;
  onCancel: () => void;
  loadGameForAnalysis: (input: string) => void;
}) {
  return (
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

        <div className="space-y-3 pt-4 border-t border-[#7a856f]/35">
          <button
            onClick={() => loadGameForAnalysis("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")}
            className="w-full font-mono text-xs uppercase tracking-[0.04em] px-4 py-2.5 text-muted bg-bg/40 border border-[#7a856f]/40 rounded-[3px] hover:text-pear hover:border-pear/50 transition-all cursor-pointer"
          >
            Start From Initial Position
          </button>
          <div className="flex justify-center items-center gap-3">
            <button
              onClick={onCancel}
              className="flex-1 font-mono text-xs uppercase tracking-[0.04em] px-4 py-2.5 text-muted hover:text-paper hover:bg-bg/40 transition-all cursor-pointer border border-[#7a856f]/30 hover:border-pear/40 rounded-[3px]"
            >
              Cancel
            </button>
            <button
              onClick={() => loadGameForAnalysis(analyzeInput)}
              className="flex-1 font-mono text-xs uppercase tracking-[0.04em] px-6 py-2.5 bg-pear border border-pear text-bg font-semibold hover:bg-pear-tint hover:border-pear-tint transition-all cursor-pointer rounded-[3px]"
            >
              Load Analysis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
