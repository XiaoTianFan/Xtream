import { decorateIconButton } from '../shared/icons';
import { patchElements as elements } from './elements';

export function installPatchIcons(): void {
  decorateIconButton(elements.playButton, 'Play', 'Play');
  decorateIconButton(elements.pauseButton, 'Pause', 'Pause');
  decorateIconButton(elements.stopButton, 'StopCircle', 'Stop');
  decorateIconButton(elements.loopToggleButton, 'Repeat', 'Loop settings');
  decorateIconButton(elements.saveShowButton, 'Save', 'Save show');
  decorateIconButton(elements.saveShowAsButton, 'FileJson', 'Save show as');
  decorateIconButton(elements.openShowButton, 'FolderOpen', 'Open show');
  decorateIconButton(elements.createShowButton, 'Plus', 'Create show project');
  decorateIconButton(elements.addVisualsButton, 'Plus', 'Add visuals');
  decorateIconButton(elements.visualPoolLayoutToggleButton, 'LayoutGrid', 'Show grid view');
  decorateIconButton(elements.liveGridPreviewToggleButton, 'Play', 'Live previews in grid');
  decorateIconButton(elements.createDisplayButton, 'Plus', 'Add display');
  decorateIconButton(elements.createOutputButton, 'Plus', 'Create output');
  decorateIconButton(elements.expandMixerButton, 'Maximize2', 'Expand mixer');
}
