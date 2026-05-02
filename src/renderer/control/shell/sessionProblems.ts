import type { DirectorState, MediaValidationIssue, StreamEnginePublicState } from '../../../shared/types';

export type SessionProblemStripItem = {
  key: string;
  domain: 'patch' | 'stream' | 'global';
  severity: 'error' | 'warning';
  text: string;
};

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
      push({
        key: `stream-engine:${msg}`,
        domain: 'stream',
        severity: 'error',
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

  return out;
}
