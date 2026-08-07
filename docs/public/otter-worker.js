// Dedicated worker for all of Otter's ONNX inference. Runs the model's
// session.run() calls on their own thread so the main thread — chessground
// drag/drop, React rendering — never blocks on wasm execution, no matter
// how much analysis (live prediction + the "Moves by Rating" sweep) is
// queued up behind it. Board interaction is intentionally decoupled from
// how fast this worker can keep up; if the player moves faster than the
// model can answer, stale requests are simply dropped, not waited on.

importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js');

let session = null;

// model_fp16.onnx has its floating-point inputs/outputs (board, clock,
// policy_logits, aux_logits, value_pred) declared as float16 in the graph
// itself — session.run() rejects float32 feeds for them with "Unexpected
// input data type". onnxruntime-web accepts a plain Uint16Array of raw
// fp16 bit patterns for a 'float16' tensor on every browser (it
// reinterprets the buffer as Float16Array under the hood when the native
// type is available), so encoding/decoding by hand here works regardless
// of whether the browser ships a native Float16Array.
const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

function float32ToFloat16Bits(value) {
  f32Scratch[0] = value;
  const x = u32Scratch[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;

  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf/NaN

  const newExp = exp - 127 + 15;
  if (newExp >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (newExp <= 0) {
    if (newExp < -10) return sign; // underflow -> signed zero
    mant |= 0x800000; // implicit leading 1
    const shift = 14 - newExp;
    let bits = mant >>> shift;
    if ((mant >>> (shift - 1)) & 1) bits += 1; // round to nearest
    return sign | bits;
  }
  let bits = (newExp << 10) | (mant >>> 13);
  if (mant & 0x1000) bits += 1; // round to nearest
  return sign | bits;
}

function encodeFloat16(float32Data) {
  const out = new Uint16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) out[i] = float32ToFloat16Bits(float32Data[i]);
  return out;
}

function float16BitsToFloat32(h) {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h & 0x7c00) >>> 10;
  const mant = h & 0x03ff;
  if (exp === 0) return sign * mant * Math.pow(2, -24); // subnormal / zero
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * Math.pow(2, exp - 15);
}

function decodeFloat16(data) {
  // `data` is a native Float16Array (already decoded numbers) when the
  // browser supports it, otherwise a Uint16Array of raw bit patterns.
  if (typeof globalThis.Float16Array !== 'undefined' && data instanceof globalThis.Float16Array) {
    return Float32Array.from(data);
  }
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = float16BitsToFloat32(data[i]);
  return out;
}

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
    board: new ort.Tensor('float16', encodeFloat16(board), [1, 18, 8, 8]),
    history_ids: new ort.Tensor('int64', historyIds, [1, 20]),
    history_mask: new ort.Tensor('bool', historyMask, [1, 20]),
    active_elo: new ort.Tensor('int64', BigInt64Array.from([BigInt(activeElo)]), [1]),
    opponent_elo: new ort.Tensor('int64', BigInt64Array.from([BigInt(opponentElo)]), [1]),
    tc: new ort.Tensor('int64', BigInt64Array.from([BigInt(tc)]), [1]),
    clock: new ort.Tensor('float16', encodeFloat16(Float32Array.from(clock)), [1, 2]),
  };

  const results = await session.run(feeds);
  const policyLogits = decodeFloat16(results.policy_logits.data);

  if (!wantAux) {
    return { policyLogits, transfer: [policyLogits.buffer] };
  }

  const auxLogits = decodeFloat16(results.aux_logits.data);
  const valuePred = decodeFloat16(results.value_pred.data)[0];
  return { policyLogits, auxLogits, valuePred, transfer: [policyLogits.buffer, auxLogits.buffer] };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
      const sessionOptions = {
        executionProviders: msg.provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
        // 'extended' and up run a fp16 precision-free-cast insertion pass
        // that crashes session creation on this model's fused
        // SimplifiedLayerNorm nodes ("GetIndexFromName ... node_args.end()").
        // 'basic' still does cheap, safe optimizations (constant folding,
        // redundant node elimination) without that fusion pass — going all
        // the way to 'disabled' leaves the transformer's many small ops
        // completely unfused, which made a single inference take 45s+.
        graphOptimizationLevel: 'basic',
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
