import { NodeEditor, type BaseSchemes } from 'rete';
import { AreaPlugin } from 'rete-area-plugin';
import type { FlowPoint, FlowProjection, FlowRect } from './flowProjection';

export type FlowViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type FlowReteCanvasOptions = {
  initialViewport?: FlowViewport;
  onViewportChange?: (viewport: FlowViewport) => void;
};

export class FlowReteCanvas {
  readonly editor = new NodeEditor<BaseSchemes>();
  readonly area: AreaPlugin<BaseSchemes, never>;
  readonly content: HTMLDivElement;
  readonly overlay: SVGSVGElement;
  private viewportTimer: number | undefined;

  constructor(
    readonly container: HTMLElement,
    private readonly options: FlowReteCanvasOptions = {},
  ) {
    this.area = new AreaPlugin<BaseSchemes, never>(container);
    this.editor.use(this.area);
    this.content = document.createElement('div');
    this.content.className = 'stream-flow-content-layer';
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.classList.add('stream-flow-link-layer');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.content.append(this.overlay);
    this.area.area.content.add(this.content);
    this.area.addPipe((context) => {
      if (context.type === 'translated' || context.type === 'zoomed') {
        this.queueViewportChange();
      }
      return context;
    });
    const viewport = options.initialViewport;
    if (viewport) {
      void this.area.area.zoom(viewport.zoom || 1, 0, 0);
      void this.area.area.translate(viewport.x || 0, viewport.y || 0);
    }
  }

  getViewport(): FlowViewport {
    const transform = this.area.area.transform;
    return {
      x: Math.round(transform.x),
      y: Math.round(transform.y),
      zoom: Number((transform.k || 1).toFixed(3)),
    };
  }

  screenToFlow(event: MouseEvent | PointerEvent): FlowPoint {
    const bounds = this.container.getBoundingClientRect();
    const transform = this.area.area.transform;
    return {
      x: (event.clientX - bounds.left - transform.x) / transform.k,
      y: (event.clientY - bounds.top - transform.y) / transform.k,
    };
  }

  async zoomBy(factor: number): Promise<void> {
    const transform = this.area.area.transform;
    const bounds = this.container.getBoundingClientRect();
    await this.area.area.zoom(Math.max(0.25, Math.min(2.5, transform.k * factor)), bounds.width / 2, bounds.height / 2);
  }

  async resetView(): Promise<void> {
    await this.area.area.zoom(1, 0, 0);
    await this.area.area.translate(0, 0);
  }

  async fitToProjection(projection: FlowProjection): Promise<void> {
    const bounds = projection.bounds;
    const viewport = this.container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
      await this.resetView();
      return;
    }
    const pad = 96;
    const zoom = Math.max(0.35, Math.min(1.25, Math.min(viewport.width / (bounds.width + pad * 2), viewport.height / (bounds.height + pad * 2))));
    await this.area.area.zoom(zoom, 0, 0);
    await this.area.area.translate(pad - bounds.x * zoom, pad - bounds.y * zoom);
  }

  setOverlayBounds(bounds: FlowRect): void {
    const pad = 420;
    this.overlay.setAttribute('viewBox', `${bounds.x - pad} ${bounds.y - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`);
    this.overlay.style.left = `${bounds.x - pad}px`;
    this.overlay.style.top = `${bounds.y - pad}px`;
    this.overlay.style.width = `${bounds.width + pad * 2}px`;
    this.overlay.style.height = `${bounds.height + pad * 2}px`;
  }

  destroy(): void {
    if (this.viewportTimer !== undefined) {
      window.clearTimeout(this.viewportTimer);
    }
    this.area.destroy();
  }

  private queueViewportChange(): void {
    if (!this.options.onViewportChange) {
      return;
    }
    if (this.viewportTimer !== undefined) {
      window.clearTimeout(this.viewportTimer);
    }
    this.viewportTimer = window.setTimeout(() => {
      this.viewportTimer = undefined;
      this.options.onViewportChange?.(this.getViewport());
    }, 180);
  }
}
