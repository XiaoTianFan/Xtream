import type { SurfaceController } from '../app/surfaceRouter';
import { createHint } from '../shared/dom';
import { createSurfaceCard, wrapSurfaceGrid } from '../shared/surfaceCards';
import { elements } from '../shell/elements';

export function createStreamSurfaceController(): SurfaceController {
  return {
    id: 'stream',
    createRenderSignature: () => 'stream:placeholder',
    render: () => renderPlaceholderSurface(),
  };
}

function renderPlaceholderSurface(): void {
  const card = createSurfaceCard('Stream');
  card.append(createHint('Stream control is planned for the workspace roadmap. This placeholder does not alter show state.'));
  elements.surfacePanel.replaceChildren(wrapSurfaceGrid(card));
}
