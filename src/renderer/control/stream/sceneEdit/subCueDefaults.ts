import { PATCH_COMPAT_SCENE_ID } from '../../../../shared/streamWorkspace';
import type {
  DisplayWindowState,
  DirectorState,
  PersistedAudioSubCueConfig,
  PersistedControlSubCueConfig,
  PersistedStreamConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  SubCueId,
  VirtualOutputState,
} from '../../../../shared/types';

const MAIN_OUTPUT_ID = 'output-main';
const MAIN_DISPLAY_ID = 'display-0';

export function buildDefaultAudioSubCue(
  id: SubCueId,
  state: DirectorState,
): PersistedAudioSubCueConfig {
  const mainOutput = pickMainOutputId(state.outputs);
  const firstAudio =
    Object.values(state.audioSources).find((a) => a.id)?.id ?? Object.keys(state.audioSources)[0] ?? '';

  return {
    id,
    kind: 'audio',
    audioSourceId: firstAudio,
    outputIds: mainOutput ? [mainOutput] : [],
    playbackRate: 1,
    pitchShiftSemitones: 0,
  };
}

export function buildDefaultVisualSubCue(id: SubCueId, state: DirectorState): PersistedVisualSubCueConfig {
  const firstVisual = Object.keys(state.visuals)[0];
  const mainDisplay = pickMainDisplay(state.displays);
  const targets = mainDisplay
    ? [{
        displayId: mainDisplay.id,
        zoneId: mainDisplay.layout.type === 'split' ? ('L' as const) : undefined,
      }]
    : [];

  return {
    id,
    kind: 'visual',
    visualId: firstVisual ?? '',
    targets,
    playbackRate: 1,
  };
}

function pickMainOutputId(outputs: Record<string, VirtualOutputState>): string | undefined {
  if (outputs[MAIN_OUTPUT_ID]) {
    return MAIN_OUTPUT_ID;
  }
  const outputIds = Object.keys(outputs).sort();
  return outputIds.find((outputId) => outputs[outputId]?.label?.toLowerCase().includes('main')) ?? outputIds[0];
}

function pickMainDisplay(displaysById: Record<string, DisplayWindowState>): DisplayWindowState | undefined {
  const displays = Object.values(displaysById)
    .filter((display) => display.health !== 'closed')
    .sort((left, right) => left.id.localeCompare(right.id));
  return displays.find((display) => display.id === MAIN_DISPLAY_ID) ??
    displays.find((display) => display.label?.toLowerCase().includes('main')) ??
    displays[0];
}

export function buildDefaultControlSubCue(stream: PersistedStreamConfig, sceneId: SceneId, id: SubCueId): PersistedControlSubCueConfig {
  const fallbackScene =
    stream.sceneOrder.find((sid) => sid !== PATCH_COMPAT_SCENE_ID && sid !== sceneId && stream.scenes[sid]) ?? stream.sceneOrder.find((sid) => sid !== sceneId && stream.scenes[sid]);

  const targetSceneOrSelf = fallbackScene ?? stream.sceneOrder.find((sid) => stream.scenes[sid]);

  const actionScene = targetSceneOrSelf ?? sceneId;

  return {
    id,
    kind: 'control',
    action: { type: 'stop-scene', sceneId: actionScene },
  };
}
