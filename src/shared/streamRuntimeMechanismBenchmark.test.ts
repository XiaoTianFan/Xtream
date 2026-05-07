import { describe, expect, it } from 'vitest';

const DOCUMENTED_BENCHMARK_CASES = [
  'thread root derivation from `manual` and `at-timecode`',
  'auto-trigger scenes attach to the correct thread',
  'multiple auto followers create branches',
  'thread duration is longest branch',
  'missing predecessor branches become temporarily disabled and restore after repair',
  'disabled scenes remain visible and dimmed',
  'default main timeline orders manual-rooted threads by root scene order',
  'at-timecode-rooted threads are excluded from default main timeline duration',
  'at-timecode-rooted threads trigger from main timeline timecode in current mode',
  'launching later thread from reset does not mark earlier detached threads skipped',
  'launching a middle scene marks earlier same-thread scenes skipped',
  'paused manual-tail Play starts immediate next thread without reorder',
  'paused manual-tail launch of non-immediate thread reorders without changing total duration',
  'running main launch of unplayed later thread spawns parallel timeline and removes that thread from main',
  'following unplayed threads move forward on main after a thread is removed',
  'completed thread relaunch creates copy timeline',
  'same-thread earlier relaunch creates copy timeline',
  'same-thread later launch while running seeks that running instance forward',
  'already-running parallel thread later launch seeks that parallel timeline forward and leaves main intact',
  'global pause freezes all active timelines',
  'multi-timeline Play resumes all clocks by default',
  'Back to first clears parallel timelines and restores default main timeline',
  'main rail seek uses latest main timeline order',
  'main rail seek leaves parallel timelines running by default',
  'follow-relative seek applies main seek delta to parallel timelines with clamping',
  '`at-timecode` warning appears when authoring timecode trigger',
  'canonical scene state summary defaults to last instance',
  'auto-pause playback focus advances to the next ready manually triggered root scene in List mode order',
  'successful launch updates playback focus to the last launched scene by List mode relative position',
  'list rows, row progress, and scene edit pills use thread colors',
  'header timeline rail renders dim and bright segmented thread colors with matching proportions',
  'Flow cards render thread-colored metadata, focus styles, state styles, previews, progress, hover actions, and context menus',
  'Flow default layout places main threads left-to-right, centers longest branches, and places at-timecode side threads by relative timecode',
  'Flow dotted main curve passes through longest branches and animates glow during playback',
  'Gantt renders main and parallel timelines as view-only lanes with thread instance bars',
  'Patch playback behavior is unchanged',
];

const REGRESSION_MATRIX: Record<string, string[]> = {
  'thread root derivation from `manual` and `at-timecode`': ['src/shared/streamThreadPlan.test.ts'],
  'auto-trigger scenes attach to the correct thread': ['src/shared/streamThreadPlan.test.ts'],
  'multiple auto followers create branches': ['src/shared/streamThreadPlan.test.ts'],
  'thread duration is longest branch': ['src/shared/streamThreadPlan.test.ts'],
  'missing predecessor branches become temporarily disabled and restore after repair': ['src/shared/streamThreadPlan.test.ts'],
  'disabled scenes remain visible and dimmed': ['src/shared/streamThreadPlan.test.ts', 'src/renderer/control/stream/flowProjection.test.ts'],
  'default main timeline orders manual-rooted threads by root scene order': ['src/shared/streamSchedule.test.ts'],
  'at-timecode-rooted threads are excluded from default main timeline duration': ['src/shared/streamSchedule.test.ts'],
  'at-timecode-rooted threads trigger from main timeline timecode in current mode': ['src/main/streamEngine.test.ts'],
  'launching later thread from reset does not mark earlier detached threads skipped': ['src/main/streamEngine.test.ts'],
  'launching a middle scene marks earlier same-thread scenes skipped': ['src/main/streamEngine.test.ts'],
  'paused manual-tail Play starts immediate next thread without reorder': ['src/main/streamEngine.test.ts'],
  'paused manual-tail launch of non-immediate thread reorders without changing total duration': ['src/main/streamEngine.test.ts'],
  'running main launch of unplayed later thread spawns parallel timeline and removes that thread from main': ['src/main/streamEngine.test.ts'],
  'following unplayed threads move forward on main after a thread is removed': ['src/main/streamEngine.test.ts'],
  'completed thread relaunch creates copy timeline': ['src/main/streamEngine.test.ts'],
  'same-thread earlier relaunch creates copy timeline': ['src/main/streamEngine.test.ts'],
  'same-thread later launch while running seeks that running instance forward': ['src/main/streamEngine.test.ts'],
  'already-running parallel thread later launch seeks that parallel timeline forward and leaves main intact': ['src/main/streamEngine.test.ts'],
  'global pause freezes all active timelines': ['src/main/streamEngine.test.ts'],
  'multi-timeline Play resumes all clocks by default': ['src/main/streamEngine.test.ts'],
  'Back to first clears parallel timelines and restores default main timeline': ['src/main/streamEngine.test.ts'],
  'main rail seek uses latest main timeline order': ['src/main/streamEngine.test.ts'],
  'main rail seek leaves parallel timelines running by default': ['src/main/streamEngine.test.ts'],
  'follow-relative seek applies main seek delta to parallel timelines with clamping': ['src/main/streamEngine.test.ts'],
  '`at-timecode` warning appears when authoring timecode trigger': ['src/renderer/control/stream/threadColorUi.dom.test.ts'],
  'canonical scene state summary defaults to last instance': ['src/shared/streamWorkspace.test.ts', 'src/main/streamEngine.test.ts'],
  'auto-pause playback focus advances to the next ready manually triggered root scene in List mode order': ['src/main/streamEngine.test.ts'],
  'successful launch updates playback focus to the last launched scene by List mode relative position': ['src/main/streamEngine.test.ts'],
  'list rows, row progress, and scene edit pills use thread colors': ['src/renderer/control/stream/threadColorUi.dom.test.ts'],
  'header timeline rail renders dim and bright segmented thread colors with matching proportions': ['src/renderer/control/stream/streamHeader.test.ts'],
  'Flow cards render thread-colored metadata, focus styles, state styles, previews, progress, hover actions, and context menus': [
    'src/renderer/control/stream/flowProjection.test.ts',
    'src/renderer/control/stream/flowCards.dom.test.ts',
    'src/renderer/control/stream/threadColorUi.dom.test.ts',
  ],
  'Flow default layout places main threads left-to-right, centers longest branches, and places at-timecode side threads by relative timecode': [
    'src/renderer/control/stream/flowProjection.test.ts',
  ],
  'Flow dotted main curve passes through longest branches and animates glow during playback': [
    'src/renderer/control/stream/flowMode.dom.test.ts',
    'src/renderer/control/stream/flowProjection.test.ts',
  ],
  'Gantt renders main and parallel timelines as view-only lanes with thread instance bars': [
    'src/renderer/control/stream/ganttProjection.test.ts',
    'src/renderer/control/stream/ganttMode.dom.test.ts',
  ],
  'Patch playback behavior is unchanged': ['src/main/streamEngine.test.ts'],
};

describe('stream runtime mechanism benchmark coverage', () => {
  it('keeps every embedded Testing Benchmark case in the regression matrix', () => {
    expect(new Set(DOCUMENTED_BENCHMARK_CASES).size).toBe(DOCUMENTED_BENCHMARK_CASES.length);
    expect(Object.keys(REGRESSION_MATRIX)).toEqual(DOCUMENTED_BENCHMARK_CASES);
    for (const [benchmarkCase, tests] of Object.entries(REGRESSION_MATRIX)) {
      expect(tests.length, benchmarkCase).toBeGreaterThan(0);
    }
  });
});
