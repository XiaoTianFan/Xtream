import {
  Activity,
  Bug,
  CircleGauge,
  Columns2,
  FastForward,
  FileJson,
  Film,
  FolderOpen,
  Image,
  Monitor,
  Maximize2,
  Music,
  PanelLeft,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Repeat,
  Rewind,
  Save,
  Settings,
  SkipBack,
  SkipForward,
  SlidersVertical,
  StopCircle,
  Trash2,
  Volume2,
  VolumeX,
  X,
  createElement,
  type IconNode,
} from 'lucide';

export const icons = {
  Activity,
  Bug,
  CircleGauge,
  Columns2,
  FastForward,
  FileJson,
  Film,
  FolderOpen,
  Image,
  Monitor,
  Maximize2,
  Music,
  PanelLeft,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Repeat,
  Rewind,
  Save,
  Settings,
  SkipBack,
  SkipForward,
  SlidersVertical,
  StopCircle,
  Trash2,
  Volume2,
  VolumeX,
  X,
};

export type ControlIcon = keyof typeof icons;

export function createIcon(name: ControlIcon, label: string, size = 18): SVGElement {
  const icon = createElement(icons[name] as IconNode, {
    class: 'control-icon',
    'aria-hidden': 'true',
    width: size,
    height: size,
  });
  icon.dataset.iconLabel = label;
  return icon;
}

export function decorateIconButton(button: HTMLButtonElement, name: ControlIcon, label: string): void {
  button.classList.add('icon-button');
  button.title = label;
  button.setAttribute('aria-label', label);
  button.replaceChildren(createIcon(name, label), createSrOnlyText(label));
}

function createSrOnlyText(label: string): HTMLSpanElement {
  const text = document.createElement('span');
  text.className = 'sr-only';
  text.textContent = label;
  return text;
}
