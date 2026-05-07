export function isFileDragEvent(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types?.includes('Files'));
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
