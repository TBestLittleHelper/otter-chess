'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Header() {
  const pathname = usePathname();
  const activeTab = pathname === '/docs' ? 'docs' : pathname === '/play' ? 'play' : 'home';

  return (
    <header className={`sticky top-0 z-40 bg-bg flex items-center justify-between transition-all duration-200 shrink-0 ${
      activeTab === 'home' 
        ? 'px-14 py-7' 
        : 'px-8 h-[68px] border-b border-line'
    }`}>
      <div className="flex items-center gap-[9px]">
        <div className={`${activeTab === 'home' ? 'w-[9px] h-[9px]' : 'w-[10px] h-[10px]'} bg-pear`} />
        <Link 
          href="/"
          className={`font-space font-medium tracking-tight text-paper hover:text-pear transition-all duration-150 ${
            activeTab === 'home' ? 'text-[17px]' : 'text-[19px]'
          }`}
        >
          Otter
        </Link>
        <span className={`font-mono text-[11px] text-muted tracking-[0.05em] border-l border-line ${
          activeTab === 'home' ? 'ml-2 pl-3' : 'ml-1.5 pl-2.5'
        }`}>
          PeargentLabs
        </span>
      </div>
      
      {/* Navigation Links */}
      <div className="flex items-center gap-[36px]">
        <Link
          href="/"
          className={`font-mono text-[13px] tracking-[0.01em] transition-all duration-150 ${
            activeTab === 'home' ? 'text-paper font-medium' : 'text-muted hover:text-paper'
          }`}
        >
          Home
        </Link>
        
        <Link
          href="/docs"
          className={`font-mono text-[13px] tracking-[0.01em] transition-all duration-150 ${
            activeTab === 'docs' ? 'text-paper font-medium' : 'text-muted hover:text-paper'
          }`}
        >
          Docs
        </Link>

        {activeTab === 'play' ? (
          <Link
            href="/play"
            className="font-mono text-[13px] tracking-[0.01em] text-pear font-medium"
          >
            Play
          </Link>
        ) : activeTab === 'docs' ? (
          <Link
            href="/play"
            className="font-mono text-[13px] tracking-[0.01em] border border-pear-dim text-pear px-4 py-1.5 hover:bg-panel hover:border-pear transition-all duration-150 flex items-center gap-1.5"
          >
            Play &rarr;
          </Link>
        ) : (
          <Link
            href="/play"
            className="font-mono text-[13px] tracking-[0.01em] text-pear hover:text-pear-deep transition-all duration-150 flex items-center gap-1.5"
          >
            Play &rarr;
          </Link>
        )}
      </div>
    </header>
  );
}
