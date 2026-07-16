'use client';

export default function ConfigMatchModal({
  playerElo,
  setPlayerElo,
  setOpponentElo,
  timeControl,
  setTimeControl,
  thinkingMode,
  setThinkingMode,
  chosenSide,
  setChosenSide,
  onCancel,
  startMatch,
}: {
  playerElo: number;
  setPlayerElo: (v: number) => void;
  setOpponentElo: (v: number) => void;
  timeControl: string;
  setTimeControl: (v: string) => void;
  thinkingMode: 'instant' | 'human';
  setThinkingMode: (v: 'instant' | 'human') => void;
  chosenSide: 'w' | 'b' | 'random';
  setChosenSide: (v: 'w' | 'b' | 'random') => void;
  onCancel: () => void;
  startMatch: () => void;
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-paper/25 backdrop-blur-sm z-50 transition-opacity">
      <div className="w-full max-w-md p-8 bg-panel border border-[#7a856f]/55 space-y-6 shadow-2xl relative text-paper rounded-[4px]">

        <div className="border-b border-[#7a856f]/35 pb-3">
          <h2 className="text-[20px] font-space font-medium text-paper">Configure Match vs Otter</h2>
          <p className="text-[12px] text-muted leading-relaxed mt-1">Challenge Otter's neural network to a custom game.</p>
        </div>

        {/* Slider strength */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-mono font-bold text-muted uppercase tracking-wider">Otter Rating Strength</label>
            <span className="font-space text-[17px] font-medium text-pear">{playerElo}</span>
          </div>
          <input
            type="range"
            min="800"
            max="2600"
            step="100"
            value={playerElo}
            onChange={(e) => {
              setPlayerElo(parseInt(e.target.value));
              setOpponentElo(parseInt(e.target.value));
            }}
            className="w-full accent-pear h-[4px] bg-[#7a856f]/40 rounded-full appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-muted font-mono font-medium leading-none mt-1">
            <span>Novice (800)</span>
            <span>Club (1500)</span>
            <span>Super GM (2600)</span>
          </div>
        </div>

        {/* Time control selection */}
        <div className="space-y-2">
          <label className="block text-xs font-mono font-bold text-muted uppercase tracking-wider">Time Control Format</label>
          <select
            value={timeControl}
            onChange={(e) => setTimeControl(e.target.value)}
            className="w-full px-3 py-2.5 bg-bg border border-[#7a856f]/55 text-xs text-paper focus:outline-none focus:border-pear font-semibold font-mono rounded-[3px]"
          >
            <option value="60+0">Bullet (1+0)</option>
            <option value="180+2">Blitz (3+2)</option>
            <option value="600+0">Rapid (10+0)</option>
            <option value="900+10">Rapid (15+10)</option>
            <option value="1800+0">Classical (30+0)</option>
          </select>
        </div>

        {/* Thinking Speed */}
        <div className="space-y-2">
          <label className="block text-xs font-mono font-bold text-muted uppercase tracking-wider">Otter Thinking Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => setThinkingMode('instant')}
              className={`flex-1 py-2 px-3 text-xs font-mono uppercase tracking-[0.02em] font-semibold border transition-all cursor-pointer ${
                thinkingMode === 'instant'
                  ? 'border-pear text-pear bg-pear-tint/10'
                  : 'border-[#7a856f]/55 text-muted hover:border-pear/60 hover:text-paper bg-transparent'
              }`}
            >
              Instant response
            </button>
            <button
              onClick={() => setThinkingMode('human')}
              className={`flex-1 py-2 px-3 text-xs font-mono uppercase tracking-[0.02em] font-semibold border transition-all cursor-pointer ${
                thinkingMode === 'human'
                  ? 'border-pear text-pear bg-pear-tint/10'
                  : 'border-[#7a856f]/55 text-muted hover:border-pear/60 hover:text-paper bg-transparent'
              }`}
            >
              Human-like delay
            </button>
          </div>
        </div>

        {/* Side selection */}
        <div className="space-y-2">
          <label className="block text-xs font-mono font-bold text-muted uppercase tracking-wider">Your Side Selection</label>
          <div className="flex gap-2">
            <button
              onClick={() => setChosenSide('w')}
              className={`flex-1 py-2.5 px-3 text-xs font-semibold font-space border transition-all cursor-pointer ${
                chosenSide === 'w'
                  ? 'border-pear text-pear bg-pear-tint/5'
                  : 'border-[#7a856f]/55 text-muted hover:text-paper bg-transparent'
              }`}
            >
              White
            </button>
            <button
              onClick={() => setChosenSide('random')}
              className={`flex-1 py-2.5 px-3 text-xs font-semibold font-space border transition-all cursor-pointer ${
                chosenSide === 'random'
                  ? 'border-pear text-pear bg-pear-tint/5'
                  : 'border-[#7a856f]/55 text-muted hover:text-paper bg-transparent'
              }`}
            >
              Random
            </button>
            <button
              onClick={() => setChosenSide('b')}
              className={`flex-1 py-2.5 px-3 text-xs font-semibold font-space border transition-all cursor-pointer ${
                chosenSide === 'b'
                  ? 'border-pear text-pear bg-pear-tint/5'
                  : 'border-[#7a856f]/55 text-muted hover:text-paper bg-transparent'
              }`}
            >
              Black
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[#7a856f]/35">
          <button
            onClick={onCancel}
            className="font-mono text-xs uppercase tracking-[0.04em] px-4 py-2.5 text-muted hover:text-paper hover:bg-bg/40 transition-all cursor-pointer border border-[#7a856f]/30 hover:border-pear/40"
          >
            Cancel
          </button>
          <button
            onClick={startMatch}
            className="font-mono text-xs uppercase tracking-[0.04em] px-6 py-2.5 bg-pear border border-pear text-bg font-semibold hover:bg-pear-tint hover:border-pear-tint transition-all cursor-pointer"
          >
            Start Match
          </button>
        </div>
      </div>
    </div>
  );
}
