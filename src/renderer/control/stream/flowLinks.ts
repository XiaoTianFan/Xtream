import type { FlowLinkProjection, FlowMainCurve, FlowProjection, FlowRect, FlowWarningStub } from './flowProjection';

function centerRight(rect: FlowRect): { x: number; y: number } {
  return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
}

function centerLeft(rect: FlowRect): { x: number; y: number } {
  return { x: rect.x, y: rect.y + rect.height / 2 };
}

function curvePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(72, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function polylinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x - 8} ${p.y} L ${p.x + 8} ${p.y}`;
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function appendPath(svg: SVGSVGElement, className: string, d: string, color?: string): SVGPathElement {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.classList.add(className);
  path.setAttribute('d', d);
  if (color) {
    path.style.setProperty('--stream-flow-link-color', color);
  }
  svg.append(path);
  return path;
}

function appendWarningStub(svg: SVGSVGElement, stub: FlowWarningStub, followerRect: FlowRect): void {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.classList.add('stream-flow-warning-stub');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(stub.rect.x));
  rect.setAttribute('y', String(stub.rect.y));
  rect.setAttribute('width', String(stub.rect.width));
  rect.setAttribute('height', String(stub.rect.height));
  rect.setAttribute('rx', '5');
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', String(stub.rect.x + 10));
  text.setAttribute('y', String(stub.rect.y + 27));
  text.textContent = stub.label;
  group.append(rect, text);
  svg.append(group);
  appendPath(svg, 'stream-flow-warning-link', curvePath(centerRight(stub.rect), centerLeft(followerRect)));
}

function renderMainCurve(svg: SVGSVGElement, curve: FlowMainCurve, running: boolean): void {
  if (curve.points.length === 0) {
    return;
  }
  const d = polylinePath(curve.points);
  appendPath(svg, 'stream-flow-main-curve', d);
  const glow = appendPath(svg, `stream-flow-main-curve-glow${running ? ' is-running' : ''}`, d);
  glow.setAttribute('pathLength', '1');
  glow.style.setProperty('--stream-flow-main-progress', String(curve.progress));
}

function renderTriggerLink(svg: SVGSVGElement, projection: FlowProjection, link: FlowLinkProjection): void {
  const predecessor = projection.nodesBySceneId[link.predecessorSceneId];
  const follower = projection.nodesBySceneId[link.followerSceneId];
  if (!predecessor || !follower) {
    return;
  }
  const path = appendPath(svg, 'stream-flow-trigger-link', curvePath(centerRight(predecessor.rect), centerLeft(follower.rect)), link.color?.bright);
  path.dataset.linkId = link.id;
}

export function renderFlowLinks(svg: SVGSVGElement, projection: FlowProjection, running: boolean): void {
  svg.replaceChildren();
  renderMainCurve(svg, projection.mainCurve, running);
  for (const link of projection.links) {
    renderTriggerLink(svg, projection, link);
  }
  for (const stub of projection.warningStubs) {
    const follower = projection.nodesBySceneId[stub.sceneId];
    if (follower) {
      appendWarningStub(svg, stub, follower.rect);
    }
  }
}
