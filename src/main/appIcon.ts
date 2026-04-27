import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const ICON_DIR = 'resources/icons';

export function getAppIconPath(): string | undefined {
  const file =
    process.platform === 'win32'
      ? 'app.ico'
      : process.platform === 'darwin'
        ? 'app.icns'
        : 'app.png';
  const full = path.join(app.getAppPath(), ICON_DIR, file);
  return fs.existsSync(full) ? full : undefined;
}
