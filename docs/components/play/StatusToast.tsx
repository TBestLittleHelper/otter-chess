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
    // order-first: on mobile this renders in-flow inside the /play flex column
    // (board 1, sidebar 2, notation 3) as a full-width strip directly under the
    // header. It used to sit last, which parked the "Setup" button — the only
    // way to get the engines, and the gate on every lobby action — off the
    // bottom of a scrolling page where nobody would find it. On lg it's
    // fixed-positioned bottom-right, where order is irrelevant.
    <div className="order-first lg:order-none shrink-0 w-full lg:w-auto static lg:fixed lg:bottom-6 lg:right-6 z-40 flex items-center gap-3 py-2.5 px-4 lg:p-3.5 lg:px-4 bg-panel border-b lg:border border-[#7a856f]/35 rounded-none lg:rounded-[4px] lg:shadow-2xl text-paper text-xs font-mono lg:max-w-sm transition-all duration-300 transform select-none">
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
