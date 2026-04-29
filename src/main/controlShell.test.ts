import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const controlHtml = readFileSync(resolve(__dirname, '../renderer/index.html'), 'utf8');

describe('control shell markup', () => {
  it('exposes all shell surfaces without fake state-changing stream/performance controls', () => {
    expect(controlHtml).toContain('id="patchRailButton"');
    expect(controlHtml).toContain('id="streamRailButton"');
    expect(controlHtml).toContain('id="performanceRailButton"');
    expect(controlHtml).toContain('id="configRailButton"');
    expect(controlHtml).toContain('id="surfacePanel"');
    expect(controlHtml).not.toContain('Stream" disabled');
    expect(controlHtml).not.toContain('Performance surface planned" disabled');
  });

  it('keeps phase 8 global controls in the persistent status footer', () => {
    expect(controlHtml).toContain('id="runtimeVersionLabel"');
    expect(controlHtml).toContain('id="globalAudioMuteButton"');
    expect(controlHtml).toContain('id="displayBlackoutButton"');
    expect(controlHtml).toContain('id="displayIdentifyFlashButton"');
    expect(controlHtml).toContain('id="resetMetersButton"');
  });

  it('places status-footer under surface mount after patch workspace, not inside patchSurface', () => {
    const patchStart = controlHtml.indexOf('id="patchSurface"');
    const surfacePanelIdx = controlHtml.indexOf('id="surfacePanel"');
    const footerIdx = controlHtml.indexOf('class="status-footer"');
    expect(patchStart).toBeGreaterThanOrEqual(0);
    expect(surfacePanelIdx).toBeGreaterThan(patchStart);
    expect(footerIdx).toBeGreaterThan(surfacePanelIdx);
    expect(controlHtml.slice(patchStart, surfacePanelIdx)).not.toContain('globalAudioMuteButton');
  });

  it('includes the launch dashboard with actions and recents', () => {
    expect(controlHtml).toContain('id="launchDashboard"');
    expect(controlHtml).toContain('id="launchOpenShowButton"');
    expect(controlHtml).toContain('id="launchCreateShowButton"');
    expect(controlHtml).toContain('id="launchOpenDefaultButton"');
    expect(controlHtml).toContain('id="launchRecentList"');
  });
});
