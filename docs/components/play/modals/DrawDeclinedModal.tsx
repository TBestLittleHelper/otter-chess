'use client';

export default function DrawDeclinedModal({
  historyMovesLength,
  onContinue,
}: {
  historyMovesLength: number;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 p-4 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
      <div className="w-full max-w-xs p-6 bg-panel border border-[#7a856f]/55 space-y-5 shadow-2xl relative text-paper rounded-[4px]">
        <div className="border-b border-[#7a856f]/35 pb-3">
          <h2 className="text-[16px] font-space font-medium text-paper">Draw declined</h2>
          <p className="text-[12px] text-muted leading-relaxed mt-1">
            {historyMovesLength < 30
              ? "Otter won't consider a draw this early in the game."
              : 'Otter likes its position too much to agree to a draw right now.'}
          </p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={onContinue}
            className="font-mono text-xs uppercase tracking-[0.04em] px-6 py-2.5 bg-pear border border-pear text-bg font-semibold hover:bg-pear-tint hover:border-pear-tint transition-all cursor-pointer"
          >
            Continue playing
          </button>
        </div>
      </div>
    </div>
  );
}
