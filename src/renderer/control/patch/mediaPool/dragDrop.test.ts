import { describe, expect, it } from 'vitest';
import {
  fileUriToPath,
  getCustomMediaPoolDragPayloadType,
  getMediaPoolDragPayloadType,
  getDroppedFilePaths,
  isCustomMediaPoolDragEvent,
  isMediaPoolDragEvent,
  parseDroppedFileUriList,
  readCustomMediaPoolDragPayload,
  readMediaPoolDragPayload,
  writeMediaPoolDragPayload,
  XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME,
  XTREAM_MEDIA_POOL_ITEM_MIME,
  XTREAM_MEDIA_POOL_VISUAL_MIME,
} from './dragDrop';

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

function createDragEvent(dataTransfer: DataTransfer): DragEvent {
  const event = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

describe('mediaPool dragDrop', () => {
  it('round-trips visual media-pool payloads', () => {
    const dataTransfer = createDataTransferStub();

    writeMediaPoolDragPayload(dataTransfer, { type: 'visual', id: 'visual-1' });

    expect(dataTransfer.types).toContain(XTREAM_MEDIA_POOL_ITEM_MIME);
    expect(dataTransfer.types).toContain(XTREAM_MEDIA_POOL_VISUAL_MIME);
    expect(readMediaPoolDragPayload(dataTransfer)).toEqual({ type: 'visual', id: 'visual-1' });
  });

  it('round-trips audio-source media-pool payloads', () => {
    const dataTransfer = createDataTransferStub();

    writeMediaPoolDragPayload(dataTransfer, { type: 'audio-source', id: 'audio-1' });

    expect(dataTransfer.types).toContain(XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME);
    expect(readMediaPoolDragPayload(dataTransfer)).toEqual({ type: 'audio-source', id: 'audio-1' });
  });

  it('detects media-pool drag kinds from marker MIME types without reading payload data', () => {
    const visualTransfer = createDataTransferStub({ [XTREAM_MEDIA_POOL_VISUAL_MIME]: '' });
    const audioTransfer = createDataTransferStub({ [XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME]: '' });

    expect(getCustomMediaPoolDragPayloadType(visualTransfer)).toBe('visual');
    expect(getCustomMediaPoolDragPayloadType(audioTransfer)).toBe('audio-source');
    expect(getMediaPoolDragPayloadType(visualTransfer)).toBe('visual');
    expect(getMediaPoolDragPayloadType(audioTransfer)).toBe('audio-source');
    expect(readMediaPoolDragPayload(visualTransfer)).toBeUndefined();
    expect(isCustomMediaPoolDragEvent(createDragEvent(visualTransfer))).toBe(true);
    expect(isMediaPoolDragEvent(createDragEvent(visualTransfer))).toBe(true);
  });

  it('reads prefixed text/plain fallbacks for environments that strip custom drag types', () => {
    const dataTransfer = createDataTransferStub();
    writeMediaPoolDragPayload(dataTransfer, { type: 'visual', id: 'visual-1' });
    const textOnly = createDataTransferStub({ 'text/plain': dataTransfer.getData('text/plain') });

    expect(isMediaPoolDragEvent(createDragEvent(textOnly))).toBe(true);
    expect(isCustomMediaPoolDragEvent(createDragEvent(textOnly))).toBe(false);
    expect(readCustomMediaPoolDragPayload(textOnly)).toBeUndefined();
    expect(readMediaPoolDragPayload(textOnly)).toEqual({ type: 'visual', id: 'visual-1' });
  });

  it('ignores malformed media-pool payload JSON', () => {
    const dataTransfer = createDataTransferStub({ [XTREAM_MEDIA_POOL_ITEM_MIME]: '{nope' });

    expect(readMediaPoolDragPayload(dataTransfer)).toBeUndefined();
  });

  it('ignores missing, empty, and structurally invalid media-pool payloads', () => {
    expect(readMediaPoolDragPayload(createDataTransferStub())).toBeUndefined();
    expect(readMediaPoolDragPayload(createDataTransferStub({ [XTREAM_MEDIA_POOL_ITEM_MIME]: '' }))).toBeUndefined();
    expect(readMediaPoolDragPayload(createDataTransferStub({ [XTREAM_MEDIA_POOL_ITEM_MIME]: JSON.stringify({ type: 'scene', id: 's1' }) }))).toBeUndefined();
  });

  it('ignores external file drops for media-pool assignment reads', () => {
    const dataTransfer = createDataTransferStub({ Files: '' });

    expect(readMediaPoolDragPayload(dataTransfer)).toBeUndefined();
    expect(getDroppedFilePaths(dataTransfer, () => '')).toEqual([]);
  });

  it('parses dropped file URI lists without losing existing path behavior', () => {
    expect(parseDroppedFileUriList('file:///C:/Shows/logo.png\n# comment\nfile:///C:/Shows/loop.mp4', 'Win32')).toEqual([
      'C:\\Shows\\logo.png',
      'C:\\Shows\\loop.mp4',
    ]);
    expect(parseDroppedFileUriList('file:///Users/me/logo.png', 'MacIntel')).toEqual(['/Users/me/logo.png']);
  });

  it('ignores non-file URI entries when parsing dropped paths', () => {
    expect(fileUriToPath('https://example.test/logo.png', 'Win32')).toBeUndefined();
    expect(fileUriToPath('not a uri', 'Win32')).toBeUndefined();
  });
});
