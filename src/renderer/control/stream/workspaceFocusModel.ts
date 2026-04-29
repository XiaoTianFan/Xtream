import type { SceneId } from '../../../shared/types';

/** Whether a scene row/card should show playback vs. edit chrome (matches list/flow + syncWorkspaceSceneSelection). */
export function sceneWorkspaceFocusFlags(
  sceneId: SceneId,
  playbackFocusSceneId: SceneId | undefined,
  sceneEditSceneId: SceneId | undefined,
): { playback: boolean; edit: boolean } {
  return {
    playback: playbackFocusSceneId !== undefined && sceneId === playbackFocusSceneId,
    edit: sceneEditSceneId !== undefined && sceneId === sceneEditSceneId,
  };
}
