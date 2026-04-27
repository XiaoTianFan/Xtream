import { pathToFileURL } from 'node:url';

const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_ABSOLUTE_PATH = /^\\\\[^\\]+\\[^\\]+/;

function encodePathSegments(pathSegments: string[]): string {
  return pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
}

function windowsDrivePathToFileUrl(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const drive = normalizedPath.slice(0, 2);
  const rest = normalizedPath.slice(2).split('/').filter(Boolean);
  const encodedRest = encodePathSegments(rest);
  return `file:///${drive}${encodedRest ? `/${encodedRest}` : '/'}`;
}

function windowsUncPathToFileUrl(filePath: string): string {
  const [host = '', share = '', ...rest] = filePath.slice(2).replace(/\\/g, '/').split('/').filter(Boolean);
  const encodedShareAndPath = encodePathSegments([share, ...rest]);
  return `file://${host}${encodedShareAndPath ? `/${encodedShareAndPath}` : ''}`;
}

export function toRendererFileUrl(filePath: string): string {
  if (filePath.startsWith('file://')) {
    return new URL(filePath).toString();
  }
  if (WINDOWS_DRIVE_ABSOLUTE_PATH.test(filePath)) {
    return windowsDrivePathToFileUrl(filePath);
  }
  if (WINDOWS_UNC_ABSOLUTE_PATH.test(filePath)) {
    return windowsUncPathToFileUrl(filePath);
  }
  return pathToFileURL(filePath).toString();
}
