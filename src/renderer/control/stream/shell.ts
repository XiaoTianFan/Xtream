import type { MediaPoolElements } from '../patch/mediaPool';
import { createButton } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import type { StreamSurfaceRefs } from './streamTypes';

export function createStreamSplitter(refs: StreamSurfaceRefs, id: string, orientation: 'horizontal' | 'vertical', label: string): HTMLElement {
  const splitter = document.createElement('div');
  splitter.id = id;
  splitter.className = `splitter ${orientation}`;
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-orientation', orientation);
  splitter.setAttribute('aria-label', label);
  splitter.tabIndex = 0;
  refs[id] = splitter;
  return splitter;
}

function createPoolTabButton(label: string, active: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `pool-tab ${active ? 'active' : ''}`;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-selected', String(active));
  button.textContent = label;
  return button;
}

export function createStreamMediaPoolElements(panel: HTMLElement, refs: StreamSurfaceRefs): MediaPoolElements {
  const header = document.createElement('div');
  header.className = 'panel-header';
  const heading = document.createElement('h2');
  heading.textContent = 'Media Pool';
  const addVisualsButton = createButton('Add Media', '', () => undefined);
  decorateIconButton(addVisualsButton, 'Plus', 'Add visuals');
  const visualPoolLayoutToggleButton = createButton('', 'icon-button', () => undefined);
  decorateIconButton(visualPoolLayoutToggleButton, 'LayoutGrid', 'Show grid view');
  visualPoolLayoutToggleButton.id = 'streamVisualPoolLayoutToggleButton';
  visualPoolLayoutToggleButton.hidden = true;
  visualPoolLayoutToggleButton.setAttribute('aria-pressed', 'false');
  const headerActions = document.createElement('div');
  headerActions.className = 'panel-header-actions';
  headerActions.append(addVisualsButton, visualPoolLayoutToggleButton);
  header.append(heading, headerActions);

  const main = document.createElement('div');
  main.className = 'media-pool-main';
  const tabs = document.createElement('div');
  tabs.className = 'pool-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Media pool tabs');
  const visualTabButton = createPoolTabButton('Visuals', true);
  const audioTabButton = createPoolTabButton('Audio', false);
  tabs.append(visualTabButton, audioTabButton);

  const toolbar = document.createElement('div');
  toolbar.className = 'pool-toolbar';
  const searchLabel = document.createElement('label');
  const searchText = document.createElement('span');
  searchText.className = 'sr-only';
  searchText.textContent = 'Search media pool';
  const poolSearchInput = document.createElement('input');
  poolSearchInput.type = 'search';
  poolSearchInput.placeholder = 'Search media';
  searchLabel.append(searchText, poolSearchInput);
  const poolSortSelect = document.createElement('select');
  poolSortSelect.setAttribute('aria-label', 'Sort media pool');
  for (const [value, label] of [
    ['label', 'Label'],
    ['duration', 'Duration'],
    ['status', 'Status'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    poolSortSelect.append(option);
  }
  const liveGridPreviewToggleButton = document.createElement('button');
  liveGridPreviewToggleButton.type = 'button';
  liveGridPreviewToggleButton.id = 'streamLiveGridPreviewToggleButton';
  liveGridPreviewToggleButton.className = 'icon-button pool-toolbar-icon';
  liveGridPreviewToggleButton.hidden = true;
  liveGridPreviewToggleButton.setAttribute('aria-pressed', 'true');
  liveGridPreviewToggleButton.setAttribute('aria-label', 'Live previews in grid');

  toolbar.append(searchLabel, liveGridPreviewToggleButton, poolSortSelect);

  const mediaListRegion = document.createElement('div');
  mediaListRegion.className = 'media-list-region drop-target';
  const visualList = document.createElement('div');
  visualList.className = 'visual-list-mount';
  const visualListListPane = document.createElement('div');
  visualListListPane.className = 'visual-list';
  const visualListGridPane = document.createElement('div');
  visualListGridPane.className = 'visual-list visual-list--grid';
  visualListGridPane.hidden = true;
  visualList.append(visualListListPane, visualListGridPane);
  const audioPanel = document.createElement('div');
  audioPanel.className = 'audio-panel';
  mediaListRegion.append(visualList, audioPanel);
  main.append(tabs, toolbar, mediaListRegion);
  panel.replaceChildren(header, main);
  return {
    mediaPoolPanel: panel,
    visualList,
    visualListListPane,
    visualListGridPane,
    audioPanel,
    visualTabButton,
    audioTabButton,
    poolSearchInput,
    poolSortSelect,
    addVisualsButton,
    visualPoolLayoutToggleButton,
    liveGridPreviewToggleButton,
  };
}

export function createStreamShellLayout(refs: StreamSurfaceRefs): {
  root: HTMLElement;
  header: HTMLElement;
  media: HTMLElement;
  workspace: HTMLElement;
  bottom: HTMLElement;
  outputPanel: HTMLDivElement;
  displayList: HTMLDivElement;
} {
  const root = document.createElement('section');
  root.className = 'stream-surface';
  refs.root = root;

  const header = document.createElement('header');
  header.className = 'stream-header';
  refs.header = header;

  const middle = document.createElement('section');
  middle.className = 'stream-middle';
  const media = document.createElement('section');
  media.className = 'panel media-pool stream-media-pool';
  refs.media = media;

  const middleSplitter = createStreamSplitter(refs, 'streamMiddleSplitter', 'vertical', 'Resize media and stream panes');
  const workspace = document.createElement('section');
  workspace.className = 'panel stream-workspace-pane';
  refs.workspace = workspace;
  middle.append(media, middleSplitter, workspace);

  const bottomSplitter = createStreamSplitter(refs, 'streamBottomSplitter', 'horizontal', 'Resize stream workspace and bottom pane');
  const bottom = document.createElement('section');
  bottom.className = 'panel stream-bottom-pane';
  refs.bottom = bottom;
  const outputPanel = document.createElement('div');
  outputPanel.className = 'output-panel stream-output-panel';
  refs.outputPanel = outputPanel;
  const displayList = document.createElement('div');
  displayList.className = 'display-list stream-display-list';
  refs.displayList = displayList;

  root.append(header, middle, bottomSplitter, bottom);

  return { root, header, media, workspace, bottom, outputPanel, displayList };
}
