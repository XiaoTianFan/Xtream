import { assertElement } from '../shared/dom';

export const elements = {
  appFrame: assertElement(document.querySelector<HTMLDivElement>('.app-frame'), 'appFrame'),
  workspacePresentationOverlay: assertElement(
    document.querySelector<HTMLElement>('#workspacePresentationOverlay'),
    'workspacePresentationOverlay',
  ),
  surfaceMount: assertElement(document.querySelector<HTMLElement>('#surfaceMount'), 'surfaceMount'),
  patchSurface: assertElement(document.querySelector<HTMLElement>('#patchSurface'), 'patchSurface'),
  surfacePanel: assertElement(document.querySelector<HTMLElement>('#surfacePanel'), 'surfacePanel'),
  patchRailButton: assertElement(document.querySelector<HTMLButtonElement>('#patchRailButton'), 'patchRailButton'),
  streamRailButton: assertElement(document.querySelector<HTMLButtonElement>('#streamRailButton'), 'streamRailButton'),
  performanceRailButton: assertElement(document.querySelector<HTMLButtonElement>('#performanceRailButton'), 'performanceRailButton'),
  configRailButton: assertElement(document.querySelector<HTMLButtonElement>('#configRailButton'), 'configRailButton'),
  launchDashboard: assertElement(document.querySelector<HTMLElement>('#launchDashboard'), 'launchDashboard'),
  launchOpenShowButton: assertElement(document.querySelector<HTMLButtonElement>('#launchOpenShowButton'), 'launchOpenShowButton'),
  launchCreateShowButton: assertElement(document.querySelector<HTMLButtonElement>('#launchCreateShowButton'), 'launchCreateShowButton'),
  launchOpenDefaultButton: assertElement(document.querySelector<HTMLButtonElement>('#launchOpenDefaultButton'), 'launchOpenDefaultButton'),
  launchRecentList: assertElement(document.querySelector<HTMLDivElement>('#launchRecentList'), 'launchRecentList'),
  launchLoadingOverlay: assertElement(document.querySelector<HTMLElement>('#launchLoadingOverlay'), 'launchLoadingOverlay'),
  extractionOverlay: assertElement(document.querySelector<HTMLElement>('#extractionOverlay'), 'extractionOverlay'),
  extractionOverlayHeading: assertElement(document.querySelector<HTMLHeadingElement>('#extractionOverlayHeading'), 'extractionOverlayHeading'),
  extractionOverlayStatus: assertElement(document.querySelector<HTMLDivElement>('#extractionOverlayStatus'), 'extractionOverlayStatus'),
  extractionOverlayMessage: assertElement(document.querySelector<HTMLDivElement>('#extractionOverlayMessage'), 'extractionOverlayMessage'),
  extractionOverlayError: assertElement(document.querySelector<HTMLPreElement>('#extractionOverlayError'), 'extractionOverlayError'),
  extractionOverlayActions: assertElement(document.querySelector<HTMLDivElement>('#extractionOverlayActions'), 'extractionOverlayActions'),
  shellModalHost: assertElement(document.querySelector<HTMLElement>('#shellModalHost'), 'shellModalHost'),
  runtimeVersionLabel: assertElement(document.querySelector<HTMLSpanElement>('#runtimeVersionLabel'), 'runtimeVersionLabel'),
  globalSessionProblems: assertElement(document.querySelector<HTMLDivElement>('#globalSessionProblems'), 'globalSessionProblems'),
  globalSessionHint: assertElement(document.querySelector<HTMLDivElement>('#globalSessionHint'), 'globalSessionHint'),
  globalAudioMuteButton: assertElement(document.querySelector<HTMLButtonElement>('#globalAudioMuteButton'), 'globalAudioMuteButton'),
  displayBlackoutButton: assertElement(document.querySelector<HTMLButtonElement>('#displayBlackoutButton'), 'displayBlackoutButton'),
  missingMediaRelinkButton: assertElement(
    document.querySelector<HTMLButtonElement>('#missingMediaRelinkButton'),
    'missingMediaRelinkButton',
  ),
  clearSoloButton: assertElement(document.querySelector<HTMLButtonElement>('#clearSoloButton'), 'clearSoloButton'),
  displayIdentifyFlashButton: assertElement(
    document.querySelector<HTMLButtonElement>('#displayIdentifyFlashButton'),
    'displayIdentifyFlashButton',
  ),
};

export type ControlElements = typeof elements;
