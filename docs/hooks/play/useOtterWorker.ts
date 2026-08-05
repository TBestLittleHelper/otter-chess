'use client';

import { useRef, useState } from 'react';
import { withBasePath } from '@/lib/site';

// Owns the dedicated Otter inference worker (see public/otter-worker.js) —
// spawning it, handing it the cached model, and the request/response
// plumbing (callOtterWorker) that every ONNX call goes through. All
// session.run() calls happen on that worker's own thread, so wasm
// execution never blocks the main thread — the board stays interactive no
// matter how much analysis is queued behind it.
//
// The actual "what to send, how to interpret the result" logic
// (runModelInference / runModelInferenceAtElo) stays in page.tsx rather
// than living here — it reads from game state, Analyze-mode rating
// sliders, match config, etc. from across the whole page, and forcing it
// into this hook would just mean threading the same dozen-plus values
// through as parameters instead of closing over them directly.
export function useOtterWorker(deps: {
  provider: 'webgpu' | 'wasm';
  initStockfishWorker: () => Promise<void>;
}) {
  const { provider, initStockfishWorker } = deps;

  const otterWorkerRef = useRef<Worker | null>(null);
  const otterReqIdRef = useRef(0);
  const otterPendingRef = useRef<Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>>(new Map());
  const policyMoveToIdRef = useRef<Record<string, number>>({});
  const idToMoveRef = useRef<Record<number, string>>({});
  const historyMoveToIdRef = useRef<Record<string, number>>({});
  const [modelLoaded, setModelLoaded] = useState<boolean>(false);

  // Post one inference request to the Otter worker and resolve when its
  // matching response comes back. 'live' requests jump ahead of any queued
  // 'sweep' request on the worker side (see public/otter-worker.js) — the
  // per-move panel should never wait behind the rating-curve sweep.
  const callOtterWorker = (
    priority: 'live' | 'sweep',
    tensors: {
      board: Float32Array; historyIds: BigInt64Array; historyMask: Uint8Array;
      activeElo: number; opponentElo: number; tc: number; clock: number[];
    },
    wantAux: boolean
  ): Promise<{ policyLogits: Float32Array; auxLogits?: Float32Array; valuePred?: number }> => {
    const worker = otterWorkerRef.current;
    if (!worker) return Promise.reject(new Error('Otter worker not ready'));
    const id = ++otterReqIdRef.current;
    return new Promise((resolve, reject) => {
      otterPendingRef.current.set(id, { resolve, reject });
      worker.postMessage({
        type: 'run',
        id,
        priority,
        wantAux,
        board: tensors.board,
        historyIds: tensors.historyIds,
        historyMask: tensors.historyMask,
        activeElo: tensors.activeElo,
        opponentElo: tensors.opponentElo,
        tc: tensors.tc,
        clock: tensors.clock,
      }, [tensors.board.buffer, tensors.historyIds.buffer, tensors.historyMask.buffer]);
    });
  };

  // Background Cache Loader — fetches the vocab files + cached model,
  // spins up the worker, and hands it the model. Stockfish is a fully
  // independent engine, initialized regardless of whether Otter's ONNX
  // session above succeeded, so a broken/corrupt Otter model download
  // can't also take down engine analysis.
  const loadAndInitModelFromCache = async () => {
    try {
      // 1. Fetch vocab files
      const v1 = await fetch(withBasePath('/vocab/policy_move_to_id.json')).then(r => r.json());
      const v2 = await fetch(withBasePath('/vocab/history_move_to_id.json')).then(r => r.json());
      policyMoveToIdRef.current = v1;
      historyMoveToIdRef.current = v2;

      const rev: Record<number, string> = {};
      Object.entries(v1).forEach(([k, v]) => {
        rev[v as number] = k;
      });
      idToMoveRef.current = rev;

      // 2. Fetch cached model
      const cache = await caches.open('otter-model-cache');
      const response = await cache.match('/policy_model.onnx');
      if (!response) return;

      const modelBuffer = await response.arrayBuffer();

      // 3. Spin up the inference worker and hand it the model. All
      // session.run() calls happen on this worker's thread from now on —
      // see public/otter-worker.js and callOtterWorker() above.
      otterWorkerRef.current?.terminate();
      const worker = new Worker(withBasePath('/otter-worker.js'));
      otterWorkerRef.current = worker;

      worker.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.type !== 'run') return;
        const pending = otterPendingRef.current.get(msg.id);
        if (!pending) return;
        otterPendingRef.current.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg);
      };

      await new Promise<void>((resolve, reject) => {
        const onInit = (ev: MessageEvent) => {
          if (ev.data?.type !== 'init') return;
          worker.removeEventListener('message', onInit);
          if (ev.data.ok) resolve();
          else reject(new Error(ev.data.error || 'Otter worker init failed'));
        };
        worker.addEventListener('message', onInit);
        worker.postMessage({ type: 'init', modelBuffer, provider }, [modelBuffer]);
      });

      setModelLoaded(true);
    } catch (err) {
      console.error("Otter model init failed:", err);
    }

    await initStockfishWorker();
  };

  return {
    otterWorkerRef,
    policyMoveToIdRef,
    idToMoveRef,
    historyMoveToIdRef,
    modelLoaded,
    setModelLoaded,
    callOtterWorker,
    loadAndInitModelFromCache,
  };
}
