import { elements } from './elements';
import { decorateIconButton } from './icons';

export function installShellIcons(): void {
  decorateIconButton(elements.playButton, 'Play', 'Play');
  decorateIconButton(elements.pauseButton, 'Pause', 'Pause');
  decorateIconButton(elements.stopButton, 'StopCircle', 'Stop');
  decorateIconButton(elements.loopToggleButton, 'Repeat', 'Loop settings');
  decorateIconButton(elements.saveShowButton, 'Save', 'Save show');
  decorateIconButton(elements.saveShowAsButton, 'FileJson', 'Save show as');
  decorateIconButton(elements.openShowButton, 'FolderOpen', 'Open show');
  decorateIconButton(elements.createShowButton, 'Plus', 'Create show project');
  decorateIconButton(elements.launchOpenShowButton, 'FolderOpen', 'Open existing show');
  decorateIconButton(elements.launchCreateShowButton, 'Plus', 'Create new show');
  decorateIconButton(elements.launchOpenDefaultButton, 'FileJson', 'Open default show');
  setLaunchActionLabel(elements.launchOpenShowButton, 'Open Existing', 'Choose a saved show file.');
  setLaunchActionLabel(elements.launchCreateShowButton, 'Create New', 'Start an empty show project.');
  setLaunchActionLabel(elements.launchOpenDefaultButton, 'Open Default', 'Use the default show project.');
  decorateIconButton(elements.addVisualsButton, 'Plus', 'Add visuals');
  decorateIconButton(elements.createDisplayButton, 'Plus', 'Add display');
  decorateIconButton(elements.createOutputButton, 'Plus', 'Create output');
  decorateIconButton(elements.refreshOutputsButton, 'RefreshCcw', 'Refresh outputs');
  decorateIconButton(elements.expandMixerButton, 'Maximize2', 'Expand mixer');
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
