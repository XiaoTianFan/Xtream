import type { AudioSourceId, VisualId } from '../../../../shared/types';

export const XTREAM_MEDIA_POOL_ITEM_MIME = 'application/x-xtream-media-pool-item';
export const XTREAM_MEDIA_POOL_VISUAL_MIME = 'application/x-xtream-media-pool-visual';
export const XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME = 'application/x-xtream-media-pool-audio-source';
const XTREAM_MEDIA_POOL_TEXT_PREFIX = 'xtream-media-pool-item:';

export type MediaPoolDragPayload =
  | { type: 'visual'; id: VisualId }
  | { type: 'audio-source'; id: AudioSourceId };

export type MediaPoolDragPayloadType = MediaPoolDragPayload['type'];

export function isFileDragEvent(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types?.includes('Files'));
}

export function writeMediaPoolDragPayload(dataTransfer: DataTransfer | null, payload: MediaPoolDragPayload): void {
  if (!dataTransfer) {
    return;
  }
  const serialized = JSON.stringify(payload);
  dataTransfer.setData(XTREAM_MEDIA_POOL_ITEM_MIME, serialized);
  dataTransfer.setData(payload.type === 'visual' ? XTREAM_MEDIA_POOL_VISUAL_MIME : XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME, payload.id);
  dataTransfer.setData('text/plain', `${XTREAM_MEDIA_POOL_TEXT_PREFIX}${serialized}`);
}

export function readMediaPoolDragPayload(dataTransfer: DataTransfer | null): MediaPoolDragPayload | undefined {
  if (!dataTransfer) {
    return undefined;
  }
  if (dataTransferHasType(dataTransfer, XTREAM_MEDIA_POOL_ITEM_MIME)) {
    const payload = readSerializedMediaPoolDragPayload(dataTransfer.getData(XTREAM_MEDIA_POOL_ITEM_MIME));
    if (payload) {
      return payload;
    }
  }
  return readTextMediaPoolDragPayload(dataTransfer.getData('text/plain'));
}

export function getMediaPoolDragPayloadType(dataTransfer: DataTransfer | null): MediaPoolDragPayloadType | undefined {
  if (!dataTransfer) {
    return undefined;
  }
  if (dataTransferHasType(dataTransfer, XTREAM_MEDIA_POOL_VISUAL_MIME)) {
    return 'visual';
  }
  if (dataTransferHasType(dataTransfer, XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME)) {
    return 'audio-source';
  }
  return readMediaPoolDragPayload(dataTransfer)?.type;
}

export function isMediaPoolDragEvent(event: DragEvent): boolean {
  if (!event.dataTransfer) {
    return false;
  }
  return (
    dataTransferHasType(event.dataTransfer, XTREAM_MEDIA_POOL_ITEM_MIME) ||
    dataTransferHasType(event.dataTransfer, XTREAM_MEDIA_POOL_VISUAL_MIME) ||
    dataTransferHasType(event.dataTransfer, XTREAM_MEDIA_POOL_AUDIO_SOURCE_MIME) ||
    dataTransferHasType(event.dataTransfer, 'text/plain')
  );
}

function readSerializedMediaPoolDragPayload(value: string): MediaPoolDragPayload | undefined {
  try {
    if (!value) {
      return undefined;
    }
    const payload = JSON.parse(value) as unknown;
    return isMediaPoolDragPayload(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function readTextMediaPoolDragPayload(value: string): MediaPoolDragPayload | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith(XTREAM_MEDIA_POOL_TEXT_PREFIX)) {
    return readSerializedMediaPoolDragPayload(value.slice(XTREAM_MEDIA_POOL_TEXT_PREFIX.length));
  }
  const legacy = value.match(/^(visual|audio-source):(.+)$/);
  if (!legacy) {
    return undefined;
  }
  const [, type, id] = legacy;
  return isMediaPoolDragPayload({ type, id }) ? ({ type, id } as MediaPoolDragPayload) : undefined;
}

function isMediaPoolDragPayload(payload: unknown): payload is MediaPoolDragPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as { type?: unknown; id?: unknown };
  return (candidate.type === 'visual' || candidate.type === 'audio-source') && typeof candidate.id === 'string' && candidate.id.length > 0;
}

function dataTransferHasType(dataTransfer: DataTransfer, type: string): boolean {
  const types = dataTransfer.types;
  if (!types) {
    return false;
  }
  const expected = type.toLowerCase();
  if (typeof types.includes === 'function' && types.includes(type)) {
    return true;
  }
  const maybeContains = types as unknown as DOMStringList & { contains?: (value: string) => boolean };
  if (typeof maybeContains.contains === 'function' && (maybeContains.contains(type) || maybeContains.contains(expected))) {
    return true;
  }
  return Array.from(types).some((actual) => actual.toLowerCase() === expected);
}

export function getDroppedFilePaths(
  dataTransfer: DataTransfer | null,
  getPathForFile: (file: File) => string,
  platform = navigator.platform,
): string[] {
  if (!dataTransfer) {
    return [];
  }
  const files = [
    ...Array.from(dataTransfer.files),
    ...Array.from(dataTransfer.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file)),
  ];
  const paths = files.map((file) => getPathForDroppedFile(file, getPathForFile)).filter((path): path is string => Boolean(path));
  const uriListPaths = parseDroppedFileUriList(dataTransfer.getData('text/uri-list'), platform);
  return Array.from(new Set([...paths, ...uriListPaths]));
}

function getPathForDroppedFile(file: File, getPathForFile: (file: File) => string): string | undefined {
  const path = getPathForFile(file) || (file as File & { path?: string }).path;
  return path || undefined;
}

export function parseDroppedFileUriList(uriList: string, platform = navigator.platform): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((uri) => fileUriToPath(uri, platform))
    .filter((path): path is string => Boolean(path));
}

export function fileUriToPath(uri: string, platform = navigator.platform): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') {
      return undefined;
    }
    const decodedPath = decodeURIComponent(url.pathname);
    const pathWithHost = url.hostname ? `//${url.hostname}${decodedPath}` : decodedPath;
    if (platform.toLowerCase().startsWith('win')) {
      const windowsPath = pathWithHost.replace(/\//g, '\\');
      return windowsPath.replace(/^\\([A-Za-z]:\\)/, '$1');
    }
    return pathWithHost;
  } catch {
    return undefined;
  }
}
