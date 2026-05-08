/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import type { DirectorState, PersistedSceneConfig, PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';
import { writeMediaPoolDragPayload } from '../patch/mediaPool/dragDrop';
import { createStreamListMode, type StreamListModeContext } from './listMode';

vi.mock('../shell/shellModalPresenter', () => ({
  shellShowConfirm: vi.fn(() => Promise.resolve(true)),
}));

function createDataTransferStub(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer;
}

function createDragEvent(type: string, dataTransfer: DataTransfer, init: { clientY?: number } = {}): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'relatedTarget', { value: null });
  if (init.clientY !== undefined) {
    Object.defineProperty(event, 'clientY', { value: init.clientY });
  }
  return event;
}

function scene(id: string, title: string): PersistedSceneConfig {
  return {
    id,
    title,
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder: [],
    subCues: {},
  };
}

function stream(): PersistedStreamConfig {
  const a = scene('scene-a', 'Scene A');
  const b = scene('scene-b', 'Scene B');
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: [a.id, b.id],
    scenes: { [a.id]: a, [b.id]: b },
  };
}

function ctx(overrides: Partial<StreamListModeContext> = {}): StreamListModeContext {
  return {
    streamState: { runtime: null, playbackTimeline: undefined } as unknown as StreamEnginePublicState,
    playbackFocusSceneId: undefined,
    sceneEditSceneId: undefined,
    getListDragSceneId: () => undefined,
    expandedListSceneIds: new Set(),
    currentState: { visuals: {}, audioSources: {}, displays: {}, outputs: {} } as unknown as DirectorState,
    setSceneEditFocus: vi.fn(),
    setPlaybackAndEditFocus: vi.fn(),
    setBottomTab: vi.fn(),
    clearDetailPane: vi.fn(),
    setListDragSceneId: vi.fn(),
    toggleExpandedScene: vi.fn(),
    applySceneReorder: vi.fn(),
    addMediaPoolItemToScene: vi.fn(),
    requestRender: vi.fn(),
    refreshSceneSelectionUi: vi.fn(),
    ...overrides,
  };
}

describe('createStreamListMode media drops', () => {
  it('routes media-pool drops to the scene callback without showing reorder intent', () => {
    const addMediaPoolItemToScene = vi.fn();
    const root = createStreamListMode(stream(), ctx({ addMediaPoolItemToScene }));
    const rowWrap = root.querySelector<HTMLElement>('.stream-scene-row-wrap[data-scene-id="scene-a"]')!;
    const dataTransfer = createDataTransferStub();
    writeMediaPoolDragPayload(dataTransfer, { type: 'audio-source', id: 'audio-a' });

    rowWrap.dispatchEvent(createDragEvent('dragover', dataTransfer, { clientY: -1 }));

    expect(dataTransfer.dropEffect).toBe('copy');
    expect(rowWrap.classList.contains('media-drop-over')).toBe(true);
    expect(root.querySelector<HTMLElement>('.stream-scene-drop-indicator')?.hidden).toBe(true);

    rowWrap.dispatchEvent(createDragEvent('drop', dataTransfer));

    expect(addMediaPoolItemToScene).toHaveBeenCalledWith('scene-a', { type: 'audio-source', id: 'audio-a' });
    expect(rowWrap.classList.contains('media-drop-over')).toBe(false);
  });

  it('keeps scene reorder drops on non-media drags', () => {
    const applySceneReorder = vi.fn();
    const root = createStreamListMode(
      stream(),
      ctx({
        getListDragSceneId: () => 'scene-b',
        applySceneReorder,
      }),
    );
    const rowWrap = root.querySelector<HTMLElement>('.stream-scene-row-wrap[data-scene-id="scene-a"]')!;
    const dataTransfer = createDataTransferStub();
    dataTransfer.setData('text/plain', 'scene-b');

    rowWrap.dispatchEvent(createDragEvent('dragover', dataTransfer));
    rowWrap.dispatchEvent(createDragEvent('drop', dataTransfer));

    expect(dataTransfer.dropEffect).toBe('move');
    expect(applySceneReorder).toHaveBeenCalledWith('scene-b', expect.any(String));
  });
});
