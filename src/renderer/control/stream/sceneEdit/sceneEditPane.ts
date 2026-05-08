import type {
  DirectorState,
  PersistedStreamConfig,
  PersistedAudioSubCueConfig,
  PersistedSubCueConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  StreamEnginePublicState,
  SubCueId,
} from '../../../../shared/types';
import { deriveStreamThreadColorMaps } from '../../../../shared/streamThreadColors';
import {
  audioTimingPatchToVisual,
  copyVisualTimingToAudio,
  findEligibleEmbeddedAudioTimingSubCueId,
  getActiveTimingLinkPair,
  hasLinkedTimingFields,
  visualTimingPatchToAudio,
} from '../../../../shared/subCueTimingLink';
import { createHint } from '../../shared/dom';
import type { SceneEditSelection } from '../streamTypes';
import { createAudioSubCueForm } from './audioSubCueForm';
import { createControlSubCueForm } from './controlSubCueForm';
import { createStreamSceneForm } from './sceneForm';
import { createSubCueRail, type SubCueRailDeps } from './subCueRail';
import { createVisualSubCueForm } from './visualSubCueForm';

export type SceneEditPaneDeps = SubCueRailDeps & {
  streamPublic: StreamEnginePublicState;
  isSceneRunning: boolean;
  duplicateScene: (sceneId: SceneId) => void;
  removeScene: (sceneId: SceneId) => void;
  authoringSceneHasError?: boolean;
  authoringSubCueIdsWithError?: ReadonlySet<SubCueId>;
};

export function createSceneEditPane(deps: SceneEditPaneDeps): HTMLElement {
  const {
    stream,
    scene,
    currentState,
    streamPublic,
    isSceneRunning,
    sceneEditSelection,
    setSceneEditSelection,
    duplicateScene,
    removeScene,
    getDirectorState,
    renderDirectorState,
    requestRender,
    authoringSceneHasError = false,
    authoringSubCueIdsWithError,
  } = deps;
  void streamPublic;
  let draftSubCues = scene.subCues;

  const wrap = document.createElement('section');
  wrap.className = 'stream-scene-edit';
  wrap.classList.toggle('is-locked', isSceneRunning);
  wrap.classList.toggle('stream-scene-edit--authoring-error', authoringSceneHasError);
  const threadColor = deriveStreamThreadColorMaps(streamPublic.playbackTimeline).bySceneId[scene.id];
  if (threadColor) {
    wrap.classList.add('stream-scene-edit--threaded');
    wrap.dataset.threadColor = threadColor.token;
    wrap.style.setProperty('--stream-thread-base', threadColor.base);
    wrap.style.setProperty('--stream-thread-bright', threadColor.bright);
    wrap.style.setProperty('--stream-thread-dim', threadColor.dim);
  }

  const rail = createSubCueRail({
    stream,
    scene,
    currentState,
    sceneEditSelection,
    setSceneEditSelection,
    editsDisabled: isSceneRunning,
    getDirectorState,
    renderDirectorState,
    requestRender,
    authoringSceneHasError,
    authoringSubCueIdsWithError,
  });

  const detail = document.createElement('div');
  detail.className = 'stream-scene-edit-detail';

  if (sceneEditSelection.kind === 'scene') {
    detail.append(createStreamSceneForm({ stream, scene, duplicateScene, removeScene }));
  } else {
    const sid = sceneEditSelection.subCueId;
    const sub = scene.subCues[sid];
    if (!sub) {
      detail.append(createHint('Sub-cue not found.'));
    } else if (sub.kind === 'audio') {
      detail.append(
        createAudioSubCueForm({
          sub,
          currentState,
          patchSubCue: (update) => patchSubCueWithTimingLink(sid, update),
          linkedVisualSub: linkedVisualSubForAudio(sid),
        }),
      );
    } else if (sub.kind === 'visual') {
      detail.append(
        createVisualSubCueForm({
          sceneId: scene.id,
          subCueId: sid,
          sub,
          currentState,
          patchSubCue: (update) => patchSubCueWithTimingLink(sid, update),
          timingLink: visualTimingLinkDeps(sid, sub),
        }),
      );
    } else {
      detail.append(
        createControlSubCueForm({
          stream,
          sceneId: scene.id,
          subCueId: sid,
          sub,
          currentState,
          patchSubCue: (update) => {
            void window.xtream.stream.edit({ type: 'update-subcue', sceneId: scene.id, subCueId: sid, update });
          },
        }),
      );
    }
  }

  if (isSceneRunning) {
    disableEditControls(detail);
  }

  wrap.append(rail, detail);
  return wrap;

  function patchSubCueWithTimingLink(subCueId: SubCueId, update: Partial<PersistedSubCueConfig>): void {
    const draftScene = { ...scene, subCues: draftSubCues };
    const link = getActiveTimingLinkPair(draftScene, currentState, subCueId);
    if (!link || !hasLinkedTimingFields(update)) {
      const subCue = draftSubCues[subCueId];
      if (subCue) {
        draftSubCues = { ...draftSubCues, [subCueId]: { ...subCue, ...update } as PersistedSubCueConfig };
      }
      void window.xtream.stream.edit({ type: 'update-subcue', sceneId: scene.id, subCueId, update });
      return;
    }

    const nextSubCues = { ...draftSubCues };
    const subCue = nextSubCues[subCueId];
    if (!subCue) {
      return;
    }
    nextSubCues[subCueId] = { ...subCue, ...update } as PersistedSubCueConfig;
    const counterpartId = subCueId === link.visualSubCueId ? link.audioSubCueId : link.visualSubCueId;
    const counterpart = nextSubCues[counterpartId];
    if (!counterpart) {
      void window.xtream.stream.edit({ type: 'update-subcue', sceneId: scene.id, subCueId, update });
      return;
    }
    const counterpartTimingUpdate =
      subCue.kind === 'visual'
        ? visualTimingPatchToAudio(update as Partial<PersistedVisualSubCueConfig>)
        : audioTimingPatchToVisual(update as Partial<PersistedAudioSubCueConfig>);
    nextSubCues[counterpartId] = { ...counterpart, ...counterpartTimingUpdate } as PersistedSubCueConfig;
    draftSubCues = nextSubCues;
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { subCues: nextSubCues } });
  }

  function visualTimingLinkDeps(subCueId: SubCueId, visualSub: PersistedVisualSubCueConfig): Parameters<typeof createVisualSubCueForm>[0]['timingLink'] {
    const draftScene = { ...scene, subCues: draftSubCues };
    const eligibleAudioSubCueId = findEligibleEmbeddedAudioTimingSubCueId(draftScene, currentState, subCueId);
    if (!eligibleAudioSubCueId) {
      return undefined;
    }
    const audioSub = draftSubCues[eligibleAudioSubCueId];
    if (!audioSub || audioSub.kind !== 'audio') {
      return undefined;
    }
    const active = getActiveTimingLinkPair(draftScene, currentState, subCueId)?.audioSubCueId === eligibleAudioSubCueId;
    return {
      audioSubCue: audioSub,
      linked: active,
      onToggle: (linked) => toggleVisualAudioTimingLink(subCueId, visualSub, eligibleAudioSubCueId, audioSub, linked),
    };
  }

  function linkedVisualSubForAudio(subCueId: SubCueId): PersistedVisualSubCueConfig | undefined {
    const draftScene = { ...scene, subCues: draftSubCues };
    const link = getActiveTimingLinkPair(draftScene, currentState, subCueId);
    if (!link) {
      return undefined;
    }
    const visualSub = draftSubCues[link.visualSubCueId];
    return visualSub?.kind === 'visual' ? visualSub : undefined;
  }

  function toggleVisualAudioTimingLink(
    visualSubCueId: SubCueId,
    visualSub: PersistedVisualSubCueConfig,
    audioSubCueId: SubCueId,
    audioSub: PersistedAudioSubCueConfig,
    linked: boolean,
  ): void {
    const nextSubCues = { ...draftSubCues };
    if (linked) {
      nextSubCues[visualSubCueId] = { ...visualSub, linkedTimingSubCueId: audioSubCueId };
      nextSubCues[audioSubCueId] = { ...audioSub, ...copyVisualTimingToAudio(visualSub), linkedTimingSubCueId: visualSubCueId };
    } else {
      nextSubCues[visualSubCueId] = { ...visualSub, linkedTimingSubCueId: undefined };
      nextSubCues[audioSubCueId] = { ...audioSub, linkedTimingSubCueId: undefined };
    }
    draftSubCues = nextSubCues;
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { subCues: nextSubCues } });
  }
}

function disableEditControls(root: HTMLElement): void {
  for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
    'input, select, textarea, button',
  )) {
    control.disabled = true;
  }
}
