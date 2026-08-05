'use client';

import React, { useState, useEffect, useRef } from 'react';
import CopyCodeButton from '../../components/CopyCodeButton';

const SECTION_LABELS: Record<string, string> = {
  install: 'Installation',
  quickstart: 'Quickstart',
  'model-card': 'Model card',
  'otter-model': 'OtterModel()',
  'model-predict': 'model.predict()',
  webgpu: 'WebGPU / WASM',
  formats: 'Input / output formats',
};

function SidebarLink({
  id,
  label,
  mono,
  active,
  onNavigate,
}: {
  id: string;
  label: string;
  mono?: boolean;
  active: boolean;
  onNavigate: (id: string) => void;
}) {
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(id);
      }}
      className={`side-link block px-7 py-1.5 text-[13px] border-l-2 transition-all duration-150 ${mono ? 'font-mono' : ''} ${
        active
          ? 'text-pear border-pear bg-panel font-medium'
          : 'border-transparent text-muted hover:text-paper'
      }`}
    >
      {label}
    </a>
  );
}

export default function DocsPage() {
  const [activeDocsSection, setActiveDocsSection] = useState<string>('install');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const docsContentRef = useRef<HTMLDivElement | null>(null);

  const navigateToSection = (id: string) => {
    setActiveDocsSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileNavOpen(false);
  };

  // Track scroll position in Docs to update active sidebar link
  useEffect(() => {
    const container = docsContentRef.current;
    if (!container) return;

    const handleScroll = () => {
      const sections = ['install', 'quickstart', 'model-card', 'otter-model', 'model-predict', 'webgpu', 'formats'];
      let currentSection = 'install';
      const containerTop = container.getBoundingClientRect().top;

      for (const sectionId of sections) {
        const el = document.getElementById(sectionId);
        if (el) {
          const rect = el.getBoundingClientRect();
          // If the section top is close to or above the container viewport top
          if (rect.top - containerTop <= 120) {
            currentSection = sectionId;
          }
        }
      }
      setActiveDocsSection(currentSection);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    // Run initially
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Close the mobile section drawer on Escape
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  return (
    <div className="docs-shell relative flex-grow flex min-h-0 h-[calc(100vh-68px)]">

      {/* Mobile section toggle bar */}
      <div className="lg:hidden absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 h-12 border-b border-line bg-bg">
        <button
          type="button"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-expanded={mobileNavOpen}
          aria-controls="docs-mobile-nav"
          className="font-mono text-[12px] text-muted hover:text-paper flex items-center gap-2 cursor-pointer"
        >
          <span>Sections</span>
          <span className="text-line">/</span>
          <span className="text-pear">{SECTION_LABELS[activeDocsSection]}</span>
          <span className={`inline-block transition-transform duration-150 ${mobileNavOpen ? 'rotate-180' : ''}`}>&#8964;</span>
        </button>
      </div>

      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-x-0 top-[68px] bottom-0 z-20 bg-paper/30"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Left Sidebar Nav */}
      <aside
        id="docs-mobile-nav"
        className={`sidebar w-[240px] shrink-0 border-r border-line py-8 overflow-y-auto bg-bg
          lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-full
          ${mobileNavOpen ? 'flex flex-col fixed left-0 top-[68px] bottom-0 z-30 shadow-lg' : 'hidden'}`}
      >
        <div className="side-group mb-7">
          <div className="side-label font-mono text-[10px] text-pear-dim tracking-[0.1em] px-7 mb-2.5 uppercase">Getting started</div>
          <SidebarLink id="install" label="Installation" active={activeDocsSection === 'install'} onNavigate={navigateToSection} />
          <SidebarLink id="quickstart" label="Quickstart" active={activeDocsSection === 'quickstart'} onNavigate={navigateToSection} />
          <SidebarLink id="model-card" label="Model card" active={activeDocsSection === 'model-card'} onNavigate={navigateToSection} />
        </div>

        <div className="side-group mb-7">
          <div className="side-label font-mono text-[10px] text-pear-dim tracking-[0.1em] px-7 mb-2.5 uppercase">API reference</div>
          <SidebarLink id="otter-model" label="OtterModel()" mono active={activeDocsSection === 'otter-model'} onNavigate={navigateToSection} />
          <SidebarLink id="model-predict" label="model.predict()" mono active={activeDocsSection === 'model-predict'} onNavigate={navigateToSection} />
        </div>

        <div className="side-group mb-7">
          <div className="side-label font-mono text-[10px] text-pear-dim tracking-[0.1em] px-7 mb-2.5 uppercase">Runtime</div>
          <SidebarLink id="webgpu" label="WebGPU / WASM" active={activeDocsSection === 'webgpu'} onNavigate={navigateToSection} />
          <SidebarLink id="formats" label="Input / output formats" active={activeDocsSection === 'formats'} onNavigate={navigateToSection} />
        </div>
      </aside>

      {/* Right Documentation detail */}
      <article ref={docsContentRef} className="flex-grow p-[24px] pt-[68px] sm:p-[56px] sm:pt-[68px] lg:py-[32px] overflow-y-auto h-full space-y-[44px]">

        {/* Installation */}
        <section id="install" className="pt-8">
          <div className="flex items-center gap-2 font-mono text-xs text-pear tracking-[0.06em] mb-4">
            <span className="border border-pear text-pear-deep px-1.5 py-0.5 font-bold uppercase select-none">B1</span>
            <span>Python package</span>
          </div>
          <h1 className="font-space font-medium text-[36px] tracking-tight text-paper mb-2">Docs</h1>
          <p className="text-[16px] text-muted leading-relaxed max-w-[620px] mb-6">
            Otter ships as a pip package. Load it, configure parameters, and query predictions — fully local, no server required.
          </p>
          <div className="relative">
            <pre className="bg-panel border border-line p-[18px] px-[20px] font-mono text-[12.5px] leading-[1.7] text-paper overflow-x-auto">
              <span className="text-muted font-bold"># install</span>{"\n"}
              pip install otter-chess
            </pre>
            <CopyCodeButton />
          </div>
        </section>

        {/* Quickstart */}
        <section id="quickstart" className="pt-4">
          <h2 className="font-space font-medium text-[21px] pb-3 border-b border-line text-paper mb-[14px]">Quickstart</h2>
          <p className="text-[14px] leading-[1.75] text-muted mb-4 max-w-[620px]">
            Initialize the model, pass it a position (FEN), game history list, rating level, time control format, and remaining clock fraction to receive skill-conditioned and time-aware predictions.
          </p>
          <div className="relative">
            <pre className="bg-panel border border-line p-[18px] px-[20px] font-mono text-[12.5px] leading-[1.7] text-paper overflow-x-auto">
              <span className="text-pear">from</span> otter <span className="text-pear">import</span> OtterModel{"\n"}{"\n"}
              <span className="text-muted"># Initializing OtterModel loads the cached model weights automatically</span>{"\n"}
              model = OtterModel(device=<span className="text-pear-deep">"cpu"</span>){"\n"}{"\n"}
              result = model.predict({"\n"}
              &nbsp;&nbsp;&nbsp;&nbsp;fen=<span className="text-pear-deep">"r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"</span>,{"\n"}
              &nbsp;&nbsp;&nbsp;&nbsp;player_elo=<span className="text-pear">1600</span>,          <span className="text-muted"># target active rating bracket</span>{"\n"}
              &nbsp;&nbsp;&nbsp;&nbsp;opponent_elo=<span className="text-pear">1500</span>,        <span className="text-muted"># target opponent rating bracket</span>{"\n"}
              &nbsp;&nbsp;&nbsp;&nbsp;history_moves=[<span className="text-pear-deep">"e2e4"</span>, <span className="text-pear-deep">"e7e5"</span>, <span className="text-pear-deep">"g1f3"</span>, <span className="text-pear-deep">"b8c6"</span>], <span className="text-muted"># preceding moves</span>{"\n"}
              &nbsp;&nbsp;&nbsp;&nbsp;time_control=<span className="text-pear-deep">"600+0"</span>,       <span className="text-muted"># rapid base + increment format</span>{"\n"}
              &nbsp;&nbsp;&nbsp;&nbsp;time_remaining=<span className="text-pear">480</span>         <span className="text-muted"># clock time in seconds (fraction auto-calculated)</span>{"\n"}
              ){"\n"}{"\n"}
              <span className="text-pear">print</span>(result[<span className="text-pear-deep">"win_probability"</span>])   <span className="text-muted"># Win evaluation between -1 and +1</span>{"\n"}
              <span className="text-pear">print</span>(result[<span className="text-pear-deep">"moves"</span>][<span className="text-pear">0</span>][<span className="text-pear-deep">"move"</span>])  <span className="text-muted"># e.g., "f1b5" (Ruy Lopez)</span>
            </pre>
            <CopyCodeButton />
          </div>
        </section>

        {/* Model card */}
        <section id="model-card" className="pt-4">
          <h2 className="font-space font-medium text-[21px] pb-3 border-b border-line text-paper mb-[14px]">Model card</h2>
          <p className="text-[14px] leading-[1.75] text-muted max-w-[620px]">
            Otter is a human chess AI model of 15.3 million parameters trained on 6.1 billion positions from 117 million rapid games on Lichess spanning club to titled play. Rather than optimizing for the strongest move, it's conditioned on a target rating band and predicts the move a player at that level would plausibly make — including known blind spots for that band. Full methodology is in the paper linked on the home page.
          </p>
        </section>

        {/* OtterModel() */}
        <section id="otter-model" className="pt-4">
          <div className="border border-line">
            <div className="flex items-center gap-3 p-[14px] px-[18px] border-b border-line bg-panel">
              <span className="font-mono text-[11px] text-pear border border-pear-dim px-2 py-0.5">CLASS</span>
              <span className="font-mono text-[14px] font-medium text-paper">OtterModel(checkpoint_path=None, device="cpu", history_k=20, download_url=None)</span>
            </div>
            <div className="p-4 px-5">
              <p className="text-[14px] text-muted mb-3">Loads model configuration and initializes checkpoint parameters on the target hardware device.</p>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px] last:border-b-0">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">checkpoint_path</div>
                <div className="font-mono text-muted w-[90px] shrink-0">str | None</div>
                <div className="text-muted">Path to local model weights (<code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">.safetensors</code> or <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">.pt</code>). If <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">None</code>, queries standard cache paths or downloads weights.</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px] last:border-b-0">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">device</div>
                <div className="font-mono text-muted w-[90px] shrink-0">str</div>
                <div className="text-muted">Execution device string, e.g. <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">"cpu"</code> or <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">"cuda"</code> (or other hardware backends).</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px] last:border-b-0">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">history_k</div>
                <div className="font-mono text-muted w-[90px] shrink-0">int</div>
                <div className="text-muted">Length limit of the preceding move history window context (default is 20 moves).</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px] last:border-b-0">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">download_url</div>
                <div className="font-mono text-muted w-[90px] shrink-0">str | None</div>
                <div className="text-muted">Fallback URL used to fetch model weights if they are not stored locally. Defaults to the <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">model.safetensors</code> release on <a href="https://huggingface.co/peargentlabs/otter-chess" target="_blank" rel="noopener noreferrer" className="text-pear-deep underline">Hugging Face</a>.</div>
              </div>
            </div>
          </div>
        </section>

        {/* model.predict() */}
        <section id="model-predict" className="pt-4">
          <div className="border border-line">
            <div className="flex items-center gap-3 p-[14px] px-[18px] border-b border-line bg-panel">
              <span className="font-mono text-[11px] text-pear border border-pear-dim px-2 py-0.5">METHOD</span>
              <span className="font-mono text-[14px] font-medium text-paper">model.predict(fen, player_elo, opponent_elo, history_moves, time_control, clock_fraction, top_k)</span>
            </div>
            <div className="p-4 px-5">
              <p className="text-[14px] text-muted mb-3">Runs the model inference pipeline to output move distributions conditioned on skill and temporal pressure.</p>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px]">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">fen</div>
                <div className="font-mono text-muted w-[90px] shrink-0">str</div>
                <div className="text-muted">FEN representation of the current board state.</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px]">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">player_elo</div>
                <div className="font-mono text-muted w-[90px] shrink-0">int</div>
                <div className="text-muted">Elo rating bucket of the active player (ranges from below 1100 to above 2000).</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px]">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">opponent_elo</div>
                <div className="font-mono text-muted w-[90px] shrink-0">int</div>
                <div className="text-muted">Elo rating bucket of the opponent.</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px]">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">history_moves</div>
                <div className="font-mono text-muted w-[90px] shrink-0">list[str] | None</div>
                <div className="text-muted">List of all prior moves in the game represented as UCI strings (e.g. <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">["e2e4", "e7e5"]</code>).</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px]">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">time_control</div>
                <div className="font-mono text-muted w-[90px] shrink-0">str</div>
                <div className="text-muted">Time control format in base+increment seconds (e.g. <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">"180+2"</code> for Blitz, <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">"600+0"</code> for Rapid).</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px]">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">clock_fraction</div>
                <div className="font-mono text-muted w-[90px] shrink-0">float | None</div>
                <div className="text-muted">Remaining clock time represented as a fraction between <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">0.0</code> and <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">1.0</code>.</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px]">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">time_remaining</div>
                <div className="font-mono text-muted w-[90px] shrink-0">int | None</div>
                <div className="text-muted">Time remaining in seconds. If provided, <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">clock_fraction</code> is calculated automatically using the base time control seconds.</div>
              </div>
              <div className="flex gap-3.5 py-2.5 border-b border-line text-[13px] last:border-b-0">
                <div className="font-mono text-pear-deep w-[140px] shrink-0">top_k</div>
                <div className="font-mono text-muted w-[90px] shrink-0">int</div>
                <div className="text-muted">Number of move suggestions to return (default is 5).</div>
              </div>
              
              <div className="mt-4 border-t border-line/45 pt-4">
                <h4 className="font-mono text-xs font-bold text-paper mb-2 uppercase">Returns</h4>
                <p className="text-[13px] text-muted mb-2">A dictionary containing:</p>
                <ul className="list-disc pl-5 text-[13px] text-muted space-y-1">
                  <li><code className="font-mono bg-panel px-1 py-0.5 border border-line text-xs">"fen"</code>: The board FEN string analyzed.</li>
                  <li><code className="font-mono bg-panel px-1 py-0.5 border border-line text-xs">"win_probability"</code>: The model's evaluation of the position between <code className="font-mono text-pear-deep font-semibold">-1.0</code> (losing) and <code className="font-mono text-pear font-semibold">+1.0</code> (winning).</li>
                  <li><code className="font-mono bg-panel px-1 py-0.5 border border-line text-xs">"moves"</code>: A list of predicted UCI moves and probabilities sorted from most likely to least likely.</li>
                  <li><code className="font-mono bg-panel px-1 py-0.5 border border-line text-xs">"aux_predictions"</code>: Decoded properties from the auxiliary head (moving piece, captured piece, checks probability, from/to squares, and confidences).</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* WebGPU / WASM runtime */}
        <section id="webgpu" className="pt-4">
          <h2 className="font-space font-medium text-[21px] pb-3 border-b border-line text-paper mb-[14px]">WebGPU / WASM runtime</h2>
          <p className="text-[14px] leading-[1.75] text-muted mb-4 max-w-[620px]">
            For browser-based or client-side JavaScript applications, you can execute the exported ONNX model directly on the client using <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-[12.5px] text-pear-deep">onnxruntime-web</code>. This allows for fully local execution using WebGPU (or WebAssembly as a fallback) without sending game positions to a server.
          </p>
          <p className="text-[14px] leading-[1.75] text-muted mb-4 max-w-[620px]">
            To load and run the model in your JavaScript code:
          </p>
          <div className="relative">
            <pre className="bg-panel border border-line p-[18px] px-[20px] font-mono text-[12.5px] leading-[1.7] text-paper overflow-x-auto">
              <span className="text-pear">import</span> * <span className="text-pear">as</span> ort <span className="text-pear">from</span> <span className="text-pear-deep">'onnxruntime-web'</span>;{"\n"}{"\n"}
              <span className="text-muted">// Create an inference session with WebGPU acceleration</span>{"\n"}
              <span className="text-pear">const</span> session = <span className="text-pear">await</span> ort.InferenceSession.create(<span className="text-pear-deep">'/path/to/policy_model.onnx'</span>, {"{"}{"\n"}
              &nbsp;&nbsp;executionProviders: [<span className="text-pear-deep">'webgpu'</span>, <span className="text-pear-deep">'wasm'</span>]{"\n"}
              {"}"});{"\n"}{"\n"}
              <span className="text-muted">// Feed active elo, opponent elo, board state, move history, etc.</span>{"\n"}
              <span className="text-pear">const</span> feeds = {"{"}{"\n"}
              &nbsp;&nbsp;board: <span className="text-pear">new</span> ort.Tensor(<span className="text-pear-deep">'float32'</span>, boardData, [1, 18, 8, 8]),{"\n"}
              &nbsp;&nbsp;history_ids: <span className="text-pear">new</span> ort.Tensor(<span className="text-pear-deep">'int64'</span>, historyIds, [1, 20]),{"\n"}
              &nbsp;&nbsp;active_elo: <span className="text-pear">new</span> ort.Tensor(<span className="text-pear-deep">'int64'</span>, [activeEloBucket], [1]),{"\n"}
              &nbsp;&nbsp;<span className="text-muted">... // and other required inputs</span>{"\n"}
              {"}"};{"\n"}{"\n"}
              <span className="text-pear">const</span> results = <span className="text-pear">await</span> session.run(feeds);
            </pre>
            <CopyCodeButton />
          </div>
        </section>

        {/* Input / output formats */}
        <section id="formats" className="pt-4 pb-12">
          <h2 className="font-space font-medium text-[21px] pb-3 border-b border-line text-paper mb-[14px]">Input / output formats</h2>
          <p className="text-[14px] leading-[1.75] text-muted max-w-[620px]">
            Positions in, moves out — <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-[12.5px] text-pear-deep">FEN</code> for board state, <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-[12.5px] text-pear-deep">UCI</code> for moves (e.g. <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">e2e4</code>, <code className="font-mono bg-panel border border-line px-1.5 py-0.5 text-xs text-pear-deep">e7e8q</code> for promotion). Both APIs also accept and return PGN move lists if you'd rather work with full game history.
          </p>
        </section>

      </article>
    </div>
  );
}
