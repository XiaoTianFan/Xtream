import type { PersistedStreamConfig } from '../../../shared/types';
import { createButton } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
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
  if (ctx.mode === 'list') {
    const addScene = createButton('', 'icon-button stream-workspace-add-scene', () => {
      void window.xtream.stream.edit({ type: 'create-scene', afterSceneId: ctx.selectedSceneId }).then((s) => {
        const idx = ctx.selectedSceneId ? s.stream.sceneOrder.indexOf(ctx.selectedSceneId) : -1;
        const newId = idx >= 0 ? s.stream.sceneOrder[idx + 1] : s.stream.sceneOrder[s.stream.sceneOrder.length - 1];
        if (newId) {
          ctx.setSelectedSceneId(newId);
        }
        ctx.requestRender();
      });
    });
    decorateIconButton(addScene, 'Plus', 'Add scene after selected row');
    tabRow.append(addScene);
  }
  const content = document.createElement('div');
  content.className = 'stream-workspace-content';
  content.append(ctx.mode === 'list' ? createStreamListMode(stream, ctx) : createStreamFlowMode(stream, ctx));
  panel.replaceChildren(tabRow, content);
}
