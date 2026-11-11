import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { fetchEvents, MAX_EVENTS } from './api';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const options = { days: 90, status: 'all' as const };
const feed = { events: [{ id: 'EONET_1' }] };

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(feed), { status: 200 })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchEvents', () => {
  it('requests the fixed public endpoint with the selected filters in a browser', async () => {
    await expect(fetchEvents(options)).resolves.toEqual(feed);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(`https://eonet.gsfc.nasa.gov/api/v3/events?days=90&status=all&limit=${MAX_EVENTS}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps desktop requests on the Rust bridge', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(feed);
    await expect(fetchEvents(options)).resolves.toEqual(feed);
    expect(invoke).toHaveBeenCalledWith('fetch_eonet', { ...options, limit: MAX_EVENTS });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not expose implementation details from desktop errors', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue('Rust reqwest internal detail');
    await expect(fetchEvents(options)).rejects.toMatchObject({ reason: 'network', message: expect.not.stringMatching(/Rust|reqwest/) });
  });

  it.each([{}, { events: null }, { events: 'wrong' }])('rejects invalid response shapes: %j', async value => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(value), { status: 200 }));
    await expect(fetchEvents(options)).rejects.toMatchObject({ reason: 'invalid-response' });
  });

  it('distinguishes an unreadable response from a failed connection', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('not json', { status: 200 }));
    await expect(fetchEvents(options)).rejects.toMatchObject({ reason: 'invalid-response' });
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 503 }));
    await expect(fetchEvents(options)).rejects.toMatchObject({ reason: 'network' });
  });

  it('cancels a browser request and returns AbortError', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const request = fetchEvents(options, controller.signal);
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('ignores the eventual result of an aborted native request', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(() => new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const request = fetchEvents(options, controller.signal);
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    resolve(feed);
  });

  it('returns a useful timeout instead of leaving the UI loading forever', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const assertion = expect(fetchEvents(options)).rejects.toMatchObject({ reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects invalid filters and pre-aborted requests without contacting the feed', async () => {
    await expect(fetchEvents({ days: 0, status: 'all' })).rejects.toMatchObject({ reason: 'invalid-request' });
    await expect(fetchEvents({ ...options, limit: 701 })).rejects.toMatchObject({ reason: 'invalid-request' });
    await expect(fetchEvents(options, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
