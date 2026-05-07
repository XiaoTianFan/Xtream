/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import type { PersistedSceneConfig, PersistedStreamConfig } from '../../../shared/types';
import type { FlowSceneNode } from './flowProjection';
import { createFlowSceneCard } from './flowCards';

function scene(): PersistedSceneConfig {
  return {
    id: 'scene-a',
    title: 'Scene A',
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder: [],
    subCues: {},
  };
}

function stream(sceneConfig: PersistedSceneConfig): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: [sceneConfig.id],
    scenes: { [sceneConfig.id]: sceneConfig },
  };
}

function node(): FlowSceneNode {
  return {
    sceneId: 'scene-a',
    sceneNumber: 1,
    title: 'Scene A',
    rect: { x: 10, y: 20, width: 214, height: 136 },
    usesDefaultRect: true,
    status: 'ready',
    durationLabel: 'manual',
    temporarilyDisabled: false,
    authoringError: false,
    visualPreviewIds: [],
    audioCount: 0,
    controlCount: 0,
  };
}

describe('createFlowSceneCard interactions', () => {
  it('renders the add follower button outside the clipped visual card', () => {
    const sceneConfig = scene();
    const wrapper = createFlowSceneCard({
      stream: stream(sceneConfig),
      scene: sceneConfig,
      node: node(),
      directorState: undefined,
      playbackFocusSceneId: undefined,
      sceneEditSceneId: undefined,
      handlers: {
        selectScene: vi.fn(),
        editScene: vi.fn(),
        runScene: vi.fn(),
        addFollower: vi.fn(),
        showContextMenu: vi.fn(),
        beginDrag: vi.fn(),
        beginResize: vi.fn(),
      },
    });

    const card = wrapper.querySelector('.stream-flow-card');
    const add = wrapper.querySelector('.stream-flow-add-follower');

    expect(wrapper.classList.contains('stream-flow-card-node')).toBe(true);
    expect(wrapper.dataset.sceneId).toBe('scene-a');
    expect(card).not.toBeNull();
    expect(add).not.toBeNull();
    expect(card?.contains(add)).toBe(false);
  });

  it('stops card pointerdown from starting canvas pan and starts card drag', () => {
    const beginDrag = vi.fn();
    const sceneConfig = scene();
    const wrapper = createFlowSceneCard({
      stream: stream(sceneConfig),
      scene: sceneConfig,
      node: node(),
      directorState: undefined,
      playbackFocusSceneId: undefined,
      sceneEditSceneId: undefined,
      handlers: {
        selectScene: vi.fn(),
        editScene: vi.fn(),
        runScene: vi.fn(),
        addFollower: vi.fn(),
        showContextMenu: vi.fn(),
        beginDrag,
        beginResize: vi.fn(),
      },
    });
    const parentPointerDown = vi.fn();
    const parent = document.createElement('div');
    parent.addEventListener('pointerdown', parentPointerDown);
    parent.append(wrapper);
    const card = wrapper.querySelector<HTMLElement>('.stream-flow-card');

    card?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));

    expect(beginDrag).toHaveBeenCalledTimes(1);
    expect(parentPointerDown).not.toHaveBeenCalled();
  });

  it('stops button pointerdown from reaching canvas pan without starting card drag', () => {
    const beginDrag = vi.fn();
    const sceneConfig = scene();
    const wrapper = createFlowSceneCard({
      stream: stream(sceneConfig),
      scene: sceneConfig,
      node: node(),
      directorState: undefined,
      playbackFocusSceneId: undefined,
      sceneEditSceneId: undefined,
      handlers: {
        selectScene: vi.fn(),
        editScene: vi.fn(),
        runScene: vi.fn(),
        addFollower: vi.fn(),
        showContextMenu: vi.fn(),
        beginDrag,
        beginResize: vi.fn(),
      },
    });
    const parentPointerDown = vi.fn();
    const parent = document.createElement('div');
    parent.addEventListener('pointerdown', parentPointerDown);
    parent.append(wrapper);

    wrapper.querySelector('button')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));

    expect(beginDrag).not.toHaveBeenCalled();
    expect(parentPointerDown).not.toHaveBeenCalled();
  });

  it('runs add follower from the external button without starting card drag', () => {
    const addFollower = vi.fn();
    const beginDrag = vi.fn();
    const sceneConfig = scene();
    const wrapper = createFlowSceneCard({
      stream: stream(sceneConfig),
      scene: sceneConfig,
      node: node(),
      directorState: undefined,
      playbackFocusSceneId: undefined,
      sceneEditSceneId: undefined,
      handlers: {
        selectScene: vi.fn(),
        editScene: vi.fn(),
        runScene: vi.fn(),
        addFollower,
        showContextMenu: vi.fn(),
        beginDrag,
        beginResize: vi.fn(),
      },
    });
    const parentPointerDown = vi.fn();
    const parent = document.createElement('div');
    parent.addEventListener('pointerdown', parentPointerDown);
    parent.append(wrapper);
    const add = wrapper.querySelector<HTMLButtonElement>('.stream-flow-add-follower');

    add?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    add?.click();

    expect(addFollower).toHaveBeenCalledTimes(1);
    expect(addFollower).toHaveBeenCalledWith('scene-a', { x: 266, y: 20 });
    expect(beginDrag).not.toHaveBeenCalled();
    expect(parentPointerDown).not.toHaveBeenCalled();
  });
});
