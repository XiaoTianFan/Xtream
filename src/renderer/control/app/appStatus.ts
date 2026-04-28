import type { MediaValidationIssue } from '../../../shared/types';

export function combineVisibleIssues(
  readinessIssues: MediaValidationIssue[],
  operationIssues: MediaValidationIssue[],
): MediaValidationIssue[] {
  const seen = new Set<string>();
  const combined: MediaValidationIssue[] = [];
  for (const issue of [...readinessIssues, ...operationIssues]) {
    const key = `${issue.severity}:${issue.target}:${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(issue);
  }
  return combined;
}
