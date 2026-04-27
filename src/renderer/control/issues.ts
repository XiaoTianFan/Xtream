import type { MediaValidationIssue } from '../../shared/types';

export function renderIssues(container: HTMLElement, issues: MediaValidationIssue[]): void {
  container.replaceChildren(
    ...issues.map((issue) => {
      const item = document.createElement('div');
      item.className = 'issue-item';
      item.textContent = `${issue.severity.toUpperCase()} ${issue.target}: ${issue.message}`;
      return item;
    }),
  );
}
