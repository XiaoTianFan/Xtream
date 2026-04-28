import type { ControlSurface } from '../shared/types';
import { elements } from './elements';

export function installRailNavigation(setActiveSurface: (surface: ControlSurface) => void): void {
  elements.patchRailButton.addEventListener('click', () => setActiveSurface('patch'));
  elements.cueRailButton.addEventListener('click', () => setActiveSurface('cue'));
  elements.performanceRailButton.addEventListener('click', () => setActiveSurface('performance'));
  elements.configRailButton.addEventListener('click', () => setActiveSurface('config'));
  elements.logsRailButton.addEventListener('click', () => setActiveSurface('logs'));
}
