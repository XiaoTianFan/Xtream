import type { SurfaceController } from '../app/surfaceRouter';
import { createHint } from '../shared/dom';
import { createSurfaceCard, wrapSurfaceGrid } from '../shared/surfaceCards';
import { elements } from '../shell/elements';

export function createCueSurfaceController(): SurfaceController {
  return {
    id: 'cue',
    createRenderSignature: () => 'cue:placeholder',
    render: () => renderPlaceholderSurface(),
  };
}

function renderPlaceholderSurface(): void {
  const card = createSurfaceCard('Cue');
  card.append(createHint('Sequential cue control is planned for the cue-system roadmap. This placeholder does not alter show state.'));
  elements.surfacePanel.replaceChildren(wrapSurfaceGrid(card));
}
