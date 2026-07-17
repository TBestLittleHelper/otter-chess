'use client';

export default function PromotionModal({
  pendingPromotion,
  cancelPromotion,
  resolvePromotion,
}: {
  pendingPromotion: { orig: string; dest: string; color: 'w' | 'b' };
  cancelPromotion: () => void;
  resolvePromotion: (piece: 'q' | 'r' | 'b' | 'n') => void;
}) {
  return (
    <div className="fixed inset-0 p-4 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
      <div className="w-full max-w-xs p-6 bg-panel border border-[#7a856f]/55 space-y-4 shadow-2xl relative text-paper rounded-[4px]">
        <div className="border-b border-[#7a856f]/35 pb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-space font-medium text-paper">Promote pawn to</h2>
          <button
            onClick={cancelPromotion}
            className="text-muted hover:text-paper font-mono text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {(['q', 'r', 'b', 'n'] as const).map((p) => {
            const symbols = pendingPromotion.color === 'w'
              ? { q: '♕', r: '♖', b: '♗', n: '♘' }
              : { q: '♛', r: '♜', b: '♝', n: '♞' };
            const labels = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
            return (
              <button
                key={p}
                onClick={() => resolvePromotion(p)}
                title={labels[p]}
                className="h-16 border border-line rounded flex items-center justify-center text-4xl text-paper hover:border-pear hover:bg-pear-tint/10 transition-all cursor-pointer"
              >
                {symbols[p]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
