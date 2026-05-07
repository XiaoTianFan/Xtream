import { desktopCapturer, session, systemPreferences, webContents as electronWebContents } from 'electron';
import type { LiveDesktopSourceSummary } from '../shared/types';

type PendingDisplayMediaGrant = { visualId: string; sourceId?: string; createdAtWallTimeMs: number };

export type CapturePermissionController = {
  installCapturePermissionHandlers: () => void;
  queuePendingDisplayMediaGrant: (contentsId: number, grant: Omit<PendingDisplayMediaGrant, 'createdAtWallTimeMs'>) => void;
  releasePendingDisplayMediaGrant: (contentsId: number, visualId: string) => void;
  listDesktopCaptureSources: () => Promise<LiveDesktopSourceSummary[]>;
  getLivePermissionStatus: () => Record<string, string>;
};

type CapturePermissionControllerOptions = {
  isTrustedWebContents: (contents: Electron.WebContents | undefined | null) => boolean;
  isTrustedOrigin: (origin: string) => boolean;
};

function getDisplayMediaRequester(request: { frame: Electron.WebFrameMain | null }): Electron.WebContents | undefined {
  return request.frame ? electronWebContents.fromFrame(request.frame) : undefined;
}

export function createCapturePermissionController(options: CapturePermissionControllerOptions): CapturePermissionController {
  const pendingDisplayMediaGrants = new Map<number, PendingDisplayMediaGrant[]>();

  function consumePendingDisplayMediaGrant(contentsId: number | undefined): PendingDisplayMediaGrant | undefined {
    if (contentsId !== undefined) {
      const grants = pendingDisplayMediaGrants.get(contentsId);
      const grant = grants?.shift();
      if (grants && grants.length === 0) {
        pendingDisplayMediaGrants.delete(contentsId);
      }
      if (grant) {
        return grant;
      }
    }
    if (pendingDisplayMediaGrants.size === 1) {
      const [fallbackContentsId, fallbackGrants] = Array.from(pendingDisplayMediaGrants.entries())[0];
      const grant = fallbackGrants.shift();
      if (fallbackGrants.length === 0) {
        pendingDisplayMediaGrants.delete(fallbackContentsId);
      }
      return grant;
    }
    return undefined;
  }

  function queuePendingDisplayMediaGrant(contentsId: number, grant: Omit<PendingDisplayMediaGrant, 'createdAtWallTimeMs'>): void {
    const grants = pendingDisplayMediaGrants.get(contentsId) ?? [];
    grants.push({ ...grant, createdAtWallTimeMs: Date.now() });
    pendingDisplayMediaGrants.set(contentsId, grants.slice(-8));
  }

  function releasePendingDisplayMediaGrant(contentsId: number, visualId: string): void {
    const grants = pendingDisplayMediaGrants.get(contentsId);
    if (!grants) {
      return;
    }
    const remaining = grants.filter((grant) => grant.visualId !== visualId);
    if (remaining.length === 0) {
      pendingDisplayMediaGrants.delete(contentsId);
    } else {
      pendingDisplayMediaGrants.set(contentsId, remaining);
    }
  }

  function installCapturePermissionHandlers(): void {
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      if (!options.isTrustedWebContents(webContents)) {
        return false;
      }
      return permission === 'media' || (permission as string) === 'display-capture';
    });
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(options.isTrustedWebContents(webContents) && (permission === 'media' || (permission as string) === 'display-capture'));
    });
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      const requester = getDisplayMediaRequester(request);
      if (!options.isTrustedOrigin(request.securityOrigin) || !options.isTrustedWebContents(requester)) {
        return;
      }
      const grant = consumePendingDisplayMediaGrant(requester?.id);
      if (!grant) {
        console.warn('Display media request had no pending Xtream grant.', { requesterId: requester?.id, origin: request.securityOrigin });
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 640, height: 360 }, fetchWindowIcons: true });
        const source = grant.sourceId ? sources.find((candidate) => candidate.id === grant.sourceId) : sources[0];
        if (source) {
          callback({ video: source });
        } else {
          console.warn('Requested live capture source was not found.', { visualId: grant.visualId, sourceId: grant.sourceId });
        }
      } catch (error: unknown) {
        console.error('Failed to grant live display media source.', error);
      }
    });
  }

  async function listDesktopCaptureSources(): Promise<LiveDesktopSourceSummary[]> {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      displayId: source.display_id,
      thumbnailDataUrl: source.thumbnail.isEmpty() ? undefined : source.thumbnail.toDataURL(),
      appIconDataUrl: source.appIcon?.isEmpty() ? undefined : source.appIcon?.toDataURL(),
    }));
  }

  function getLivePermissionStatus(): Record<string, string> {
    if (process.platform !== 'darwin') {
      return {};
    }
    return {
      camera: systemPreferences.getMediaAccessStatus('camera'),
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      screen: systemPreferences.getMediaAccessStatus('screen'),
    };
  }

  return {
    installCapturePermissionHandlers,
    queuePendingDisplayMediaGrant,
    releasePendingDisplayMediaGrant,
    listDesktopCaptureSources,
    getLivePermissionStatus,
  };
}
