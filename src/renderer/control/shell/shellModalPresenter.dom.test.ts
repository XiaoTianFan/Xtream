/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeAll } from 'vitest';

/** Minimal shell DOM matching `control/shell/elements.ts` querySelectors. */
function mountControlShellFixture(): void {
  document.body.innerHTML = `
    <div class="app-frame"></div>
    <div id="workspacePresentationOverlay"></div>
    <div id="surfaceMount"></div>
    <div id="patchSurface"></div>
    <div id="surfacePanel"></div>
    <button type="button" id="patchRailButton"></button>
    <button type="button" id="streamRailButton"></button>
    <button type="button" id="performanceRailButton"></button>
    <button type="button" id="configRailButton"></button>
    <div id="launchDashboard"></div>
    <button type="button" id="launchOpenShowButton"></button>
    <button type="button" id="launchCreateShowButton"></button>
    <button type="button" id="launchOpenDefaultButton"></button>
    <div id="launchRecentList"></div>
    <div id="launchLoadingOverlay"></div>
    <div id="extractionOverlay"></div>
    <h2 id="extractionOverlayHeading"></h2>
    <div id="extractionOverlayStatus"></div>
    <div id="extractionOverlayMessage"></div>
    <pre id="extractionOverlayError"></pre>
    <div id="extractionOverlayActions"></div>
    <section id="shellModalHost" hidden></section>
    <span id="runtimeVersionLabel"></span>
    <div id="globalSessionProblems" hidden></div>
    <div id="globalSessionHint" hidden></div>
    <button type="button" id="globalAudioMuteButton"></button>
    <button type="button" id="displayBlackoutButton"></button>
    <button type="button" id="missingMediaRelinkButton"></button>
    <button type="button" id="clearSoloButton"></button>
    <button type="button" id="displayIdentifyFlashButton"></button>
    <button type="button" id="themeToggleButton"></button>
  `;
}

describe('shellModalPresenter (DOM)', () => {
  let shellShowChoiceModal: typeof import('./shellModalPresenter').shellShowChoiceModal;
  let teardownShellModalIfAny: typeof import('./shellModalPresenter').teardownShellModalIfAny;

  beforeAll(async () => {
    mountControlShellFixture();
    const mod = await import('./shellModalPresenter');
    shellShowChoiceModal = mod.shellShowChoiceModal;
    teardownShellModalIfAny = mod.teardownShellModalIfAny;
  });

  const basePayload = {
    title: 'T',
    message: 'M',
    buttons: [{ label: 'A', variant: 'primary' as const }, { label: 'B', variant: 'secondary' as const }],
    defaultId: 0,
    cancelId: 1,
  };

  it('resolves cancelId on Escape', async () => {
    teardownShellModalIfAny();
    const p = shellShowChoiceModal(basePayload);
    const host = document.getElementById('shellModalHost')!;
    await Promise.resolve();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(p).resolves.toBe(1);
  });

  it('wraps Tab from last footer button to first', async () => {
    teardownShellModalIfAny();
    const p = shellShowChoiceModal(basePayload);
    const host = document.getElementById('shellModalHost')!;
    await Promise.resolve();
    const buttons = host.querySelectorAll<HTMLButtonElement>('.shell-modal-host__footer button');
    expect(buttons.length).toBe(2);
    buttons[1]!.focus();
    buttons[1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, shiftKey: false }),
    );
    expect(document.activeElement).toBe(buttons[0]!);
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await p;
  });

  it('restores focus to the opener after dismiss', async () => {
    teardownShellModalIfAny();
    const opener = document.createElement('button');
    opener.id = 'opener-under-test';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const p = shellShowChoiceModal(basePayload);
    const host = document.getElementById('shellModalHost')!;
    await Promise.resolve();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await p;
    await Promise.resolve();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('pulls focus back into the dialog when it leaves the host', async () => {
    teardownShellModalIfAny();
    const behind = document.createElement('button');
    behind.id = 'behind-modal';
    document.body.appendChild(behind);

    const p = shellShowChoiceModal(basePayload);
    const host = document.getElementById('shellModalHost')!;
    await Promise.resolve();
    const primary = host.querySelector<HTMLButtonElement>('.shell-modal-host__footer button')!;
    behind.focus();
    expect(document.activeElement).toBe(behind);
    primary.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: behind }));

    await Promise.resolve();
    expect(document.activeElement).toBe(primary);

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await p;
    behind.remove();
  });
});
