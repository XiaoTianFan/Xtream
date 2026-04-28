import type { SurfaceController } from '../app/surfaceRouter';
import { createHint } from '../shared/dom';
import { createSurfaceCard, wrapSurfaceGrid } from '../shared/surfaceCards';
import { elements } from '../shell/elements';

export function createPerformanceSurfaceController(): SurfaceController {
  return {
    id: 'performance',
    createRenderSignature: () => 'performance:placeholder',
    render: () => renderPlaceholderSurface(),
  };
}

function renderPlaceholderSurface(): void {
  const card = createSurfaceCard('Performance');
  card.append(createHint('The live execution and monitoring view is planned. Use Patch for current show operation.'));
  elements.surfacePanel.replaceChildren(wrapSurfaceGrid(card));
}
