import { elements } from './elements';

/** Opaque full-frame backdrop over the workspace (`app-frame`) while opening/creating a show from headers/menus (launch modal hidden). */
export function setWorkspacePresentationLoadingUi(active: boolean): void {
  if (active) {
    elements.appFrame.dataset.workspaceLoading = 'active';
    elements.workspacePresentationOverlay.setAttribute('aria-hidden', 'false');
  } else {
    delete elements.appFrame.dataset.workspaceLoading;
    elements.workspacePresentationOverlay.setAttribute('aria-hidden', 'true');
  }
}
