import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { DisplayCreateOptions, DisplayMonitorInfo, DisplayUpdate, DisplayWindowState } from '../shared/types';

type RegistryEntry = {
  window: BrowserWindow;
  state: DisplayWindowState;
  isClosing: boolean;
};

const DEFAULT_LAYOUT = { type: 'single' } as const;
const USE_SIMPLE_FULLSCREEN = process.platform === 'darwin';
type DisplayBounds = NonNullable<DisplayWindowState['bounds']>;

export class DisplayRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private nextDisplayNumber = 0;

  constructor(
    private readonly preloadPath: string,
    private readonly rendererEntry: string,
    private readonly onClosed: (id: string) => void,
    private readonly onStateChanged: (state: DisplayWindowState) => void,
  ) {}

  create(options: DisplayCreateOptions = {}): DisplayWindowState {
    const id = options.id ?? this.allocateDisplayId();
    return this.createEntry(id, options);
  }

  reopen(state: DisplayWindowState): DisplayWindowState {
    const existing = this.entries.get(state.id);
    if (existing && !existing.window.isDestroyed() && state.health !== 'degraded') {
      existing.window.focus();
      return { ...existing.state };
    }
    if (existing && !existing.window.isDestroyed()) {
      existing.window.removeAllListeners('closed');
      existing.window.close();
      this.entries.delete(state.id);
    }

    return this.createEntry(state.id, {
      label: state.label,
      layout: state.layout,
      fullscreen: state.fullscreen,
      displayId: state.displayId,
      bounds: state.bounds,
    });
  }

  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }

    entry.window.removeAllListeners('closed');
    entry.window.close();
    this.entries.delete(id);
    return true;
  }

  private allocateDisplayId(): string {
    let id: string;
    do {
      id = `display-${this.nextDisplayNumber}`;
      this.nextDisplayNumber += 1;
    } while (this.entries.has(id));

    return id;
  }

  private createEntry(id: string, options: DisplayCreateOptions = {}): DisplayWindowState {
    const targetDisplay = options.displayId
      ? screen.getAllDisplays().find((display) => String(display.id) === options.displayId)
      : undefined;

    const bounds = options.bounds ?? targetDisplay?.bounds;
    const shouldFullscreen = options.fullscreen === true;
    const window = new BrowserWindow({
      x: bounds?.x,
      y: bounds?.y,
      width: bounds?.width ?? 960,
      height: bounds?.height ?? 540,
      useContentSize: false,
      fullscreenable: true,
      ...(USE_SIMPLE_FULLSCREEN ? { simpleFullscreen: false } : { fullscreen: false }),
      autoHideMenuBar: true,
      title: `Xtream ${id}`,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    if (bounds) {
      window.setBounds(bounds);
    }
    if (shouldFullscreen) {
      this.setDisplayFullscreen(window, true);
    }

    const state: DisplayWindowState = {
      id,
      label: options.label,
      bounds: bounds ? this.cloneBounds(bounds) : this.getWindowedBounds(window),
      displayId: options.displayId,
      fullscreen: shouldFullscreen || this.isDisplayFullscreen(window),
      layout: options.layout ?? DEFAULT_LAYOUT,
      health: 'starting',
    };

    this.entries.set(id, { window, state, isClosing: false });
    this.loadDisplay(window, id);

    window.on('close', () => {
      this.refreshWindowState(id);
      const entry = this.entries.get(id);
      if (entry) {
        entry.isClosing = true;
      }
    });
    window.on('closed', () => {
      this.entries.delete(id);
      this.onClosed(id);
    });

    window.on('resize', () => this.refreshWindowState(id));
    window.on('move', () => this.refreshWindowState(id));
    window.on('enter-full-screen', () => this.refreshWindowState(id));
    window.on('leave-full-screen', () => this.refreshWindowState(id));
    window.on('unresponsive', () => this.markDegraded(id, 'Display renderer became unresponsive.'));
    window.webContents.on('render-process-gone', (_event, details) => {
      this.markDegraded(id, `Display renderer process exited: ${details.reason}.`);
    });
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') {
        return;
      }

      if (input.key.toLowerCase() === 'f') {
        event.preventDefault();
        this.update(id, { fullscreen: !this.isDisplayFullscreen(window) });
      } else if (input.key === 'Escape' && this.isDisplayFullscreen(window)) {
        event.preventDefault();
        this.update(id, { fullscreen: false });
      }
    });

    return { ...state };
  }

  update(id: string, update: DisplayUpdate): DisplayWindowState {
    const entry = this.getEntry(id);
    const nextState: DisplayWindowState = {
      ...entry.state,
      ...update,
    };

    if (update.fullscreen !== undefined && this.isDisplayFullscreen(entry.window) !== update.fullscreen) {
      this.setDisplayFullscreen(entry.window, update.fullscreen);
      nextState.fullscreen = update.fullscreen;
    }

    if (update.displayId !== undefined) {
      this.moveToDisplay(entry.window, update.displayId);
      nextState.bounds = entry.window.getBounds();
      nextState.fullscreen = this.isDisplayFullscreen(entry.window);
    }

    if (update.label !== undefined) {
      entry.window.setTitle(`Xtream ${update.label}`);
    }

    entry.state = nextState;
    this.onStateChanged({ ...entry.state });
    return { ...entry.state };
  }

  close(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }

    this.refreshWindowState(id);
    entry.isClosing = true;
    entry.window.close();
    return true;
  }

  closeAll(): void {
    for (const entry of this.entries.values()) {
      this.refreshWindowState(entry.state.id);
      entry.isClosing = true;
      entry.window.close();
    }
    this.entries.clear();
  }

  get(id: string): DisplayWindowState | undefined {
    const entry = this.entries.get(id);
    return entry ? { ...entry.state } : undefined;
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.entries.values(), (entry) => entry.window);
  }

  listMonitors(): DisplayMonitorInfo[] {
    return screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      label: `Display ${index + 1} (${display.bounds.width}x${display.bounds.height})`,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      internal: display.internal,
    }));
  }

  private getEntry(id: string): RegistryEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`Unknown display window: ${id}`);
    }

    return entry;
  }

  private refreshWindowState(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    if (entry.isClosing || entry.window.isDestroyed()) {
      return;
    }

    entry.state = {
      ...entry.state,
      bounds: this.isDisplayFullscreen(entry.window) ? entry.state.bounds : this.getWindowedBounds(entry.window),
      fullscreen: this.isDisplayFullscreen(entry.window),
    };
    this.onStateChanged({ ...entry.state });
  }

  private markDegraded(id: string, reason: string): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    entry.state = {
      ...entry.state,
      health: 'degraded',
      degradationReason: reason,
    };
    this.onStateChanged({ ...entry.state });
  }

  private moveToDisplay(window: BrowserWindow, displayId: string | undefined): void {
    if (!displayId) {
      return;
    }

    const targetDisplay = screen.getAllDisplays().find((display) => String(display.id) === displayId);
    if (!targetDisplay) {
      return;
    }

    const wasFullscreen = this.isDisplayFullscreen(window);
    if (wasFullscreen) {
      this.setDisplayFullscreen(window, false);
    }
    window.setBounds(targetDisplay.bounds);
    if (wasFullscreen) {
      this.setDisplayFullscreen(window, true);
    }
  }

  private isDisplayFullscreen(window: BrowserWindow): boolean {
    return USE_SIMPLE_FULLSCREEN ? window.isSimpleFullScreen() : window.isFullScreen();
  }

  private getWindowedBounds(window: BrowserWindow): DisplayBounds {
    return this.cloneBounds(this.isDisplayFullscreen(window) ? window.getNormalBounds() : window.getBounds());
  }

  private cloneBounds(bounds: DisplayBounds): DisplayBounds {
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }

  private setDisplayFullscreen(window: BrowserWindow, fullscreen: boolean): void {
    if (USE_SIMPLE_FULLSCREEN) {
      window.setSimpleFullScreen(fullscreen);
      return;
    }

    window.setFullScreen(fullscreen);
  }

  private loadDisplay(window: BrowserWindow, id: string): void {
    if (process.env.VITE_DEV_SERVER_URL) {
      void window.loadURL(`${process.env.VITE_DEV_SERVER_URL}/display.html?id=${id}`);
      return;
    }

    void window.loadFile(path.join(this.rendererEntry, 'display.html'), {
      query: { id },
    });
  }
}
