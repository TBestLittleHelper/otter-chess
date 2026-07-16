'use client';

export default function ResignConfirmModal({
  onCancel,
  onResign,
}: {
  onCancel: () => void;
  onResign: () => void;
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
      <div className="w-full max-w-xs p-6 bg-panel border border-[#7a856f]/55 space-y-5 shadow-2xl relative text-paper rounded-[4px]">
        <div className="border-b border-[#7a856f]/35 pb-3">
          <h2 className="text-[16px] font-space font-medium text-paper">Resign match?</h2>
          <p className="text-[12px] text-muted leading-relaxed mt-1">This counts as a loss in your match history and can't be undone.</p>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="font-mono text-xs uppercase tracking-[0.04em] px-4 py-2.5 text-muted hover:text-paper hover:bg-bg/40 transition-all cursor-pointer border border-[#7a856f]/30 hover:border-pear/40"
          >
            Cancel
          </button>
          <button
            onClick={onResign}
            className="font-mono text-xs uppercase tracking-[0.04em] px-6 py-2.5 bg-red-500 border border-red-500 text-bg font-semibold hover:bg-red-600 hover:border-red-600 transition-all cursor-pointer"
          >
            Resign
          </button>
        </div>
      </div>
    </div>
  );
}
