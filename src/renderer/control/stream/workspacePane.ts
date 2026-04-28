import type { PersistedStreamConfig } from '../../../shared/types';
import { createStreamFlowMode, type StreamFlowModeContext } from './flowMode';
import { createStreamListMode, type StreamListModeContext } from './listMode';
import { createStreamTabBar } from './streamDom';
import type { StreamMode } from './streamTypes';

export type StreamWorkspacePaneContext = StreamListModeContext &
  StreamFlowModeContext & {
    mode: StreamMode;
    setMode: (mode: StreamMode) => void;
    requestRender: () => void;
  };

export function renderStreamWorkspacePane(panel: HTMLElement, stream: PersistedStreamConfig, ctx: StreamWorkspacePaneContext): void {
  const tabs = createStreamTabBar(
    'Stream modes',
    [
      ['list', 'List'],
      ['flow', 'Flow'],
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
  content.append(ctx.mode === 'list' ? createStreamListMode(stream, ctx) : createStreamFlowMode(stream, ctx));
  panel.replaceChildren(tabRow, content);
}
