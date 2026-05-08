/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import type { VirtualOutputState } from '../../../../shared/types';
import { writeMediaPoolDragPayload, XTREAM_MEDIA_POOL_ITEM_MIME, XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME } from '../mediaPool/dragDrop';
import { createMixerStrip, createOutputDetailMixerStrip, type MixerStripDeps } from './mixerStrip';

vi.mock('./contextMenu', () => ({
  showMixerOutputContextMenu: vi.fn(),
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

function createDragEvent(type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'relatedTarget', { value: null });
  return event;
}

function output(): VirtualOutputState {
  return {
    id: 'out-1',
    label: 'Main Output',
    sources: [],
    busLevelDb: 0,
    ready: true,
    physicalRoutingAvailable: true,
  };
}

function deps(assignAudioSourceToOutput = vi.fn(), rejectMediaPoolDrop = vi.fn()): MixerStripDeps {
  return {
    isSelected: () => false,
    soloOutputIds: new Set(),
    setSoloOutputIds: vi.fn(),
    selectEntity: vi.fn(),
    renderState: vi.fn(),
    refreshDetails: vi.fn(),
    renderOutputs: vi.fn(),
    syncOutputMeters: vi.fn(),
    createOutputMeter: () => document.createElement('div'),
    assignAudioSourceToOutput,
    rejectMediaPoolDrop,
  };
}

describe('mixer strip media drops', () => {
  it('assigns audio-source payloads dropped on normal strips', () => {
    const assign = vi.fn();
    const strip = createMixerStrip(output(), deps(assign));
    const dataTransfer = createDataTransferStub();
    writeMediaPoolDragPayload(dataTransfer, { type: 'audio-source', id: 'audio-1' });

    strip.dispatchEvent(createDragEvent('dragover', dataTransfer));
    strip.dispatchEvent(createDragEvent('drop', dataTransfer));

    expect(dataTransfer.types).toContain(XTREAM_MEDIA_POOL_ITEM_MIME);
    expect(assign).toHaveBeenCalledWith('out-1', 'audio-1');
  });

  it('allows audio marker drags during protected dragover reads', () => {
    const strip = createMixerStrip(output(), deps());
    const dataTransfer = createDataTransferStub();
    dataTransfer.setData(XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME, 'audio-1');

    const event = createDragEvent('dragover', dataTransfer);
    strip.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(strip.classList.contains('media-drop-over')).toBe(true);
  });

  it('assigns audio-source payloads dropped on detail strips', () => {
    const assign = vi.fn();
    const strip = createOutputDetailMixerStrip(output(), deps(assign));
    const dataTransfer = createDataTransferStub();
    writeMediaPoolDragPayload(dataTransfer, { type: 'audio-source', id: 'audio-1' });

    strip.dispatchEvent(createDragEvent('drop', dataTransfer));

    expect(assign).toHaveBeenCalledWith('out-1', 'audio-1');
  });

  it('ignores visual payloads for assignment and reports rejection', () => {
    const assign = vi.fn();
    const reject = vi.fn();
    const strip = createMixerStrip(output(), deps(assign, reject));
    const dataTransfer = createDataTransferStub();
    writeMediaPoolDragPayload(dataTransfer, { type: 'visual', id: 'visual-1' });

    strip.dispatchEvent(createDragEvent('drop', dataTransfer));

    expect(assign).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith('out-1');
  });
});
