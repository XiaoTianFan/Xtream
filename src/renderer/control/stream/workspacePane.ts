import type { PersistedStreamConfig } from '../../../shared/types';
import { createStreamFlowMode, type StreamFlowModeContext } from './flowMode';
import { createStreamGanttMode, type StreamGanttModeContext } from './ganttMode';
import { createStreamListMode, type StreamListModeContext } from './listMode';
import { createStreamTabBar } from './streamDom';
import type { StreamMode } from './streamTypes';

export type StreamWorkspacePaneContext = StreamListModeContext &
  StreamFlowModeContext &
  StreamGanttModeContext & {
    mode: StreamMode;
    setMode: (mode: StreamMode) => void;
    requestRender: () => void;
  };

function createModeContent(stream: PersistedStreamConfig, ctx: StreamWorkspacePaneContext): HTMLElement {
  if (ctx.mode === 'flow') {
    return createStreamFlowMode(stream, ctx);
  }
  if (ctx.mode === 'gantt') {
    return createStreamGanttMode(stream, ctx);
  }
  return createStreamListMode(stream, ctx);
}

export function renderStreamWorkspacePane(panel: HTMLElement, stream: PersistedStreamConfig, ctx: StreamWorkspacePaneContext): void {
  const tabs = createStreamTabBar(
    'Stream modes',
    [
      ['list', 'List'],
      ['flow', 'Flow'],
      ['gantt', 'Gantt'],
    ],
    ctx.mode,
    (next) => {
      ctx.setMode(next);
      ctx.requestRender();
    },
  );
  const tabRow = document.createElement('div');
  tabRow.className = 'stream-workspace-tab-row';
  tabRow.append(tabs);
  const content = document.createElement('div');
  content.className = 'stream-workspace-content';
  content.append(createModeContent(stream, ctx));
  panel.replaceChildren(tabRow, content);
}
