import type { XtreamApi } from '../preload/preload';

declare global {
  interface Window {
    xtream: XtreamApi;
  }
  // Chromium: route Web Audio to a specific output; optional in lib.dom.
  interface AudioContext {
    setSinkId?: (sinkId: string) => Promise<void>;
  }
}

export {};
