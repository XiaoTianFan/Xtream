import type { ShellModalOpenPayload } from '../../../shared/modalSpec';
import { elements } from './elements';

type LocalChoiceOpts = Omit<ShellModalOpenPayload, 'correlationId'>;

let shellModalUnmount: () => void = () => undefined;
let unsubShellModalInstall: (() => void) | undefined;

function buttonClassForVariant(variant?: string): string {
  switch (variant) {
    case 'primary':
      return 'shell-modal-btn--primary';
    case 'danger':
      return 'shell-modal-btn--danger';
    case 'secondary':
      return 'shell-modal-btn--secondary';
    default:
      return 'shell-modal-btn--secondary';
  }
}

export function teardownShellModalIfAny(): void {
  shellModalUnmount();
  shellModalUnmount = () => undefined;
}

type PresentChoicePayload = LocalChoiceOpts & { correlationId?: string };

function presentShellModal(payload: PresentChoicePayload, onComplete: (index: number) => void): void {
  teardownShellModalIfAny();

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const host = elements.shellModalHost;
  host.removeAttribute('hidden');
  host.hidden = false;
  host.dataset.open = 'true';
  host.tabIndex = -1;
  host.setAttribute('aria-hidden', 'false');
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');

  elements.appFrame.classList.add('shell-modal-blocking');

  const scrim = document.createElement('button');
  scrim.type = 'button';
  scrim.className = 'shell-modal-host__scrim';
  scrim.title = '';
  scrim.setAttribute('aria-label', 'Dismiss dialog');

  const panel = document.createElement('div');
  panel.className = 'shell-modal-host__panel';
  scrim.tabIndex = -1;

  const heading = document.createElement('h2');
  heading.className = 'shell-modal-host__title';
  heading.id = 'shellModalHeading';
  heading.textContent = payload.title;

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'shell-modal-host__body';

  const messageEl = document.createElement('p');
  messageEl.className = 'shell-modal-host__message';
  messageEl.textContent = payload.message;
  bodyWrap.append(messageEl);

  if (payload.detail) {
    const detailEl = document.createElement('pre');
    detailEl.className = 'shell-modal-host__detail';
    detailEl.textContent = payload.detail;
    bodyWrap.append(detailEl);
  }

  const footer = document.createElement('div');
  footer.className = 'shell-modal-host__footer';

  host.setAttribute('aria-labelledby', 'shellModalHeading');

  let concluded = false;
  const conclude = (index: number) => {
    if (concluded) {
      return;
    }
    concluded = true;
    scrim.removeEventListener('click', onBackdrop);
    host.removeEventListener('keydown', onModalKeyDown, true);
    host.removeEventListener('focusout', onHostFocusOut);
    shellModalUnmount = () => undefined;
    host.replaceChildren();
    host.hidden = true;
    host.setAttribute('hidden', '');
    delete host.dataset.open;
    host.setAttribute('aria-hidden', 'true');
    host.removeAttribute('role');
    host.removeAttribute('aria-modal');
    host.removeAttribute('aria-labelledby');
    elements.appFrame.classList.remove('shell-modal-blocking');
    onComplete(index);
    queueMicrotask(() => {
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    });
  };

  const onHostFocusOut = (event: FocusEvent) => {
    if (concluded) {
      return;
    }
    const next = event.relatedTarget;
    if (next && host.contains(next as Node)) {
      return;
    }
    queueMicrotask(() => {
      if (concluded) {
        return;
      }
      const buttons = footer.querySelectorAll<HTMLButtonElement>('button');
      const defBtn = buttons[payload.defaultId] ?? buttons[0];
      defBtn?.focus({ preventScroll: true });
    });
  };

  const onBackdrop = () => conclude(payload.cancelId);

  const onModalKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      conclude(payload.cancelId);
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const footerButtons = Array.from(footer.querySelectorAll<HTMLButtonElement>('button')).filter((b) => !b.disabled);
    if (footerButtons.length === 0) {
      return;
    }
    const first = footerButtons[0];
    const last = footerButtons[footerButtons.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  scrim.addEventListener('click', onBackdrop);
  host.tabIndex = -1;
  host.addEventListener('keydown', onModalKeyDown, true);
  host.addEventListener('focusout', onHostFocusOut);

  for (let i = 0; i < payload.buttons.length; i += 1) {
    const def = payload.buttons[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = buttonClassForVariant(def.variant);
    btn.textContent = def.label;
    btn.addEventListener('click', () => conclude(i));
    footer.append(btn);
  }

  panel.append(heading, bodyWrap, footer);
  host.replaceChildren(scrim, panel);

  shellModalUnmount = () => {
    conclude(payload.cancelId);
  };

  queueMicrotask(() => {
    const buttons = footer.querySelectorAll('button');
    const focusBtn = buttons[payload.defaultId] ?? buttons[0];
    focusBtn?.focus({ preventScroll: true });
  });
}

/** Main-process modal (IPC). Completes via `respond` IPC. */
function presentMainModal(payload: ShellModalOpenPayload): void {
  presentShellModal(payload, (idx) => {
    void window.xtream.shellModal.respond(payload.correlationId, idx);
  });
}

/** Blocking choice in renderer only (same visual system). */
export function shellShowChoiceModal(opts: LocalChoiceOpts): Promise<number> {
  return new Promise((resolve) => {
    presentShellModal({ ...opts }, resolve);
  });
}

export async function shellShowConfirm(modalTitle: string, message: string, detail?: string): Promise<boolean> {
  const idx = await shellShowChoiceModal({
    title: modalTitle,
    message,
    detail,
    buttons: [
      { label: 'Continue', variant: 'primary' },
      { label: 'Cancel', variant: 'secondary' },
    ],
    defaultId: 0,
    cancelId: 1,
  });
  return idx === 0;
}

export async function shellShowAlert(modalTitle: string, message: string, detail?: string): Promise<void> {
  await shellShowChoiceModal({
    title: modalTitle,
    message,
    detail,
    buttons: [{ label: 'OK', variant: 'primary' }],
    defaultId: 0,
    cancelId: 0,
  });
}

/** Subscribe to main-process prompts. Returns unsubscribe. Run once during control bootstrap. */
export function installShellModalPresenter(): () => void {
  if (unsubShellModalInstall) {
    return unsubShellModalInstall;
  }
  const unsubOpen = window.xtream.shellModal.onOpen((payload) => {
    presentMainModal(payload);
  });
  const unsubDismiss = window.xtream.shellModal.onDismissAllForWindowClose(() => {
    teardownShellModalIfAny();
  });
  unsubShellModalInstall = () => {
    unsubOpen();
    unsubDismiss();
    unsubShellModalInstall = undefined;
  };
  return unsubShellModalInstall;
}
