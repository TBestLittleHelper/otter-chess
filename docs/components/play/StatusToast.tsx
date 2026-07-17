'use client';

export default function StatusToast({
  checkingAvailability,
  enginesReady,
  modelAvailable,
  stockfishAvailable,
  onSetupClick,
}: {
  checkingAvailability: boolean;
  enginesReady: boolean;
  modelAvailable: boolean;
  stockfishAvailable: boolean;
  onSetupClick: () => void;
}) {
  return (
    // order-4: on mobile this renders in-flow inside the /play flex column,
    // whose children are explicitly ordered (board 1, sidebar 2, notation 3)
    // — without an order of its own it would default to 0 and jump above
    // the board. On lg it's fixed-positioned, where order is irrelevant.
    <div className="order-4 static lg:fixed m-4 lg:m-0 lg:bottom-6 lg:right-6 z-40 flex items-center gap-3 p-3.5 px-4 bg-panel border border-[#7a856f]/35 rounded-[4px] shadow-2xl text-paper text-xs font-mono lg:max-w-sm transition-all duration-300 transform select-none">
      {/* Status Indicator Dot */}
      <span className="relative flex h-2 w-2">
        {(!enginesReady || checkingAvailability) && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pear opacity-75"></span>
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${enginesReady ? 'bg-pear' : 'bg-orange-400'}`}></span>
      </span>

      <div className="flex-grow">
        {checkingAvailability ? (
          <span className="text-muted">Checking engines...</span>
        ) : !enginesReady ? (
          (!modelAvailable || !stockfishAvailable) ? (
            <div className="flex items-center gap-2">
              <span className="text-paper/85">Engines offline</span>
              <button
                onClick={onSetupClick}
                className="text-[10px] font-bold text-pear uppercase hover:underline cursor-pointer border border-pear/30 bg-pear-tint/10 px-2 py-0.5 rounded"
              >
                Setup
              </button>
            </div>
          ) : (
            <span className="text-muted">Loading weights...</span>
          )
        ) : (
          <span className="text-pear font-semibold flex items-center gap-1">
            <span>Engines ready</span>
            <span className="text-[10px]">✓</span>
          </span>
        )}
      </div>
    </div>
  );
}
