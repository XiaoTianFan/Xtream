/** Mirrors the main process `currentShowConfigPath` whenever the renderer loads/saves/opens a project. */

let cachedShowProjectPath: string | undefined;

export function setShownProjectPath(path: string | undefined): void {
  cachedShowProjectPath = path;
}

export function getShownProjectPath(): string | undefined {
  return cachedShowProjectPath;
}
