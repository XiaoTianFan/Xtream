import { logSessionEvent } from '../../../shared/showOpenProfile';
import type { DirectorState, StreamCommand, StreamEnginePublicState, TransportCommand } from '../../../shared/types';

function createOperationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function checkpointPart(type: string): string {
  return type.replace(/-/g, '_');
}

export async function sendLoggedPatchTransport(
  command: TransportCommand,
  surface: string = 'patch',
): Promise<DirectorState> {
  const operationId = command.operationId ?? createOperationId('patch-transport');
  const commandWithOperation = { ...command, operationId };
  logSessionEvent({
    runId: operationId,
    checkpoint: `ui_patch_transport_${checkpointPart(command.type)}`,
    domain: 'patch',
    kind: 'operation',
    extra: {
      command: commandWithOperation,
      surface,
    },
  });
  return window.xtream.director.transport(commandWithOperation);
}

export async function sendLoggedStreamTransport(
  command: StreamCommand,
  surface: string = 'stream',
): Promise<StreamEnginePublicState> {
  const operationId = command.operationId ?? createOperationId('stream-transport');
  const commandWithOperation = { ...command, operationId };
  logSessionEvent({
    runId: operationId,
    checkpoint: `ui_stream_transport_${checkpointPart(command.type)}`,
    domain: 'stream',
    kind: 'operation',
    extra: {
      command: commandWithOperation,
      surface,
    },
  });
  return window.xtream.stream.transport(commandWithOperation);
}
