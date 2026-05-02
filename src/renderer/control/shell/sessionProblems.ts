import type { DirectorState, MediaValidationIssue, StreamEnginePublicState } from '../../../shared/types';

export type SessionProblemStripItem = {
  key: string;
  domain: 'patch' | 'stream' | 'global';
  severity: 'error' | 'warning';
  text: string;
};

/** Heuristic: engine messages are plain strings; treat obvious soft copy as warning. */
export function severityForStreamEngineMessage(message: string): 'error' | 'warning' {
  const lower = message.toLowerCase();
  if (/\bwarning\b/.test(lower) || /\bdegraded\b/.test(lower)) {
    return 'warning';
  }
  return 'error';
}

export function partitionMediaValidationIssues(issues: MediaValidationIssue[]): {
  patchMedia: MediaValidationIssue[];
  streamMedia: MediaValidationIssue[];
} {
  const streamMedia: MediaValidationIssue[] = [];
  const patchMedia: MediaValidationIssue[] = [];
  for (const issue of issues) {
    if (issue.target.startsWith('stream:')) {
      streamMedia.push(issue);
    } else {
      patchMedia.push(issue);
    }
  }
  return { patchMedia, streamMedia };
}

export function buildSessionProblemStripItems(args: {
  director: DirectorState | undefined;
  mediaIssues: MediaValidationIssue[];
  stream: StreamEnginePublicState | undefined;
}): SessionProblemStripItem[] {
  const out: SessionProblemStripItem[] = [];
  const seen = new Set<string>();

  const push = (item: SessionProblemStripItem): void => {
    if (seen.has(item.key)) {
      return;
    }
    seen.add(item.key);
    out.push(item);
  };

  const { director, mediaIssues, stream } = args;
  if (director) {
    for (const issue of director.readiness.issues) {
      push({
        key: `patch-readiness:${issue.severity}:${issue.target}:${issue.message}`,
        domain: 'patch',
        severity: issue.severity,
        text: `${issue.target}: ${issue.message}`,
      });
    }
  }

  const { patchMedia, streamMedia } = partitionMediaValidationIssues(mediaIssues);
  for (const issue of patchMedia) {
    push({
      key: `patch-media:${issue.severity}:${issue.target}:${issue.message}`,
      domain: 'patch',
      severity: issue.severity,
      text: `${issue.target}: ${issue.message}`,
    });
  }

  if (stream) {
    for (const msg of stream.validationMessages) {
      const severity = severityForStreamEngineMessage(msg);
      push({
        key: `stream-engine:${severity}:${msg}`,
        domain: 'stream',
        severity,
        text: msg,
      });
    }
    if (stream.playbackTimeline.status === 'invalid' && stream.playbackTimeline.notice) {
      const n = stream.playbackTimeline.notice;
      push({
        key: `stream-timeline:${n}`,
        domain: 'stream',
        severity: 'error',
        text: n,
      });
    }
  }

  for (const issue of streamMedia) {
    push({
      key: `stream-persist:${issue.severity}:${issue.message}`,
      domain: 'stream',
      severity: issue.severity,
      text: issue.message,
    });
  }

  const hasPatchError = out.some((i) => i.domain === 'patch' && i.severity === 'error');
  const hasStreamError = out.some((i) => i.domain === 'stream' && i.severity === 'error');
  if (hasPatchError && hasStreamError) {
    push({
      key: 'global:dual-workspace-errors',
      domain: 'global',
      severity: 'error',
      text: 'Patch and Stream both report blocking issues.',
    });
  }

  return out;
}
