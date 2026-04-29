import type { SceneLoopPolicy } from './types';

export type LoopTiming = {
  enabled: boolean;
  naturalDurationMs: number;
  loopStartMs: number;
  loopEndMs: number;
  loopDurationMs: number;
  totalDurationMs?: number;
};

function safeMs(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function resolveLoopTiming(policy: SceneLoopPolicy | undefined, naturalDurationMs: number): LoopTiming {
  const natural = safeMs(naturalDurationMs);
  if (!policy?.enabled) {
    return {
      enabled: false,
      naturalDurationMs: natural,
      loopStartMs: 0,
      loopEndMs: natural,
      loopDurationMs: natural,
      totalDurationMs: natural,
    };
  }

  const loopStartMs = safeMs(policy.range?.startMs);
  const loopEndMs = Math.max(loopStartMs, safeMs(policy.range?.endMs, natural));
  const loopDurationMs = Math.max(0, loopEndMs - loopStartMs);
  const totalDurationMs =
    policy.iterations.type === 'infinite' ? undefined : loopStartMs + loopDurationMs * Math.max(0, policy.iterations.count);

  return {
    enabled: true,
    naturalDurationMs: natural,
    loopStartMs,
    loopEndMs,
    loopDurationMs,
    totalDurationMs,
  };
}

export function mapElapsedToLoopPhase(elapsedMs: number, timing: LoopTiming): number {
  const elapsed = safeMs(elapsedMs);
  if (!timing.enabled || timing.loopDurationMs <= 0 || elapsed < timing.loopEndMs) {
    return elapsed;
  }
  return timing.loopStartMs + ((elapsed - timing.loopStartMs) % timing.loopDurationMs);
}

export function isElapsedWithinLoopTotal(elapsedMs: number, timing: LoopTiming): boolean {
  return timing.totalDurationMs === undefined || elapsedMs < timing.totalDurationMs;
}

export function createLoopValidationMessages(args: {
  policy: SceneLoopPolicy | undefined;
  label: string;
}): string[] {
  const { policy, label } = args;
  if (!policy?.enabled) {
    return [];
  }
  const messages: string[] = [];
  const start = policy.range?.startMs;
  const end = policy.range?.endMs;
  if (start !== undefined && start < 0) {
    messages.push(`${label} has negative loop start`);
  }
  if (end !== undefined && end < 0) {
    messages.push(`${label} has negative loop end`);
  }
  if (start !== undefined && end !== undefined && end <= start) {
    messages.push(`${label} has invalid loop range`);
  }
  if (policy.iterations.type === 'count' && policy.iterations.count <= 0) {
    messages.push(`${label} has non-positive loop count`);
  }
  return messages;
}
