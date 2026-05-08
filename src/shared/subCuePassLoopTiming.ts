import type {
  LoopIterations,
  PassIterations,
  SceneLoopPolicy,
  SubCueInnerLoopPolicy,
  SubCuePassPolicy,
} from './types';

export type NormalizedSubCueInnerLoop =
  | { enabled: false; range?: { startMs: number; endMs: number }; iterations: { type: 'count'; count: 0 } }
  | { enabled: true; range: { startMs: number; endMs: number }; iterations: LoopIterations; durationMs: number };

export type SubCuePassLoopTiming = {
  baseDurationMs: number;
  passDurationMs?: number;
  totalDurationMs?: number;
  pass: SubCuePassPolicy;
  innerLoop: NormalizedSubCueInnerLoop;
};

export type SubCuePassPhase = {
  passIndex: number;
  passElapsedMs: number;
  mediaElapsedMs: number;
  phaseZeroElapsedMs: number;
  insideInfiniteInnerLoop: boolean;
};

export type SubCueDurationClassification = 'finite' | 'indefinite-loop';

const DEFAULT_PASS: SubCuePassPolicy = { iterations: { type: 'count', count: 1 } };
const DISABLED_INNER_LOOP: NormalizedSubCueInnerLoop = {
  enabled: false,
  iterations: { type: 'count', count: 0 },
};

function safeMs(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function integerAtLeast(value: number | undefined, min: number): number {
  return Math.max(min, Math.round(Number.isFinite(value) ? (value as number) : min));
}

function clonePass(pass: SubCuePassPolicy): SubCuePassPolicy {
  return pass.iterations.type === 'infinite'
    ? { iterations: { type: 'infinite' } }
    : { iterations: { type: 'count', count: pass.iterations.count } };
}

function cloneInnerLoop(innerLoop: NormalizedSubCueInnerLoop): SubCueInnerLoopPolicy {
  if (!innerLoop.enabled) {
    return innerLoop.range
      ? { enabled: false, range: { ...innerLoop.range } }
      : { enabled: false };
  }
  return {
    enabled: true,
    range: { ...innerLoop.range },
    iterations:
      innerLoop.iterations.type === 'infinite'
        ? { type: 'infinite' }
        : { type: 'count', count: innerLoop.iterations.count },
  };
}

function clonePersistedInnerLoop(innerLoop: SubCueInnerLoopPolicy): SubCueInnerLoopPolicy {
  if (!innerLoop.enabled) {
    return innerLoop.range
      ? { enabled: false, range: { ...innerLoop.range } }
      : { enabled: false };
  }
  return {
    enabled: true,
    range: { ...innerLoop.range },
    iterations:
      innerLoop.iterations.type === 'infinite'
        ? { type: 'infinite' }
        : { type: 'count', count: innerLoop.iterations.count },
  };
}

export function normalizePassIterations(iterations: PassIterations | undefined): PassIterations {
  if (iterations?.type === 'infinite') {
    return { type: 'infinite' };
  }
  return { type: 'count', count: integerAtLeast(iterations?.count, 1) };
}

export function normalizeLoopIterations(iterations: LoopIterations | undefined): LoopIterations {
  if (iterations?.type === 'infinite') {
    return { type: 'infinite' };
  }
  return { type: 'count', count: integerAtLeast(iterations?.count, 0) };
}

export function normalizeSubCuePassPolicy(policy: SubCuePassPolicy | undefined): SubCuePassPolicy {
  return { iterations: normalizePassIterations(policy?.iterations) };
}

export function clampInnerLoopRange(
  range: { startMs?: number; endMs?: number } | undefined,
  baseDurationMs: number,
  minSpanMs = 1,
): { startMs: number; endMs: number } | undefined {
  const base = safeMs(baseDurationMs);
  if (!range || base <= 0) {
    return undefined;
  }
  const span = Math.max(0, Math.min(minSpanMs, base));
  const rawStart = safeMs(range.startMs);
  const rawEnd = range.endMs !== undefined && Number.isFinite(range.endMs) ? Math.max(0, range.endMs) : undefined;
  if (rawEnd !== undefined && rawEnd <= rawStart) {
    return undefined;
  }
  const start = Math.min(rawStart, Math.max(0, base - span));
  const end = Math.min(base, Math.max(start + span, rawEnd ?? base));
  return end > start ? { startMs: start, endMs: end } : undefined;
}

export function normalizeSubCueInnerLoopPolicy(
  policy: SubCueInnerLoopPolicy | undefined,
  baseDurationMs: number,
): NormalizedSubCueInnerLoop {
  const iterations = normalizeLoopIterations(policy?.enabled ? policy.iterations : undefined);
  const range = clampInnerLoopRange(policy?.range, baseDurationMs);
  if (!policy?.enabled || iterations.type === 'count' && iterations.count <= 0 || !range) {
    return {
      enabled: false,
      range,
      iterations: { type: 'count', count: 0 },
    };
  }
  return {
    enabled: true,
    range,
    iterations,
    durationMs: Math.max(0, range.endMs - range.startMs),
  };
}

export function migrateLegacySubCueLoopPolicy(policy: SceneLoopPolicy | undefined): {
  pass: SubCuePassPolicy;
  innerLoop: SubCueInnerLoopPolicy;
} {
  if (!policy?.enabled) {
    return { pass: clonePass(DEFAULT_PASS), innerLoop: { enabled: false } };
  }
  if (!policy.range) {
    return {
      pass:
        policy.iterations.type === 'infinite'
          ? { iterations: { type: 'infinite' } }
          : { iterations: { type: 'count', count: integerAtLeast(policy.iterations.count, 1) } },
      innerLoop: { enabled: false },
    };
  }
  const range = {
    startMs: safeMs(policy.range.startMs),
    ...(policy.range.endMs !== undefined ? { endMs: safeMs(policy.range.endMs) } : {}),
  };
  if (policy.iterations.type === 'infinite') {
    return {
      pass: clonePass(DEFAULT_PASS),
      innerLoop: { enabled: true, range, iterations: { type: 'infinite' } },
    };
  }
  return {
    pass: clonePass(DEFAULT_PASS),
    innerLoop: {
      enabled: true,
      range,
      iterations: { type: 'count', count: Math.max(0, integerAtLeast(policy.iterations.count, 1) - 1) },
    },
  };
}

export function normalizeSubCuePassLoopPolicies(args: {
  pass?: SubCuePassPolicy;
  innerLoop?: SubCueInnerLoopPolicy;
  legacyLoop?: SceneLoopPolicy;
  baseDurationMs?: number;
}): { pass: SubCuePassPolicy; innerLoop: SubCueInnerLoopPolicy } {
  const legacy = args.pass || args.innerLoop ? undefined : migrateLegacySubCueLoopPolicy(args.legacyLoop);
  let pass = normalizeSubCuePassPolicy(args.pass ?? legacy?.pass);
  const persistedInner = normalizePersistedInnerLoopPolicy(args.innerLoop ?? legacy?.innerLoop);

  if (pass.iterations.type === 'infinite' && persistedInner.enabled && persistedInner.iterations.type === 'infinite') {
    return {
      pass,
      innerLoop: persistedInner.range ? { enabled: false, range: { ...persistedInner.range } } : { enabled: false },
    };
  }
  if (persistedInner.enabled && persistedInner.iterations.type === 'infinite') {
    pass = clonePass(DEFAULT_PASS);
  }

  if (args.baseDurationMs !== undefined) {
    const inner = normalizeSubCueInnerLoopPolicy(persistedInner, args.baseDurationMs);
    return {
      pass,
      innerLoop: cloneInnerLoop(inner),
    };
  }

  return {
    pass,
    innerLoop: clonePersistedInnerLoop(persistedInner),
  };
}

function normalizePersistedInnerLoopPolicy(policy: SubCueInnerLoopPolicy | undefined): SubCueInnerLoopPolicy {
  const iterations = normalizeLoopIterations(policy?.enabled ? policy.iterations : undefined);
  const range = normalizePersistedInnerLoopRange(policy?.range);
  if (!policy?.enabled || iterations.type === 'count' && iterations.count <= 0 || !range) {
    return range ? { enabled: false, range } : { enabled: false };
  }
  return {
    enabled: true,
    range,
    iterations,
  };
}

function normalizePersistedInnerLoopRange(
  range: { startMs?: number; endMs?: number } | undefined,
): { startMs: number; endMs?: number } | undefined {
  if (!range) {
    return undefined;
  }
  const startMs = safeMs(range.startMs);
  const endMs = range.endMs !== undefined && Number.isFinite(range.endMs) ? Math.max(0, range.endMs) : undefined;
  if (endMs !== undefined && endMs <= startMs) {
    return undefined;
  }
  return endMs === undefined ? { startMs } : { startMs, endMs };
}

export function resolveSubCuePassLoopTiming(args: {
  pass?: SubCuePassPolicy;
  innerLoop?: SubCueInnerLoopPolicy;
  legacyLoop?: SceneLoopPolicy;
  baseDurationMs: number;
}): SubCuePassLoopTiming {
  const baseDurationMs = safeMs(args.baseDurationMs);
  let pass = normalizeSubCuePassPolicy(args.pass);
  let innerLoop = normalizeSubCueInnerLoopPolicy(args.innerLoop, baseDurationMs);

  if (!args.pass && !args.innerLoop && args.legacyLoop) {
    const migrated = migrateLegacySubCueLoopPolicy(args.legacyLoop);
    pass = normalizeSubCuePassPolicy(migrated.pass);
    innerLoop = normalizeSubCueInnerLoopPolicy(migrated.innerLoop, baseDurationMs);
  }

  if (pass.iterations.type === 'infinite' && innerLoop.enabled && innerLoop.iterations.type === 'infinite') {
    innerLoop = {
      enabled: false,
      range: innerLoop.range,
      iterations: { type: 'count', count: 0 },
    };
  } else if (innerLoop.enabled && innerLoop.iterations.type === 'infinite') {
    pass = clonePass(DEFAULT_PASS);
  }

  const passDurationMs =
    innerLoop.enabled && innerLoop.iterations.type === 'infinite'
      ? undefined
      : baseDurationMs + (innerLoop.enabled && innerLoop.iterations.type === 'count' ? innerLoop.durationMs * innerLoop.iterations.count : 0);
  const totalDurationMs =
    pass.iterations.type === 'infinite' || passDurationMs === undefined
      ? undefined
      : passDurationMs * pass.iterations.count;

  return {
    baseDurationMs,
    passDurationMs,
    totalDurationMs,
    pass,
    innerLoop,
  };
}

export function subCueDurationClassification(timing: SubCuePassLoopTiming): SubCueDurationClassification {
  return timing.totalDurationMs === undefined ? 'indefinite-loop' : 'finite';
}

export function isElapsedWithinSubCueTotal(elapsedMs: number, timing: SubCuePassLoopTiming): boolean {
  const elapsed = safeMs(elapsedMs);
  return timing.totalDurationMs === undefined || elapsed < timing.totalDurationMs;
}

export function mapPassElapsedToMediaElapsed(passElapsedMs: number, timing: SubCuePassLoopTiming): {
  mediaElapsedMs: number;
  insideInfiniteInnerLoop: boolean;
} {
  const base = timing.baseDurationMs;
  const passElapsed = safeMs(passElapsedMs);
  const inner = timing.innerLoop;
  if (!inner.enabled || inner.durationMs <= 0 || passElapsed < inner.range.endMs) {
    return { mediaElapsedMs: Math.min(passElapsed, base), insideInfiniteInnerLoop: false };
  }

  if (inner.iterations.type === 'infinite') {
    return {
      mediaElapsedMs: inner.range.startMs + ((passElapsed - inner.range.endMs) % inner.durationMs),
      insideInfiniteInnerLoop: true,
    };
  }

  const repeatEndMs = inner.range.endMs + inner.durationMs * inner.iterations.count;
  if (passElapsed < repeatEndMs) {
    return {
      mediaElapsedMs: inner.range.startMs + ((passElapsed - inner.range.endMs) % inner.durationMs),
      insideInfiniteInnerLoop: false,
    };
  }
  return {
    mediaElapsedMs: Math.min(base, passElapsed - inner.durationMs * inner.iterations.count),
    insideInfiniteInnerLoop: false,
  };
}

export function mapElapsedToSubCuePassPhase(elapsedMs: number, timing: SubCuePassLoopTiming): SubCuePassPhase {
  const elapsed = safeMs(elapsedMs);
  const passDurationMs = timing.passDurationMs;
  let passIndex = 0;
  let passElapsedMs = elapsed;
  let phaseZeroElapsedMs = 0;

  if (passDurationMs !== undefined && passDurationMs > 0) {
    const boundedElapsed =
      timing.totalDurationMs !== undefined
        ? Math.min(elapsed, Math.max(0, timing.totalDurationMs))
        : elapsed;
    passIndex = Math.floor(boundedElapsed / passDurationMs);
    if (timing.pass.iterations.type === 'count') {
      passIndex = Math.min(passIndex, Math.max(0, timing.pass.iterations.count - 1));
    }
    phaseZeroElapsedMs = passIndex * passDurationMs;
    passElapsedMs = boundedElapsed - phaseZeroElapsedMs;
    if (passElapsedMs >= passDurationMs && passDurationMs > 0) {
      passElapsedMs = passDurationMs;
    }
  }

  const mapped = mapPassElapsedToMediaElapsed(passElapsedMs, timing);
  return {
    passIndex,
    passElapsedMs,
    mediaElapsedMs: mapped.mediaElapsedMs,
    phaseZeroElapsedMs,
    insideInfiniteInnerLoop: mapped.insideInfiniteInnerLoop,
  };
}

export function createSubCuePassLoopValidationMessages(args: {
  pass: SubCuePassPolicy | undefined;
  innerLoop: SubCueInnerLoopPolicy | undefined;
  legacyLoop?: SceneLoopPolicy;
  baseDurationMs?: number;
  label: string;
}): string[] {
  const messages: string[] = [];
  const pass = args.pass;
  const inner = args.innerLoop;
  if (pass?.iterations.type === 'count' && (!Number.isInteger(pass.iterations.count) || pass.iterations.count < 1)) {
    messages.push(`${args.label} has invalid pass count`);
  }
  if (inner?.enabled && inner.iterations.type === 'count' && (!Number.isInteger(inner.iterations.count) || inner.iterations.count < 0)) {
    messages.push(`${args.label} has invalid loop count`);
  }
  if (inner?.enabled) {
    const authoredEndMs = inner.range.endMs;
    if (!Number.isFinite(inner.range.startMs) || authoredEndMs !== undefined && (!Number.isFinite(authoredEndMs) || authoredEndMs <= inner.range.startMs)) {
      if (authoredEndMs !== undefined || args.baseDurationMs === undefined) {
        messages.push(`${args.label} has invalid inner loop range`);
      }
    }
    if (args.baseDurationMs !== undefined && Number.isFinite(args.baseDurationMs)) {
      const base = Math.max(0, args.baseDurationMs);
      const endMs = inner.range.endMs ?? base;
      if (inner.range.startMs < 0 || endMs > base || endMs <= inner.range.startMs) {
        messages.push(`${args.label} inner loop range is outside the selected pass range`);
      }
    }
  }
  if (pass?.iterations.type === 'infinite' && inner?.enabled && inner.iterations.type === 'infinite') {
    messages.push(`${args.label} cannot use infinite pass and infinite inner loop together`);
  }
  if (inner?.enabled && inner.iterations.type === 'infinite' && pass?.iterations.type === 'count' && pass.iterations.count !== 1) {
    messages.push(`${args.label} loop infinity requires pass count 1`);
  }
  if (!args.pass && !args.innerLoop && args.legacyLoop?.enabled) {
    return messages;
  }
  return messages;
}
