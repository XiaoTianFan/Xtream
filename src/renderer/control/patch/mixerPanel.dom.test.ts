/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, VirtualOutputState } from '../../../shared/types';
import { createMixerPanelController } from './mixerPanel';
import { writeMediaPoolDragPayload } from './mediaPool/dragDrop';

vi.mock('./mixerPanel/contextMenu', () => ({
  showMixerOutputContextMenu: vi.fn(),
}));

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

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

function createDragEvent(type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'relatedTarget', { value: null });
  return event;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function output(sources: VirtualOutputState['sources'] = []): VirtualOutputState {
  return {
    id: 'out-1',
    label: 'Main Output',
    sources,
    busLevelDb: 0,
    ready: true,
    physicalRoutingAvailable: true,
  };
}

function stateWithOutput(sources: VirtualOutputState['sources'] = []): DirectorState {
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
    visuals: {},
    audioSources: {
      'audio-1': {
        id: 'audio-1',
        type: 'external-file',
        label: 'Kick Loop',
        durationSeconds: 10,
        channelCount: 2,
        ready: true,
      },
    },
    outputs: {
      'out-1': output(sources),
    },
    displays: {},
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
  } as unknown as DirectorState;
}

function installXtream(state: DirectorState) {
  const addSource = vi.fn(async (outputId: string, audioSourceId: string) => {
    state.outputs[outputId].sources.push({
      id: `selection-${state.outputs[outputId].sources.length + 1}`,
      audioSourceId,
      levelDb: 0,
      pan: 0,
    });
  });
  (window as unknown as { xtream: unknown }).xtream = {
    director: {
      getState: vi.fn(async () => state),
    },
    outputs: {
      addSource,
      update: vi.fn(),
    },
    audioRuntime: {
      setSoloOutputIds: vi.fn(),
    },
  };
  return { addSource };
}

function createController(state: DirectorState) {
  const outputPanel = document.createElement('div');
  const renderState = vi.fn();
  const refreshDetails = vi.fn();
  const syncTransportInputs = vi.fn();
  const setShowStatus = vi.fn();
  const controller = createMixerPanelController({ outputPanel }, {
    getState: () => state,
    getAudioDevices: () => [],
    isSelected: () => false,
    selectEntity: vi.fn(),
    renderState,
    syncTransportInputs,
    refreshDetails,
    setShowStatus,
  });
  controller.renderOutputs(state);
  document.body.append(outputPanel);
  return { controller, outputPanel, renderState, refreshDetails, setShowStatus };
}

async function dropAudioOnStrip(strip: HTMLElement): Promise<void> {
  const dataTransfer = createDataTransferStub();
  writeMediaPoolDragPayload(dataTransfer, { type: 'audio-source', id: 'audio-1' });
  strip.dispatchEvent(createDragEvent('drop', dataTransfer));
  await flushPromises();
}

describe('mixer panel media assignment drops', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  });

  it('routes valid audio drops through outputs.addSource and refreshes mixer state', async () => {
    const state = stateWithOutput();
    const { addSource } = installXtream(state);
    const { outputPanel, renderState, refreshDetails, setShowStatus } = createController(state);

    await dropAudioOnStrip(outputPanel.querySelector<HTMLElement>('[data-output-strip="out-1"]')!);

    expect(addSource).toHaveBeenCalledWith('out-1', 'audio-1');
    expect(renderState).toHaveBeenCalledWith(state);
    expect(refreshDetails).toHaveBeenCalledWith(state);
    expect(setShowStatus).toHaveBeenCalledWith('Added Kick Loop to Main Output.');
    expect(state.outputs['out-1'].sources).toHaveLength(1);
  });

  it('skips duplicate audio drops without mutating output sources', async () => {
    const state = stateWithOutput([{ id: 'selection-1', audioSourceId: 'audio-1', levelDb: 0, pan: 0 }]);
    const { addSource } = installXtream(state);
    const { outputPanel, renderState, refreshDetails, setShowStatus } = createController(state);

    await dropAudioOnStrip(outputPanel.querySelector<HTMLElement>('[data-output-strip="out-1"]')!);

    expect(addSource).not.toHaveBeenCalled();
    expect(renderState).not.toHaveBeenCalled();
    expect(refreshDetails).not.toHaveBeenCalled();
    expect(setShowStatus).toHaveBeenCalledWith('Kick Loop is already routed to Main Output.');
    expect(state.outputs['out-1'].sources).toHaveLength(1);
  });
});
