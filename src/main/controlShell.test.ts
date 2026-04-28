import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const controlHtml = readFileSync(resolve(__dirname, '../renderer/index.html'), 'utf8');

describe('control shell markup', () => {
  it('exposes all shell surfaces without fake state-changing cue/performance controls', () => {
    expect(controlHtml).toContain('id="patchRailButton"');
    expect(controlHtml).toContain('id="cueRailButton"');
    expect(controlHtml).toContain('id="performanceRailButton"');
    expect(controlHtml).toContain('id="configRailButton"');
    expect(controlHtml).toContain('id="logsRailButton"');
    expect(controlHtml).toContain('id="surfacePanel"');
    expect(controlHtml).not.toContain('Cue surface planned" disabled');
    expect(controlHtml).not.toContain('Performance surface planned" disabled');
  });

  it('keeps phase 8 global controls in the persistent status footer', () => {
    expect(controlHtml).toContain('id="runtimeVersionLabel"');
    expect(controlHtml).toContain('id="globalAudioMuteButton"');
    expect(controlHtml).toContain('id="displayBlackoutButton"');
    expect(controlHtml).toContain('id="resetMetersButton"');
  });

  it('includes the launch dashboard with actions and recents', () => {
    expect(controlHtml).toContain('id="launchDashboard"');
    expect(controlHtml).toContain('id="launchOpenShowButton"');
    expect(controlHtml).toContain('id="launchCreateShowButton"');
    expect(controlHtml).toContain('id="launchOpenDefaultButton"');
    expect(controlHtml).toContain('id="launchRecentList"');
  });
});
