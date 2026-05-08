/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import type { AudioSourceState, DirectorState, VisualState } from '../../../../shared/types';
import { readMediaPoolDragPayload } from './dragDrop';
import { createAudioSourceRow, createVisualGridCard, createVisualRow } from './rows';

vi.mock('../visualPoolGridPreview', () => ({
  mountVisualPoolGridPreview: vi.fn(),
}));

function createDataTransferStub(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: 'all',
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
  return event;
}

function deps() {
  return {
    isSelected: () => false,
    selectPoolEntity: vi.fn(),
    showVisualContextMenu: vi.fn(),
    showAudioSourceContextMenu: vi.fn(),
    getShowConfigPath: () => undefined,
    confirmPoolRecordRemoval: vi.fn(),
    clearSelectionIf: vi.fn(),
    renderPool: vi.fn(),
    renderState: vi.fn(),
    registerVisualPreviewCleanup: vi.fn(),
  };
}

function visual(): VisualState {
  return {
    id: 'visual-1',
    kind: 'file',
    type: 'image',
    label: 'Logo',
    url: 'file://logo.png',
    durationSeconds: 10,
    ready: true,
  };
}

function audioSource(): AudioSourceState {
  return {
    id: 'audio-1',
    type: 'external-file',
    label: 'Kick Loop',
    durationSeconds: 10,
    ready: true,
  };
}

describe('media pool rows drag payloads', () => {
  it('makes visual list rows draggable and emits visual payloads', () => {
    const row = createVisualRow(visual(), deps());
    const dataTransfer = createDataTransferStub();

    row.dispatchEvent(createDragEvent('dragstart', dataTransfer));

    expect(row.draggable).toBe(true);
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(row.classList.contains('media-pool-drag-source')).toBe(true);
    expect(readMediaPoolDragPayload(dataTransfer)).toEqual({ type: 'visual', id: 'visual-1' });
  });

  it('makes visual grid cards draggable and emits visual payloads', () => {
    const card = createVisualGridCard(visual(), deps());
    const dataTransfer = createDataTransferStub();

    card.dispatchEvent(createDragEvent('dragstart', dataTransfer));

    expect(card.draggable).toBe(true);
    expect(readMediaPoolDragPayload(dataTransfer)).toEqual({ type: 'visual', id: 'visual-1' });
  });

  it('makes audio source rows draggable and emits audio-source payloads', () => {
    const row = createAudioSourceRow(audioSource(), { visuals: {} } as DirectorState, deps());
    const dataTransfer = createDataTransferStub();

    row.dispatchEvent(createDragEvent('dragstart', dataTransfer));

    expect(row.draggable).toBe(true);
    expect(readMediaPoolDragPayload(dataTransfer)).toEqual({ type: 'audio-source', id: 'audio-1' });
  });

  it('does not start media drags from row action buttons', () => {
    const row = createVisualRow(visual(), deps());
    const remove = row.querySelector<HTMLButtonElement>('.row-action');
    const dataTransfer = createDataTransferStub();

    remove?.dispatchEvent(createDragEvent('dragstart', dataTransfer));

    expect(readMediaPoolDragPayload(dataTransfer)).toBeUndefined();
    expect(row.classList.contains('media-pool-drag-source')).toBe(false);
  });
});
