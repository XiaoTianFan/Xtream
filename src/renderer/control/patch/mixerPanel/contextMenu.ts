import type { DirectorState, VirtualOutputState } from '../../../../shared/types';
import { createButton } from '../../shared/dom';
import type { SelectedEntity } from '../../shared/types';
import { shellShowConfirm } from '../../shell/shellModalPresenter';

let activeMixerOutputMenu: HTMLElement | undefined;
let mixerOutputMenuDismissListenersAttached = false;

export type MixerOutputContextMenuDeps = {
  clearSelectionIf?: (entity: SelectedEntity) => void;
  renderState: (state: DirectorState) => void;
  refreshDetails: (state: DirectorState) => void;
};

export function dismissMixerOutputContextMenu(): void {
  activeMixerOutputMenu?.remove();
  activeMixerOutputMenu = undefined;
}

function positionMixerOutputContextMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const menuBounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(clientX, window.innerWidth - menuBounds.width - 4)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - menuBounds.height - 4)}px`;
}

function ensureMixerOutputMenuDismissListeners(): void {
  if (mixerOutputMenuDismissListenersAttached) {
    return;
  }
  mixerOutputMenuDismissListenersAttached = true;
  document.addEventListener('click', dismissMixerOutputContextMenu);
  window.addEventListener('blur', dismissMixerOutputContextMenu);
}

export function showMixerOutputContextMenu(
  event: MouseEvent,
  output: VirtualOutputState,
  deps: MixerOutputContextMenuDeps,
): void {
  event.preventDefault();
  event.stopPropagation();
  dismissMixerOutputContextMenu();
  ensureMixerOutputMenuDismissListeners();

  const menu = document.createElement('div');
  menu.className = 'context-menu audio-source-menu';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('click', (e) => e.stopPropagation());

  const removeBtn = createButton('Remove virtual output…', 'secondary context-menu-item', () => {
    dismissMixerOutputContextMenu();
    void (async () => {
      if (!(await shellShowConfirm('Remove output?', `Remove ${output.label}?`))) {
        return;
      }
      await window.xtream.outputs.remove(output.id);
      deps.clearSelectionIf?.({ type: 'output', id: output.id });
      const nextState = await window.xtream.director.getState();
      deps.renderState(nextState);
      deps.refreshDetails(nextState);
    })();
  });
  removeBtn.setAttribute('role', 'menuitem');

  menu.append(removeBtn);
  document.body.append(menu);
  positionMixerOutputContextMenu(menu, event.clientX, event.clientY);
  activeMixerOutputMenu = menu;
}
