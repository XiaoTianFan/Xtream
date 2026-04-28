import type { ControlProjectUiStateV1 } from '../shared/types';
import type { XtreamApi } from '../preload/preload';

declare global {
  interface Window {
    xtream: XtreamApi;
    __xtreamGetControlUiSnapshot?: () => ControlProjectUiStateV1 | null;
  }
  // Chromium: route Web Audio to a specific output; optional in lib.dom.
  interface AudioContext {
    setSinkId?: (sinkId: string) => Promise<void>;
  }
}

export {};
