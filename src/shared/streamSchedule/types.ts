import type {
  AudioSourceId,
  CalculatedStreamTimeline,
  DisplayZoneId,
  SceneId,
  StreamMainTimelineSegment,
  SubCueId,
  VisualId,
  VirtualOutputId,
} from '../types';
import type { VisualSubCueMediaInfo } from '../visualSubCueTiming';

export type ValidateStreamContentContext = {
  visuals?: ReadonlySet<VisualId>;
  audioSources?: ReadonlySet<AudioSourceId>;
  outputs?: ReadonlySet<VirtualOutputId>;
  displayZones?: ReadonlyMap<string, ReadonlySet<DisplayZoneId>>;
  audioSourceLabels?: ReadonlyMap<AudioSourceId, string>;
  audioDurations?: ReadonlyMap<AudioSourceId, number>;
  visualLabels?: ReadonlyMap<VisualId, string>;
  visualMedia?: ReadonlyMap<VisualId, VisualSubCueMediaInfo>;
};

/** Structured authoring validation (disk + live context); used for messages, UI highlights, and scene runtime `error`. */
export type StreamScheduleIssue = {
  severity: 'error' | 'warning';
  sceneId?: SceneId;
  subCueId?: SubCueId;
  message: string;
};

export type StreamScheduleEntry = {
  sceneId: SceneId;
  startMs?: number;
  durationMs?: number;
  endMs?: number;
  triggerKnown: boolean;
};

export type StreamSchedule = {
  status: 'valid' | 'invalid';
  entries: Record<SceneId, StreamScheduleEntry>;
  expectedDurationMs?: number;
  threadPlan?: CalculatedStreamTimeline['threadPlan'];
  mainSegments?: StreamMainTimelineSegment[];
  issues: StreamScheduleIssue[];
  notice?: string;
};
