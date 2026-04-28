import { decorateIconButton } from '../shared/icons';
import { elements } from './elements';

export function installShellIcons(): void {
  decorateIconButton(elements.launchOpenShowButton, 'FolderOpen', 'Open existing show');
  decorateIconButton(elements.launchCreateShowButton, 'Plus', 'Create new show');
  decorateIconButton(elements.launchOpenDefaultButton, 'FileJson', 'Open default show');
  setLaunchActionLabel(elements.launchOpenShowButton, 'Open Existing', 'Choose a saved show file.');
  setLaunchActionLabel(elements.launchCreateShowButton, 'Create New', 'Start an empty show project.');
  setLaunchActionLabel(elements.launchOpenDefaultButton, 'Open Default', 'Use the default show project.');
}

function setLaunchActionLabel(button: HTMLButtonElement, title: string, description: string): void {
  const icon = button.querySelector('.control-icon');
  const iconWrap = document.createElement('span');
  iconWrap.className = 'launch-action-icon';
  if (icon) {
    iconWrap.append(icon);
  }
  const copy = document.createElement('span');
  copy.className = 'launch-action-copy';
  const titleElement = document.createElement('span');
  titleElement.className = 'launch-action-title';
  titleElement.textContent = title;
  const descriptionElement = document.createElement('span');
  descriptionElement.className = 'launch-action-description';
  descriptionElement.textContent = description;
  copy.replaceChildren(titleElement, descriptionElement);
  button.replaceChildren(iconWrap, copy);
  button.setAttribute('aria-label', `${title}. ${description}`);
}
