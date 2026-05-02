/**
 * Serializable payload for in-app choice / alert modals (main → control renderer).
 * Must be structured-clone safe for IPC.
 */

export type ShellModalButtonVariant = 'default' | 'primary' | 'danger' | 'secondary';

export type ShellModalButtonDef = {
  label: string;
  variant?: ShellModalButtonVariant;
};

export type ShellModalOpenPayload = {
  correlationId: string;
  title: string;
  message: string;
  detail?: string;
  buttons: ShellModalButtonDef[];
  defaultId: number;
  cancelId: number;
};
