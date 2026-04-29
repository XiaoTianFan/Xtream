/** True when the event target is typing UI — workspace transport shortcuts must not fire. */
export function isWorkspaceTransportShortcutSuppressedTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Node)) {
    return false;
  }
  const el = target instanceof Element ? target : target.parentElement;
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') {
    return true;
  }
  if ((el instanceof HTMLElement && el.isContentEditable) || el.closest('[contenteditable="true"]')) {
    return true;
  }
  if (el.getAttribute('role') === 'textbox') {
    return true;
  }
  return false;
}
