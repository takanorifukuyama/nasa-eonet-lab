import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  instantiate: vi.fn<() => Promise<void>>(),
  connect: vi.fn<() => Promise<{ close: () => Promise<void> }>>(),
  close: vi.fn<() => Promise<void>>(),
  terminate: vi.fn<() => Promise<void>>()
}));

vi.mock('@duckdb/duckdb-wasm', () => ({
  selectBundle: async () => ({ mainModule: 'test.wasm', mainWorker: 'test.worker.js' }),
  VoidLogger: class {},
  AsyncDuckDB: class {
    instantiate = engine.instantiate;
    connect = engine.connect;
    terminate = engine.terminate;
  }
}));

import { LocalSql } from './duckdb';

const workers: TestWorker[] = [];
class TestWorker extends EventTarget {
  terminate = vi.fn();
  constructor() { super(); workers.push(this); }
}

beforeEach(() => {
  vi.clearAllMocks();
  workers.length = 0;
  engine.instantiate.mockResolvedValue(undefined);
  engine.close.mockResolvedValue(undefined);
  engine.connect.mockResolvedValue({ close: engine.close });
  engine.terminate.mockResolvedValue(undefined);
  vi.stubGlobal('Worker', TestWorker);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('analysis worker recovery', () => {
  it('rejects a failed worker even when the engine leaves initialization pending, then allows retry', async () => {
    engine.instantiate.mockImplementationOnce(() => new Promise(() => {}));
    const client = new LocalSql();
    const initializing = client.init();
    const failed = expect(initializing).rejects.toThrow('Analysis worker stopped');
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0].dispatchEvent(new Event('error'));
    await failed;
    expect(workers[0].terminate).toHaveBeenCalledOnce();

    await client.init();
    expect(workers).toHaveLength(2);
    await client.close();
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });

  it('stops a stalled worker instead of leaving the loading state pending forever', async () => {
    vi.useFakeTimers();
    engine.instantiate.mockImplementationOnce(() => new Promise(() => {}));
    const client = new LocalSql();
    const failed = expect(client.init()).rejects.toThrow('Analysis timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(engine.terminate).toHaveBeenCalledOnce();
  });

  it('releases the worker even when graceful connection shutdown never completes', async () => {
    vi.useFakeTimers();
    const client = new LocalSql();
    await client.init();
    engine.close.mockImplementationOnce(() => new Promise(() => {}));
    const failed = expect(client.close()).rejects.toThrow('Analysis timed out');
    await vi.advanceTimersByTimeAsync(1_000);
    await failed;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(engine.terminate).toHaveBeenCalledOnce();
  });
});
