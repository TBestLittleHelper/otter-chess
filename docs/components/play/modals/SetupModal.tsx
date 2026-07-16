'use client';

export default function SetupModal({
  onClose,
  modelAvailable,
  isDownloadingModel,
  modelProgress,
  downloadOtterModel,
  stockfishAvailable,
  isDownloadingSf,
  sfProgress,
  downloadStockfish,
  downloadError,
}: {
  onClose: () => void;
  modelAvailable: boolean;
  isDownloadingModel: boolean;
  modelProgress: number;
  downloadOtterModel: () => void;
  stockfishAvailable: boolean;
  isDownloadingSf: boolean;
  sfProgress: number;
  downloadStockfish: () => void;
  downloadError: string | null;
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-paper/20 backdrop-blur-sm z-50 transition-opacity">
      <div className="w-full max-w-md p-8 bg-panel border border-[#7a856f]/55 space-y-6 shadow-2xl relative text-paper rounded-[4px]">

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-paper font-mono text-sm cursor-pointer"
        >
          ✕
        </button>

        <div className="border-b border-[#7a856f]/35 pb-3">
          <h2 className="text-xl font-space font-bold text-paper">
            Initialize
          </h2>
        </div>

        <p className="text-xs text-muted leading-relaxed font-sans">
          We need to download the models to challenge Otter.
        </p>

        <div className="space-y-4">
          {/* Otter model download */}
          <div className="p-4 border border-[#7a856f]/55 bg-bg rounded-[3px]">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h3 className="text-xs font-mono font-bold text-paper">1. Otter Chess Model</h3>
                <span className="text-[10px] text-muted">Neural weights file (62MB)</span>
              </div>
              {modelAvailable ? (
                <span className="text-[10.5px] font-mono text-pear font-semibold border border-pear/30 bg-pear-tint/10 px-2 py-0.5">Downloaded ✓</span>
              ) : (
                <button
                  onClick={downloadOtterModel}
                  disabled={isDownloadingModel}
                  className="text-[11px] font-mono font-bold uppercase text-pear border border-pear px-2.5 py-1 hover:bg-pear hover:text-bg transition-all cursor-pointer disabled:opacity-50"
                >
                  {isDownloadingModel ? 'Downloading...' : 'Download'}
                </button>
              )}
            </div>
            {isDownloadingModel && (
              <div className="space-y-1">
                <div className="h-1.5 w-full bg-panel border border-[#7a856f]/35 overflow-hidden">
                  <div className="h-full bg-pear transition-all duration-300" style={{ width: `${modelProgress}%` }} />
                </div>
                <div className="flex justify-between text-[9px] font-mono text-muted">
                  <span>Fetching Otter ONNX model...</span>
                  <span>{modelProgress}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Stockfish download */}
          <div className="p-4 border border-[#7a856f]/55 bg-bg rounded-[3px]">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h3 className="text-xs font-mono font-bold text-paper">2. Stockfish Engine</h3>
                <span className="text-[10px] text-muted">Evaluation bundle (1.5MB)</span>
              </div>
              {stockfishAvailable ? (
                <span className="text-[10.5px] font-mono text-pear font-semibold border border-pear/30 bg-pear-tint/10 px-2 py-0.5">Downloaded ✓</span>
              ) : (
                <button
                  onClick={downloadStockfish}
                  disabled={isDownloadingSf}
                  className="text-[11px] font-mono font-bold uppercase text-pear border border-pear px-2.5 py-1 hover:bg-pear hover:text-bg transition-all cursor-pointer disabled:opacity-50"
                >
                  {isDownloadingSf ? 'Downloading...' : 'Download'}
                </button>
              )}
            </div>
            {isDownloadingSf && (
              <div className="space-y-1">
                <div className="h-1.5 w-full bg-panel border border-[#7a856f]/35 overflow-hidden">
                  <div className="h-full bg-pear transition-all duration-300" style={{ width: `${sfProgress}%` }} />
                </div>
                <div className="flex justify-between text-[9px] font-mono text-muted">
                  <span>Fetching Stockfish bundle...</span>
                  <span>{sfProgress}%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {downloadError && (
          <div className="text-[10.5px] text-rose-500 font-mono bg-rose-500/10 border border-rose-500/30 rounded px-2.5 py-2 leading-relaxed text-center">
            {downloadError}
          </div>
        )}

        <div className="text-[11px] text-muted italic font-mono pt-1 text-center">
          Engines will run locally. No positions or moves ever leave your device.
        </div>
      </div>
    </div>
  );
}
