/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, DisplayWindowState, VisualLayoutProfile } from '../../../shared/types';
import { writeMediaPoolDragPayload } from './mediaPool/dragDrop';

vi.mock('../shell/shellModalPresenter', () => ({
  shellShowConfirm: vi.fn(),
}));

import { createDisplayWorkspaceController } from './displayWorkspace';

function createDataTransferStub(): DataTransfer {
  const store = new Map<string, string>();
  return {
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

function createDragEvent(type: string, dataTransfer: DataTransfer, init: { clientX?: number; clientY?: number } = {}): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'relatedTarget', { value: null });
  Object.defineProperty(event, 'clientX', { value: init.clientX ?? 0 });
  Object.defineProperty(event, 'clientY', { value: init.clientY ?? 0 });
  return event;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function display(layout: VisualLayoutProfile): DisplayWindowState {
  return {
    id: 'd1',
    label: 'Display 1',
    layout,
    fullscreen: false,
    health: 'ready',
  };
}

function stateWithDisplay(layout: VisualLayoutProfile): DirectorState {
  return {
    paused: true,
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    rate: 1,
    loop: { enabled: false, startSeconds: 0 },
    performanceMode: false,
    controlDisplayPreviewMaxFps: 15,
    globalDisplayBlackout: false,
    globalDisplayBlackoutFadeOutSeconds: 1,
    visuals: {
      'visual-1': {
        id: 'visual-1',
        kind: 'file',
        type: 'image',
        label: 'Logo',
        url: 'file://logo.png',
        ready: true,
      },
      'visual-2': {
        id: 'visual-2',
        kind: 'file',
        type: 'image',
        label: 'Loop',
        url: 'file://loop.png',
        ready: true,
      },
      'raw-left': {
        id: 'raw-left',
        kind: 'file',
        type: 'image',
        label: 'Raw Left',
        url: 'file://raw-left.png',
        ready: true,
      },
      'projection-left': {
        id: 'projection-left',
        kind: 'file',
        type: 'image',
        label: 'Projected Left',
        url: 'file://projection-left.png',
        ready: true,
      },
    },
    audioSources: {
      'audio-1': {
        id: 'audio-1',
        type: 'external-file',
        label: 'Kick Loop',
        ready: true,
      },
    },
    outputs: {},
    displays: {
      d1: display(layout),
    },
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
  } as unknown as DirectorState;
}

function installXtream(rawState: DirectorState) {
  const update = vi.fn(async (displayId: string, update: { layout?: VisualLayoutProfile }) => {
    const target = rawState.displays[displayId];
    if (target && update.layout) {
      target.layout = update.layout;
    }
    return target;
  });
  (window as unknown as { xtream: unknown }).xtream = {
    director: {
      getState: vi.fn(async () => rawState),
    },
    displays: {
      update,
    },
  };
  return { update };
}

function renderWorkspace(rawState: DirectorState, renderedDisplays = Object.values(rawState.displays)) {
  const displayList = document.createElement('div');
  const renderState = vi.fn();
  const setShowStatus = vi.fn();
  const controller = createDisplayWorkspaceController({ displayList }, {
    getState: () => rawState,
    isSelected: () => false,
    selectEntity: vi.fn(),
    clearSelectionIf: vi.fn(),
    renderState,
    setShowStatus,
  });
  controller.render(renderedDisplays);
  document.body.append(displayList);
  return { displayList, renderState, setShowStatus };
}

async function dropPayloadOnPane(pane: HTMLElement, payload: { type: 'visual' | 'audio-source'; id: string }): Promise<void> {
  const dataTransfer = createDataTransferStub();
  writeMediaPoolDragPayload(dataTransfer, payload);
  pane.dispatchEvent(createDragEvent('drop', dataTransfer));
  await flushPromises();
}

async function dropPayloadOnTarget(
  target: HTMLElement,
  payload: { type: 'visual' | 'audio-source'; id: string },
  init: { clientX?: number; clientY?: number } = {},
): Promise<void> {
  const dataTransfer = createDataTransferStub();
  writeMediaPoolDragPayload(dataTransfer, payload);
  target.dispatchEvent(createDragEvent('drop', dataTransfer, init));
  await flushPromises();
}

describe('display workspace media drops', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('assigns visual drops to empty single displays', async () => {
    const rawState = stateWithDisplay({ type: 'single' });
    const { update } = installXtream(rawState);
    const { displayList, renderState } = renderWorkspace(rawState);

    await dropPayloadOnPane(displayList.querySelector<HTMLElement>('[data-display-zone="single"]')!, { type: 'visual', id: 'visual-1' });

    expect(update).toHaveBeenCalledWith('d1', { layout: { type: 'single', visualId: 'visual-1' } });
    expect(rawState.displays.d1.layout).toEqual({ type: 'single', visualId: 'visual-1' });
    expect(renderState).toHaveBeenCalledWith(rawState);
  });

  it('replaces assigned single display visuals', async () => {
    const rawState = stateWithDisplay({ type: 'single', visualId: 'visual-1' });
    const { update } = installXtream(rawState);
    const { displayList } = renderWorkspace(rawState);

    await dropPayloadOnPane(displayList.querySelector<HTMLElement>('[data-display-zone="single"]')!, { type: 'visual', id: 'visual-2' });

    expect(update).toHaveBeenCalledWith('d1', { layout: { type: 'single', visualId: 'visual-2' } });
  });

  it('updates only the dropped split side', async () => {
    const rawState = stateWithDisplay({ type: 'split', visualIds: ['visual-1', 'visual-2'] });
    const { update } = installXtream(rawState);
    const { displayList } = renderWorkspace(rawState);

    await dropPayloadOnPane(displayList.querySelector<HTMLElement>('[data-display-zone="L"]')!, { type: 'visual', id: 'raw-left' });
    expect(update).toHaveBeenLastCalledWith('d1', { layout: { type: 'split', visualIds: ['raw-left', 'visual-2'] } });

    await dropPayloadOnPane(displayList.querySelector<HTMLElement>('[data-display-zone="R"]')!, { type: 'visual', id: 'visual-1' });
    expect(update).toHaveBeenLastCalledWith('d1', { layout: { type: 'split', visualIds: ['raw-left', 'visual-1'] } });
  });

  it('ignores audio payloads on display previews', async () => {
    const rawState = stateWithDisplay({ type: 'single' });
    const { update } = installXtream(rawState);
    const { displayList, setShowStatus } = renderWorkspace(rawState);

    await dropPayloadOnPane(displayList.querySelector<HTMLElement>('[data-display-zone="single"]')!, { type: 'audio-source', id: 'audio-1' });

    expect(update).not.toHaveBeenCalled();
    expect(setShowStatus).toHaveBeenCalledWith('Drop a visual source here.');
  });

  it('preserves raw split layout when rendered from a projected presentation display', async () => {
    const rawState = stateWithDisplay({ type: 'split', visualIds: ['raw-left', 'visual-2'] });
    const { update } = installXtream(rawState);
    const presentationDisplay = display({ type: 'split', visualIds: ['projection-left', undefined] });
    const { displayList } = renderWorkspace(rawState, [presentationDisplay]);

    await dropPayloadOnPane(displayList.querySelector<HTMLElement>('[data-display-zone="R"]')!, { type: 'visual', id: 'visual-1' });

    expect(update).toHaveBeenCalledWith('d1', { layout: { type: 'split', visualIds: ['raw-left', 'visual-1'] } });
  });

  it('resolves split zones under card overlays using the hit-test stack', async () => {
    const rawState = stateWithDisplay({ type: 'split', visualIds: ['visual-1', undefined] });
    const { update } = installXtream(rawState);
    const { displayList } = renderWorkspace(rawState);
    const overlay = displayList.querySelector<HTMLElement>('.display-overlay')!;
    const rightPane = displayList.querySelector<HTMLElement>('[data-display-zone="R"]')!;
    const elementsFromPoint = vi.fn(() => [overlay, rightPane]);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    });

    await dropPayloadOnTarget(overlay, { type: 'visual', id: 'visual-2' }, { clientX: 120, clientY: 40 });

    expect(update).toHaveBeenCalledWith('d1', { layout: { type: 'split', visualIds: ['visual-1', 'visual-2'] } });
    Reflect.deleteProperty(document, 'elementsFromPoint');
  });
});
