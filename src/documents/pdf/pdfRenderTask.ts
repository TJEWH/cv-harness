// DOM measurement cannot run in a Web Worker. Give input/paint a turn between
// short rendering batches instead of draining the entire renderer as microtasks.
function backgroundTurn(signal?: AbortSignal) {
  if (globalThis.scheduler?.postTask) {
    return globalThis.scheduler.postTask(() => {}, { priority: 'background', signal });
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function createPdfRenderTask(signal?: AbortSignal, { now = () => performance.now(), yieldTurn = backgroundTurn, budget = 6 } = {}) {
  const resources = new Set<{ remove(): void }>();
  let lastYield = now();
  let disposed = false;
  const check = () => signal?.throwIfAborted();
  const dispose = () => {
    disposed = true;
    for (const node of resources) node.remove();
    resources.clear();
    signal?.removeEventListener('abort', dispose);
  };
  signal?.addEventListener('abort', dispose, { once: true });

  return {
    check,
    // Return nothing within the batch budget to avoid creating a Promise per node.
    checkpoint(force = false) {
      check();
      if (!force && now() - lastYield < budget) return;
      return yieldTurn(signal).then(() => {
        check();
        lastYield = now();
      });
    },
    own<T extends { remove(): void }>(node: T) {
      if (disposed || signal?.aborted) node.remove();
      else resources.add(node);
      return node;
    },
    // Font/image loading can otherwise keep a canceled render waiting forever.
    wait<T>(promise: T | PromiseLike<T>): Promise<T> {
      check();
      if (!signal) return Promise.resolve(promise);
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
    },
    dispose,
  };
}

// Give each preview surface a slot to cancel its in-flight render on invalidation.
export function createPreviewRenderSlot() {
  let controller: AbortController | undefined;
  return {
    cancel() {
      controller?.abort();
      controller = undefined;
    },
    start() {
      controller?.abort();
      controller = new AbortController();
      return controller.signal;
    },
  };
}
