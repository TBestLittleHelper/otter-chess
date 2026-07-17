'use client';

import type { RefObject } from 'react';
import type { Chess } from 'chess.js';
import { formatSfPoints } from '@/lib/play/chess-utils';
import EvalBar from '@/components/play/EvalBar';

type SfTopMove = { san: string; evalCp: number; from: string; to: string };

type Card = { key: string; label: string; rating: string | number | null; dotBlack: boolean; isOtter: boolean; time: number; turnActive: boolean };

export default function BoardColumn({
  isFlipped,
  setIsFlipped,
  isAnalyzeMode,
  analysisWhiteName,
  analysisWhiteElo,
  analysisBlackName,
  analysisBlackElo,
  game,
  playerColor,
  playerElo,
  otterTime,
  playerRating,
  playerTime,
  isMatchActive,
  boardWrapperRef,
  containerRef,
  handleBoardMouseDown,
  handleBoardMouseUp,
  boardPx,
  otterWinPct,
  whitePct,
  sfTopMoves,
}: {
  isFlipped: boolean;
  setIsFlipped: (v: boolean | ((prev: boolean) => boolean)) => void;
  isAnalyzeMode: boolean;
  analysisWhiteName: string | null;
  analysisWhiteElo: string | null;
  analysisBlackName: string | null;
  analysisBlackElo: string | null;
  game: Chess | null;
  playerColor: 'w' | 'b';
  playerElo: number;
  otterTime: number;
  playerRating: number;
  playerTime: number;
  isMatchActive: boolean;
  boardWrapperRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  handleBoardMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleBoardMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void;
  boardPx: number | null;
  otterWinPct: number;
  whitePct: number;
  sfTopMoves: SfTopMove[];
}) {
  let topCard: Card;
  let bottomCard: Card;

  if (isAnalyzeMode) {
    // Arbitrary loaded game — use the PGN's own player names/ratings
    // when available, and default to the standard White-at-bottom
    // orientation (Flip still swaps it) since there's no reliable way
    // to know which side is "you" from the PGN alone.
    const whiteCard: Card = { key: 'white', label: analysisWhiteName || 'White', rating: analysisWhiteElo, dotBlack: false, isOtter: false, time: 0, turnActive: game?.turn() === 'w' };
    const blackCard: Card = { key: 'black', label: analysisBlackName || 'Black', rating: analysisBlackElo, dotBlack: true, isOtter: false, time: 0, turnActive: game?.turn() === 'b' };
    topCard = isFlipped ? whiteCard : blackCard;
    bottomCard = isFlipped ? blackCard : whiteCard;
  } else {
    const otterColor: 'w' | 'b' = playerColor === 'w' ? 'b' : 'w';
    const otterCard: Card = { key: 'otter', label: 'Otter AI', rating: playerElo, dotBlack: otterColor === 'b', isOtter: true, time: otterTime, turnActive: game?.turn() !== playerColor };
    const guestCard: Card = { key: 'guest', label: 'Guest', rating: playerRating, dotBlack: playerColor === 'b', isOtter: false, time: playerTime, turnActive: game?.turn() === playerColor };
    // White-orientation (not flipped) shows rank 8 on top, so the
    // black-side card belongs on top; flipped orientation reverses that.
    const topColor: 'w' | 'b' = isFlipped ? 'w' : 'b';
    topCard = otterColor === topColor ? otterCard : guestCard;
    bottomCard = otterColor === topColor ? guestCard : otterCard;
  }

  // The board's row PERMANENTLY reserves room for the eval bars — one
  // flanking each side — regardless of whether Analyze mode is currently
  // on. That's what makes the board's size and position fixed: if the
  // reservation only applied while bars were visible, the board would
  // resize/shift every time you entered or left Analyze mode, which is
  // exactly what "never move" rules out.
  //
  // Mobile sizing is flex-derived (flex-1 inside a w-full row), NOT
  // 100vw-based: vw units include the vertical scrollbar, so on a
  // vertically-scrolling page in browsers with classic scrollbars a
  // vw formula overshoots the real content width and causes horizontal
  // overflow. Desktop keeps the vw formula — the lg layout is height-
  // capped so the page never grows a vertical scrollbar there.
  const desktopBoardW = "lg:w-[min(calc(100vw-760px),82vh,720px)]";
  // Cards match the measured board width exactly once boardPx lands
  // (a frame after mount); until then they fall back to full width.
  const cardStyle = boardPx !== null ? { width: boardPx } : undefined;
  const cardClasses = `w-full max-w-[min(80vh,720px)] ${desktopBoardW}`;

  const renderCard = (card: Card) => (
    <div key={card.key} style={cardStyle} className={`${cardClasses} flex justify-between items-center px-4 py-2 border border-[#7a856f]/30 bg-panel/30 rounded-[3px]`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-3 h-3 rounded-full border border-[#7a856f]/40 ${card.dotBlack ? 'bg-[#1a1b15]' : 'bg-[#FFFFFF]'}`} />
        <div className="font-mono text-xs text-paper font-semibold">
          {card.label} {card.rating != null && <span className={card.isOtter ? 'text-pear' : 'text-muted'}>({card.rating})</span>}
        </div>
      </div>
      {isMatchActive && (
        <div className={`font-mono text-[13px] font-bold px-2 py-0.5 border rounded-[2px] ${
          card.turnActive
            ? 'border-pear/85 bg-pear-tint/10 text-pear shadow-[0_0_10px_rgba(92,138,46,0.12)]'
            : 'border-line bg-bg/50 text-paper/85'
        }`}>
          {(() => {
            const m = Math.floor(card.time / 60);
            const s = card.time % 60;
            return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
          })()}
        </div>
      )}
    </div>
  );

  return (
    <div className="order-1 lg:order-2 flex-grow flex flex-col items-center justify-center bg-bg relative min-h-0 px-4 pt-12 pb-5 lg:p-6 space-y-3.5">

      {/* Flip Board Button (top-right, 10px from sidebar) */}
      <button
        onClick={() => setIsFlipped((prev) => !prev)}
        className="absolute top-2 right-2.5 font-mono text-[10px] uppercase tracking-wider text-muted border border-line px-2 py-1 hover:text-pear hover:border-pear transition-all cursor-pointer flex items-center gap-1.5 z-10"
        title="Flip board"
      >
        <span>⟳</span>
        <span>Flip</span>
      </button>

      {renderCard(topCard)}

      {/* Board and Dual Eval Bars Wrapper. The bar SLOTS are always
          rendered — just empty outside Analyze mode — so the row's
          total width (and therefore the board's centered position)
          never changes when Analyze mode toggles their content. */}
      <div className="flex items-center justify-center gap-2 lg:gap-4 relative w-full lg:w-auto">
        <EvalBar
          pct={otterWinPct}
          color="#7CB342"
          text={`${otterWinPct.toFixed(1)}%`}
          title={`Otter Win Prob: ${otterWinPct}%`}
          isFlipped={isFlipped}
          isAnalyzeMode={isAnalyzeMode}
          boardPx={boardPx}
        />

        {/* Chessboard Sizing Wrapper — CSS-driven responsive size, observed but
            never overridden by JS, so it keeps tracking its container. On
            mobile flex-1 hands it exactly the row width left over after the
            bars and gaps — no viewport units involved. */}
        <div
          ref={boardWrapperRef}
          className={`flex-1 min-w-0 max-w-[min(80vh,720px)] lg:flex-none lg:max-w-none ${desktopBoardW} aspect-square flex items-center justify-center`}
        >
          {/* Chessboard View Container — pinned to a multiple of 8px so
              chessground's own crisp-square snapping is a no-op (see 1b above). */}
          <div
            onMouseDown={handleBoardMouseDown}
            onMouseUp={handleBoardMouseUp}
            style={boardPx !== null ? { width: boardPx, height: boardPx } : { width: '100%', height: '100%' }}
            className="relative outline outline-1 outline-line bg-sq-dark overflow-hidden"
          >
            <div ref={containerRef} className="w-full h-full" />
          </div>
        </div>

        <EvalBar
          pct={whitePct}
          color="#F0605F"
          text={formatSfPoints(sfTopMoves[0]?.evalCp)}
          title={`Stockfish eval: ${formatSfPoints(sfTopMoves[0]?.evalCp)}`}
          isFlipped={isFlipped}
          isAnalyzeMode={isAnalyzeMode}
          boardPx={boardPx}
        />
      </div>

      {renderCard(bottomCard)}
    </div>
  );
}
