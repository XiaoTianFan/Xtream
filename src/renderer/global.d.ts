import type { XtreamApi } from '../preload/preload';

declare global {
  interface Window {
    xtream: XtreamApi;
  }
}

export {};
