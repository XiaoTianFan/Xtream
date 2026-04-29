import { decorateRailButton } from '../shared/icons';
import type { ControlSurface } from '../shared/types';
import { elements } from './elements';

export function installRailNavigation(setActiveSurface: (surface: ControlSurface) => void): void {
  decorateRailButton(elements.patchRailButton, 'LayoutPanelLeft', 'Patch', { title: 'Patch' });
  decorateRailButton(elements.streamRailButton, 'ListVideo', 'Stream', { title: 'Stream' });
  decorateRailButton(elements.performanceRailButton, 'GamepadDirectional', 'Performance', {
    title: 'Performance surface planned',
  });
  decorateRailButton(elements.configRailButton, 'Settings', 'Config', { title: 'Config and diagnostics' });

  elements.patchRailButton.addEventListener('click', () => setActiveSurface('patch'));
  elements.streamRailButton.addEventListener('click', () => setActiveSurface('stream'));
  elements.performanceRailButton.addEventListener('click', () => setActiveSurface('performance'));
  elements.configRailButton.addEventListener('click', () => setActiveSurface('config'));
}
