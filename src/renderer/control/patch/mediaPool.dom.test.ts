/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState } from '../../../shared/types';
import { createMediaPoolController } from './mediaPool';
import { writeMediaPoolDragPayload } from './mediaPool/dragDrop';
import { runUnifiedMediaPoolImport } from './unifiedMediaPoolImport';

vi.mock('./unifiedMediaPoolImport', () => ({
  runUnifiedManualMediaImport: vi.fn(async () => undefined),
  runUnifiedMediaPoolImport: vi.fn(async () => undefined),
}));

vi.mock('../shell/shellModalPresenter', () => ({
  shellShowConfirm: vi.fn(),
}));

function createDataTransferStub(initial: Record<string, string> = {}): DataTransfer {
  const store = new Map(Object.entries(initial));
  return {
    get types() {
      return [...store.keys()];
    },
    get files() {
      return [] as unknown as FileList;
    },
    get items() {
      return [] as unknown as DataTransferItemList;
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

function createElements() {
  return {
    mediaPoolPanel: document.createElement('section'),
    visualList: document.createElement('div'),
    visualListListPane: document.createElement('div'),
    visualListGridPane: document.createElement('div'),
    audioPanel: document.createElement('div'),
    visualTabButton: document.createElement('button'),
    audioTabButton: document.createElement('button'),
    poolSearchInput: document.createElement('input'),
    poolSortSelect: document.createElement('select'),
    addVisualsButton: document.createElement('button'),
    visualPoolLayoutToggleButton: document.createElement('button'),
  };
}

function createController(elements = createElements()) {
  const setShowStatus = vi.fn();
  const controller = createMediaPoolController(elements, {
    getState: () => ({ visuals: {}, audioSources: {} }) as DirectorState,
    setSelectedEntity: vi.fn(),
    isSelected: () => false,
    clearSelectionIf: vi.fn(),
    renderState: vi.fn(),
    setShowStatus,
    queueEmbeddedAudioImportPrompt: vi.fn(),
    probeVisualMetadata: vi.fn(),
    probeAudioMetadata: vi.fn(),
    createEmbeddedAudioRepresentation: vi.fn(async () => undefined),
    extractEmbeddedAudioFile: vi.fn(async () => undefined),
    getShowConfigPath: () => undefined,
  });
  controller.install();
  return { controller, elements, setShowStatus };
}

describe('media pool file drop handling', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    (window as unknown as { xtream: unknown }).xtream = {
      platform: {
        getPathForFile: vi.fn(() => ''),
      },
    };
  });

  it('ignores media-pool item drops instead of treating them as failed file imports', async () => {
    const { elements, setShowStatus } = createController();
    const dataTransfer = createDataTransferStub();
    writeMediaPoolDragPayload(dataTransfer, { type: 'visual', id: 'visual-1' });
    const event = createDragEvent('drop', dataTransfer);

    elements.mediaPoolPanel.dispatchEvent(event);
    await flushPromises();

    expect(event.defaultPrevented).toBe(false);
    expect(setShowStatus).not.toHaveBeenCalledWith('Drop import unavailable: no file paths were exposed by the platform.');
    expect(runUnifiedMediaPoolImport).not.toHaveBeenCalled();
  });

  it('still imports external file drops', async () => {
    const { elements } = createController();
    const dataTransfer = createDataTransferStub({
      Files: '',
      'text/uri-list': 'file:///C:/Shows/logo.png',
    });
    const event = createDragEvent('drop', dataTransfer);

    elements.mediaPoolPanel.dispatchEvent(event);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(runUnifiedMediaPoolImport).toHaveBeenCalledWith(['/C:/Shows/logo.png'], expect.any(Object));
  });
});
