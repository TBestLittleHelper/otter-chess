// Dedicated worker for all of Otter's ONNX inference. Runs the model's
// session.run() calls on their own thread so the main thread — chessground
// drag/drop, React rendering — never blocks on wasm execution, no matter
// how much analysis (live prediction + the "Moves by Rating" sweep) is
// queued up behind it. Board interaction is intentionally decoupled from
// how fast this worker can keep up; if the player moves faster than the
// model can answer, stale requests are simply dropped, not waited on.

importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js');

let session = null;

// At most one 'live' (per-move prediction) request and one 'sweep'
// (rating-curve bucket) request are ever queued at a time — both callers
// on the main thread already await each of their own calls sequentially
// before issuing the next, so there is nothing to coalesce beyond that.
// A newly-arrived 'live' request supersedes any queued-but-not-yet-started
// 'live' request and jumps ahead of a queued 'sweep' request, since the
// live per-move panel should feel snappier than the background sweep —
// but it can't preempt a run already executing in wasm.
const queue = [];
let processing = false;

function enqueue(job) {
  if (job.priority === 'live') {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].priority === 'live') {
        // Every request must get a response — the main thread's Promise
        // for it is still pending. Dropping it silently here left that
        // Promise (and anything awaiting it, e.g. Otter's own move loop)
        // hanging forever instead of resolving/rejecting.
        postMessage({ type: 'run', id: queue[i].id, error: 'superseded' });
        queue.splice(i, 1);
      }
    }
    const firstSweepIdx = queue.findIndex((j) => j.priority === 'sweep');
    if (firstSweepIdx === -1) queue.push(job);
    else queue.splice(firstSweepIdx, 0, job);
  } else {
    queue.push(job);
  }
  processQueue();
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      const out = await runInference(job);
      postMessage({ type: 'run', id: job.id, ...out }, out.transfer || []);
    } catch (err) {
      postMessage({ type: 'run', id: job.id, error: String(err && err.message || err) });
    }
  }
  processing = false;
}

async function runInference(job) {
  const { board, historyIds, historyMask, activeElo, opponentElo, tc, clock, wantAux } = job;

  const feeds = {
    board: new ort.Tensor('float32', board, [1, 18, 8, 8]),
    history_ids: new ort.Tensor('int64', historyIds, [1, 20]),
    history_mask: new ort.Tensor('bool', historyMask, [1, 20]),
    active_elo: new ort.Tensor('int64', BigInt64Array.from([BigInt(activeElo)]), [1]),
    opponent_elo: new ort.Tensor('int64', BigInt64Array.from([BigInt(opponentElo)]), [1]),
    tc: new ort.Tensor('int64', BigInt64Array.from([BigInt(tc)]), [1]),
    clock: new ort.Tensor('float32', Float32Array.from(clock), [1, 2]),
  };

  const results = await session.run(feeds);
  const policyLogits = Float32Array.from(results.policy_logits.data);

  if (!wantAux) {
    return { policyLogits, transfer: [policyLogits.buffer] };
  }

  const auxLogits = Float32Array.from(results.aux_logits.data);
  const valuePred = results.value_pred.data[0];
  return { policyLogits, auxLogits, valuePred, transfer: [policyLogits.buffer, auxLogits.buffer] };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
      const sessionOptions = {
        executionProviders: msg.provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
      };
      session = await ort.InferenceSession.create(msg.modelBuffer, sessionOptions);
      postMessage({ type: 'init', ok: true });
    } catch (err) {
      postMessage({ type: 'init', ok: false, error: String(err && err.message || err) });
    }
    return;
  }

  if (msg.type === 'run') {
    if (!session) {
      postMessage({ type: 'run', id: msg.id, error: 'Session not initialized' });
      return;
    }
    enqueue(msg);
  }
};
