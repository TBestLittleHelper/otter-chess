'use client';

import { useState } from 'react';

export default function CopyCodeButton() {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent<HTMLButtonElement>) => {
    const pre = e.currentTarget.parentElement?.querySelector('pre');
    if (!pre?.textContent) return;
    navigator.clipboard.writeText(pre.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
      className="absolute top-2.5 right-2.5 font-mono text-[10.5px] tracking-[0.03em] uppercase text-muted hover:text-paper border border-line hover:border-pear-dim bg-bg/90 px-2 py-1 transition-colors duration-150 cursor-pointer"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
