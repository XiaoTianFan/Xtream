import type { CalculatedStreamTimeline, SceneId, StreamThreadId } from './types';

export type StreamThreadColor = {
  token: string;
  base: string;
  bright: string;
  dim: string;
};

export const STREAM_THREAD_COLORS: StreamThreadColor[] = [
  { token: 'thread-sage', base: '#7f927d', bright: '#a6b8a2', dim: 'rgb(127 146 125 / 0.20)' },
  { token: 'thread-teal', base: '#5c9ead', bright: '#86bfcb', dim: 'rgb(92 158 173 / 0.20)' },
  { token: 'thread-ochre', base: '#c29958', bright: '#d7b77a', dim: 'rgb(194 153 88 / 0.20)' },
  { token: 'thread-clay', base: '#b77a62', bright: '#d29b85', dim: 'rgb(183 122 98 / 0.20)' },
  { token: 'thread-rosewood', base: '#a96f78', bright: '#ca929a', dim: 'rgb(169 111 120 / 0.20)' },
  { token: 'thread-plum', base: '#8c7a99', bright: '#ad9cba', dim: 'rgb(140 122 153 / 0.20)' },
  { token: 'thread-steel', base: '#748895', bright: '#9aabb5', dim: 'rgb(116 136 149 / 0.20)' },
  { token: 'thread-moss', base: '#79885e', bright: '#9eab7b', dim: 'rgb(121 136 94 / 0.20)' },
  { token: 'thread-linen', base: '#aa9d82', bright: '#c7bda5', dim: 'rgb(170 157 130 / 0.20)' },
  { token: 'thread-copper', base: '#a97f5b', bright: '#cba17a', dim: 'rgb(169 127 91 / 0.20)' },
  { token: 'thread-slate', base: '#6f7d88', bright: '#95a2ac', dim: 'rgb(111 125 136 / 0.20)' },
  { token: 'thread-seafoam', base: '#6f9b91', bright: '#96bdb4', dim: 'rgb(111 155 145 / 0.20)' },
  { token: 'thread-olive', base: '#8f8f68', bright: '#b1b087', dim: 'rgb(143 143 104 / 0.20)' },
  { token: 'thread-mauve', base: '#987984', bright: '#ba9aa5', dim: 'rgb(152 121 132 / 0.20)' },
  { token: 'thread-cadet', base: '#667f94', bright: '#8da2b4', dim: 'rgb(102 127 148 / 0.20)' },
  { token: 'thread-umber', base: '#94725d', bright: '#b6937c', dim: 'rgb(148 114 93 / 0.20)' },
];

export function streamThreadColorForIndex(index: number): StreamThreadColor {
  return STREAM_THREAD_COLORS[Math.max(0, index) % STREAM_THREAD_COLORS.length];
}

export function deriveStreamThreadColorMaps(timeline: Pick<CalculatedStreamTimeline, 'threadPlan'> | undefined): {
  byThreadId: Record<StreamThreadId, StreamThreadColor>;
  bySceneId: Record<SceneId, StreamThreadColor>;
} {
  const byThreadId: Record<StreamThreadId, StreamThreadColor> = {};
  const bySceneId: Record<SceneId, StreamThreadColor> = {};
  const threads = timeline?.threadPlan?.threads ?? [];
  threads.forEach((thread, index) => {
    const color = streamThreadColorForIndex(index);
    byThreadId[thread.threadId] = color;
    for (const sceneId of thread.sceneIds) {
      bySceneId[sceneId] = color;
    }
  });
  return { byThreadId, bySceneId };
}
