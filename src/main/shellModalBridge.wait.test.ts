import { describe, expect, it, vi, afterEach } from 'vitest';
import type { WebContents } from 'electron';
import { waitForWebContentsInteractive } from './shellModalBridge';

describe('waitForWebContentsInteractive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ready immediately when not loading', async () => {
    const wc = {
      isDestroyed: () => false,
      isLoading: () => false,
      once: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as WebContents;

    await expect(waitForWebContentsInteractive(wc, 1000)).resolves.toBe('ready');
    expect(wc.once).not.toHaveBeenCalled();
  });

  it('returns ready when did-finish-load fires before timeout', async () => {
    vi.useFakeTimers();
    let loadHandler: (() => void) | undefined;
    const wc = {
      isDestroyed: () => false,
      isLoading: () => true,
      once: vi.fn((_event: string, cb: () => void) => {
        loadHandler = cb;
      }),
      removeListener: vi.fn(),
    } as unknown as WebContents;

    const p = waitForWebContentsInteractive(wc, 5000);
    expect(wc.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    loadHandler!();
    vi.advanceTimersByTime(10_000);
    await expect(p).resolves.toBe('ready');
    expect(wc.removeListener).toHaveBeenCalledWith('did-finish-load', loadHandler);
  });

  it('returns timeout, clears listener, when load never finishes', async () => {
    vi.useFakeTimers();
    let didFinishHandler: (() => void) | undefined;
    const wc = {
      isDestroyed: () => false,
      isLoading: () => true,
      once: vi.fn((_event: string, cb: () => void) => {
        didFinishHandler = cb;
      }),
      removeListener: vi.fn(),
    } as unknown as WebContents;

    const p = waitForWebContentsInteractive(wc, 500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBe('timeout');
    expect(wc.removeListener).toHaveBeenCalledWith('did-finish-load', didFinishHandler);
  });
});
