const activePanels = new WeakSet<HTMLElement>();

export function installInteractionLock(panel: HTMLElement): void {
  panel.addEventListener('pointerdown', () => activePanels.add(panel));
  const release = () => {
    window.setTimeout(() => activePanels.delete(panel), 0);
  };
  panel.addEventListener('pointerup', release);
  panel.addEventListener('pointercancel', release);
}

export function isPanelInteractionActive(panel: HTMLElement): boolean {
  if (activePanels.has(panel)) {
    return true;
  }
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLElement &&
    panel.contains(activeElement) &&
    activeElement.matches('select, input, textarea')
  );
}
