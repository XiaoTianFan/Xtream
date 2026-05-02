/** Tracks when the user dismissed the missing-media dialog so we do not immediately re-open the same set. */

export function missingMediaListSignature(items: { id: string }[]): string {
  return items.map((i) => i.id).sort().join('|');
}

let dismissedMissingSignature: string | undefined;

export function markDismissedMissingSignatureIfStillMissing(items: { id: string }[]): void {
  if (items.length > 0) {
    dismissedMissingSignature = missingMediaListSignature(items);
  } else {
    dismissedMissingSignature = undefined;
  }
}

/** Call when switching shows so a dismissed signature from another project cannot suppress prompts. */
export function resetMissingRelinkDismissState(): void {
  dismissedMissingSignature = undefined;
}

/** Returns whether we should auto-open the relink UI for this missing set. */
export function shouldAutoOpenMissingRelinkPrompt(items: { id: string }[]): boolean {
  if (items.length === 0) {
    dismissedMissingSignature = undefined;
    return false;
  }
  return dismissedMissingSignature !== missingMediaListSignature(items);
}
