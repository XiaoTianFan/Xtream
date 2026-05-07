import type {
  ControlProjectUiStreamState,
  DirectorState,
  PersistedStreamConfig,
  SceneId,
  StreamEnginePublicState,
} from '../../../../shared/types';
import type { SelectedEntity } from '../../shared/types';
import { snapshotDisplaysForStreamSignature } from '../streamSignature';
import type { SceneEditSelection } from '../streamTypes';
import type { StreamBottomPaneContext } from '../bottomPane';
import type { StreamWorkspacePaneContext } from '../workspacePane';

export function isStreamRuntimeVisualId(id: string): boolean {
  return id.startsWith('stream-visual:');
}

export function isStreamRuntimeAudioSourceId(id: string): boolean {
  return id.startsWith('stream-audio:');
}

export function stripRuntimeMediaFromState(state: DirectorState): DirectorState {
  const visualEntries = Object.entries(state.visuals).filter(([id]) => !isStreamRuntimeVisualId(id));
  const audioSourceEntries = Object.entries(state.audioSources).filter(([id]) => !isStreamRuntimeAudioSourceId(id));
  if (visualEntries.length === Object.keys(state.visuals).length && audioSourceEntries.length === Object.keys(state.audioSources).length) {
    return state;
  }
  return {
    ...state,
    visuals: Object.fromEntries(visualEntries),
    audioSources: Object.fromEntries(audioSourceEntries),
  };
}

export function outputTopologyDirectorSlice(state: DirectorState): unknown {
  return Object.values(state.outputs)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((output) => ({
      id: output.id,
      label: output.label,
      sinkId: output.sinkId,
      muted: output.muted,
      outputDelaySeconds: output.outputDelaySeconds,
      ready: output.ready,
      physicalRoutingAvailable: output.physicalRoutingAvailable,
      fallbackAccepted: output.fallbackAccepted,
      fallbackReason: output.fallbackReason,
      error: output.error,
      sources: output.sources.map((sel) => ({
        id: sel.id,
        audioSourceId: sel.audioSourceId,
        muted: sel.muted,
        solo: sel.solo,
      })),
    }));
}

export function createStructuralStreamRenderModel(state: StreamEnginePublicState | undefined): unknown {
  if (!state) {
    return undefined;
  }
  return {
    stream: createStreamContentRenderModel(state.stream),
    playbackStream: createStreamContentRenderModel(state.playbackStream),
    playbackTimeline: createStableTimelineRenderModel(state.playbackTimeline),
    validationMessages: state.validationMessages,
  };
}

function createStreamContentRenderModel(stream: PersistedStreamConfig): unknown {
  const { flowViewport: _flowViewport, scenes, ...rest } = stream;
  return {
    ...rest,
    scenes: Object.fromEntries(
      Object.entries(scenes).map(([id, scene]) => {
        const { flow: _flow, ...sceneWithoutFlow } = scene;
        return [id, sceneWithoutFlow];
      }),
    ),
  };
}

function createStableTimelineRenderModel(timeline: StreamEnginePublicState['playbackTimeline']): unknown {
  return {
    status: timeline.status,
    expectedDurationMs: timeline.expectedDurationMs,
    entries: timeline.entries,
    threadPlan: timeline.threadPlan,
    mainSegments: timeline.mainSegments,
    issues: timeline.issues,
    notice: timeline.notice,
  };
}

export function createStreamSurfaceRenderSignature(params: {
  directorState: DirectorState;
  streamState: StreamEnginePublicState | undefined;
  sceneEditSceneId: SceneId | undefined;
  playbackFocusSceneId: SceneId | undefined;
  sceneEditSelection: SceneEditSelection;
  mode: StreamWorkspacePaneContext['mode'];
  bottomTab: StreamBottomPaneContext['bottomTab'];
  detailPane: StreamBottomPaneContext['detailPane'];
  headerEditField: 'title' | 'note' | undefined;
  mediaPoolShellSignature: string | undefined;
}): string {
  const signatureState = stripRuntimeMediaFromState(params.directorState);
  return JSON.stringify({
    stream: createStructuralStreamRenderModel(params.streamState),
    sceneEditSceneId: params.sceneEditSceneId,
    playbackFocusSceneId: params.playbackFocusSceneId,
    sceneEditSelection: params.sceneEditSelection,
    mode: params.mode,
    bottomTab: params.bottomTab,
    detailPane: params.detailPane,
    headerEditField: params.headerEditField,
    mediaPool: params.mediaPoolShellSignature,
    director: {
      visuals: Object.values(signatureState.visuals).map((visual) => ({
        id: visual.id,
        label: visual.label,
        ready: visual.ready,
        durationSeconds: visual.durationSeconds,
        type: visual.type,
        kind: visual.kind,
        url: visual.kind === 'file' ? visual.url : undefined,
      })),
      audioSources: Object.values(signatureState.audioSources).map((source) => ({
        id: source.id,
        label: source.label,
        ready: source.ready,
        durationSeconds: source.durationSeconds,
        type: source.type,
      })),
      outputs: outputTopologyDirectorSlice(params.directorState),
      displays: snapshotDisplaysForStreamSignature(params.directorState.displays),
    },
  });
}

export function createSceneEditRenderModel(params: {
  streamState: StreamEnginePublicState;
  sceneEditSceneId: SceneId | undefined;
  currentState: DirectorState | undefined;
  selectedSceneRunning: boolean;
}): unknown {
  const stream = params.streamState.stream;
  const scene = params.sceneEditSceneId ? stream.scenes[params.sceneEditSceneId] : undefined;
  return {
    stream,
    validationMessages: params.streamState.validationMessages,
    selectedSceneRunning: params.selectedSceneRunning,
    media: params.currentState
      ? {
          visuals: Object.values(params.currentState.visuals)
            .filter((visual) => !isStreamRuntimeVisualId(visual.id))
            .map((visual) => ({ id: visual.id, label: visual.label, kind: visual.kind, type: visual.type })),
          audioSources: Object.values(params.currentState.audioSources)
            .filter((source) => !isStreamRuntimeAudioSourceId(source.id))
            .map((source) => ({ id: source.id, label: source.label, type: source.type })),
          outputs: Object.values(params.currentState.outputs).map((output) => ({ id: output.id, label: output.label })),
          displays: Object.values(params.currentState.displays).map((display) => ({ id: display.id, label: display.label, layout: display.layout })),
        }
      : undefined,
    selectedScene: scene?.id,
  };
}

export function createStreamProjectUiSnapshot(params: {
  mode: StreamWorkspacePaneContext['mode'];
  bottomTab: StreamBottomPaneContext['bottomTab'];
  selectedSceneId: SceneId | undefined;
  sceneEditSelection: SceneEditSelection;
  expandedListSceneIds: Iterable<SceneId>;
  layout: ControlProjectUiStreamState['layout'];
  detailPane: StreamBottomPaneContext['detailPane'];
}): ControlProjectUiStreamState {
  return {
    mode: params.mode,
    bottomTab: params.bottomTab,
    selectedSceneId: params.selectedSceneId,
    sceneEditSelection:
      params.sceneEditSelection.kind === 'subcue'
        ? { kind: 'subcue', subCueId: params.sceneEditSelection.subCueId }
        : { kind: 'scene' },
    expandedListSceneIds: [...params.expandedListSceneIds],
    layout: params.layout,
    detailPane: params.detailPane
      ? {
          type: params.detailPane.type,
          id: params.detailPane.id,
          returnTab: params.detailPane.returnTab,
        }
      : undefined,
  };
}
