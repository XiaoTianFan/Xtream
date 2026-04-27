import { describe, expect, it } from 'vitest';
import type { PersistedShowConfig } from '../shared/types';
import { Director } from './director';

function addReadyVideo(director: Director, id: string, durationSeconds: number): void {
  director.addVisuals([
    {
      id,
      label: id,
      type: 'video',
      path: `F:\\media\\${id}.mp4`,
      url: `file:///F:/media/${id}.mp4`,
    },
  ]);
  director.updateVisualMetadata({ visualId: id, durationSeconds, ready: true });
}

describe('Director', () => {
  it('starts paused with pool-native state and no displays', () => {
    const state = new Director(() => 1000).getState();
    expect(state.paused).toBe(true);
    expect(state.visuals).toEqual({});
    expect(state.displays).toEqual({});
    expect(state.outputs['output-main']).toMatchObject({ label: 'Main Output', sources: [] });
    expect(state.globalAudioMuteFadeOutSeconds).toBe(1);
    expect(state.globalDisplayBlackoutFadeOutSeconds).toBe(1);
  });

  it('advances playback time from the shared anchor while playing', () => {
    let now = 1000;
    const director = new Director(() => now);
    addReadyVideo(director, 'visual-a', 20);
    director.registerDisplay({ id: 'display-0', fullscreen: false, layout: { type: 'single', visualId: 'visual-a' }, health: 'ready' });
    director.applyTransport({ type: 'play' });
    now = 3500;
    expect(director.getPlaybackTimeSeconds()).toBe(2.5);
  });

  it('computes active timeline from assigned video visuals only', () => {
    const director = new Director(() => 1000);
    addReadyVideo(director, 'visual-short', 5);
    director.addVisuals([
      {
        id: 'visual-still',
        label: 'Still',
        type: 'image',
        path: 'F:\\media\\still.png',
        url: 'file:///F:/media/still.png',
      },
    ]);
    director.updateVisualMetadata({ visualId: 'visual-still', width: 100, height: 100, ready: true });
    director.registerDisplay({
      id: 'display-0',
      fullscreen: false,
      layout: { type: 'split', visualIds: ['visual-short', 'visual-still'] },
      health: 'ready',
    });
    expect(director.getState().activeTimeline).toMatchObject({
      durationSeconds: 5,
      assignedVideoIds: ['visual-short'],
      loopRangeLimit: { startSeconds: 0, endSeconds: 5 },
    });
  });

  it('uses active audio sources for timeline when no videos are assigned', () => {
    const director = new Director(() => 1000);
    const first = director.addAudioFileSource('F:\\media\\a.wav', 'file:///F:/media/a.wav');
    const second = director.addAudioFileSource('F:\\media\\b.wav', 'file:///F:/media/b.wav');
    director.updateVirtualOutput('output-main', {
      sources: [
        { audioSourceId: first.id, levelDb: 0 },
        { audioSourceId: second.id, levelDb: 0 },
      ],
    });
    director.updateAudioMetadata({ audioSourceId: first.id, durationSeconds: 10, ready: true });
    director.updateAudioMetadata({ audioSourceId: second.id, durationSeconds: 20, ready: true });
    director.registerDisplay({ id: 'display-0', fullscreen: false, layout: { type: 'single' }, health: 'ready' });
    expect(director.getState().activeTimeline).toMatchObject({
      durationSeconds: 20,
      activeAudioSourceIds: expect.arrayContaining([first.id, second.id]),
      loopRangeLimit: { startSeconds: 0, endSeconds: 20 },
    });
  });

  it('does not auto-route newly added audio sources', () => {
    const director = new Director(() => 1000);
    const source = director.addAudioFileSource('F:\\media\\a.wav', 'file:///F:/media/a.wav');
    expect(director.getState().outputs['output-main'].sources).toEqual([]);
    director.updateVirtualOutput('output-main', { sources: [{ audioSourceId: source.id, levelDb: -3, muted: true }], muted: true });
    expect(director.getState().outputs['output-main']).toMatchObject({
      muted: true,
      sources: [{ audioSourceId: source.id, levelDb: -3, muted: true }],
    });
  });

  it('splits a stereo audio source into virtual left and right mono records', () => {
    const director = new Director(() => 1000);
    const source = director.addAudioFileSource('F:\\media\\stereo.wav', 'file:///F:/media/stereo.wav');
    director.updateAudioMetadata({ audioSourceId: source.id, durationSeconds: 12, channelCount: 2, ready: true });

    const [left, right] = director.splitStereoAudioSource(source.id);

    expect(left).toMatchObject({
      label: 'Audio Source 1 L',
      type: 'external-file',
      path: 'F:\\media\\stereo.wav',
      channelCount: 1,
      channelMode: 'left',
      derivedFromAudioSourceId: source.id,
      durationSeconds: 12,
      ready: true,
    });
    expect(right).toMatchObject({
      label: 'Audio Source 1 R',
      channelCount: 1,
      channelMode: 'right',
      derivedFromAudioSourceId: source.id,
    });
    expect(director.getState().audioSources[source.id]).toMatchObject({ channelCount: 2, channelMode: 'stereo' });
    expect(director.createShowConfig().audioSources[left.id]).toMatchObject({
      channelMode: 'left',
      derivedFromAudioSourceId: source.id,
    });
  });

  it('does not split known mono or already-derived audio sources', () => {
    const director = new Director(() => 1000);
    const source = director.addAudioFileSource('F:\\media\\mono.wav', 'file:///F:/media/mono.wav');
    director.updateAudioMetadata({ audioSourceId: source.id, durationSeconds: 12, channelCount: 1, ready: true });

    expect(() => director.splitStereoAudioSource(source.id)).toThrow(/mono/i);

    director.updateAudioMetadata({ audioSourceId: source.id, durationSeconds: 12, channelCount: 2, ready: true });
    const [left] = director.splitStereoAudioSource(source.id);
    expect(() => director.splitStereoAudioSource(left.id)).toThrow(/already/i);
  });

  it('does not auto-create embedded audio sources when video metadata reports audio tracks', () => {
    const director = new Director(() => 1000);
    director.addVisuals([
      {
        id: 'visual-with-audio',
        label: 'Video With Audio',
        type: 'video',
        path: 'F:\\media\\video-with-audio.mp4',
        url: 'file:///F:/media/video-with-audio.mp4',
      },
    ]);
    const state = director.updateVisualMetadata({
      visualId: 'visual-with-audio',
      durationSeconds: 12,
      ready: true,
      hasEmbeddedAudio: true,
    });
    expect(state.visuals['visual-with-audio']).toMatchObject({ hasEmbeddedAudio: true });
    expect(state.audioSources['audio-source-embedded-visual-with-audio']).toBeUndefined();
  });

  it('creates representation embedded audio sources by explicit user choice', () => {
    const director = new Director(() => 1000);
    director.addVisuals([
      {
        id: 'visual-with-audio',
        label: 'Video With Audio',
        type: 'video',
        path: 'F:\\media\\video-with-audio.mp4',
        url: 'file:///F:/media/video-with-audio.mp4',
      },
    ]);
    director.updateVisualMetadata({
      visualId: 'visual-with-audio',
      durationSeconds: 12,
      ready: true,
      hasEmbeddedAudio: true,
    });
    const source = director.addEmbeddedAudioSource('visual-with-audio', 'representation');
    expect(source).toMatchObject({
      type: 'embedded-visual',
      visualId: 'visual-with-audio',
      extractionMode: 'representation',
      durationSeconds: 12,
      ready: true,
    });
  });

  it('records extracted embedded audio file state', () => {
    const director = new Director(() => 1000);
    director.addVisuals([
      {
        id: 'visual-with-audio',
        label: 'Video With Audio',
        type: 'video',
        path: 'F:\\media\\video-with-audio.mp4',
        url: 'file:///F:/media/video-with-audio.mp4',
      },
    ]);
    director.updateVisualMetadata({ visualId: 'visual-with-audio', durationSeconds: 12, ready: true, hasEmbeddedAudio: true });
    const pending = director.markEmbeddedAudioExtractionPending(
      'visual-with-audio',
      'F:\\project\\assets\\audio\\visual-with-audio.m4a',
      'file:///F:/project/assets/audio/visual-with-audio.m4a',
      'm4a',
    );
    expect(pending).toMatchObject({
      type: 'embedded-visual',
      extractionMode: 'file',
      extractedFormat: 'm4a',
      extractionStatus: 'pending',
      ready: false,
    });
    const ready = director.markEmbeddedAudioExtractionReady(
      'visual-with-audio',
      'F:\\project\\assets\\audio\\visual-with-audio.m4a',
      'file:///F:/project/assets/audio/visual-with-audio.m4a',
      'm4a',
      1234,
    );
    expect(ready).toMatchObject({
      extractionMode: 'file',
      extractionStatus: 'ready',
      extractedPath: 'F:\\project\\assets\\audio\\visual-with-audio.m4a',
      fileSizeBytes: 1234,
      ready: true,
    });
  });

  it('does not block readiness while extracted embedded audio is pending', () => {
    const director = new Director(() => 1000);
    director.addVisuals([
      {
        id: 'visual-with-audio',
        label: 'Video With Audio',
        type: 'video',
        path: 'F:\\media\\video-with-audio.mp4',
        url: 'file:///F:/media/video-with-audio.mp4',
      },
    ]);
    director.updateVisualMetadata({ visualId: 'visual-with-audio', durationSeconds: 12, ready: true, hasEmbeddedAudio: true });
    const source = director.markEmbeddedAudioExtractionPending(
      'visual-with-audio',
      'F:\\project\\assets\\audio\\visual-with-audio.m4a',
      'file:///F:/project/assets/audio/visual-with-audio.m4a',
      'm4a',
    );
    director.updateVirtualOutput('output-main', { sources: [{ audioSourceId: source.id, levelDb: 0 }] });
    director.registerDisplay({ id: 'display-0', fullscreen: false, layout: { type: 'single' }, health: 'ready' });

    const state = director.getState();
    expect(state.outputs['output-main'].error).toBeUndefined();
    expect(state.readiness.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', target: `audio-source:${source.id}` }),
    );
    expect(state.readiness.issues).not.toContainEqual(expect.objectContaining({ severity: 'error', target: `audio-source:${source.id}` }));
  });

  it('updates session global controls without persisting them to show config', () => {
    const director = new Director(() => 1000);
    const state = director.updateGlobalState({ globalAudioMuted: true, globalDisplayBlackout: true });
    expect(state).toMatchObject({ globalAudioMuted: true, globalDisplayBlackout: true });
    expect(director.createShowConfig()).not.toHaveProperty('globalAudioMuted');
    expect(director.createShowConfig()).not.toHaveProperty('globalDisplayBlackout');
  });

  it('persists global mute and blackout fade durations in show config', () => {
    const director = new Director(() => 1000);
    director.updateShowSettings({ globalAudioMuteFadeOutSeconds: 0.5, globalDisplayBlackoutFadeOutSeconds: 0.25 });
    expect(director.createShowConfig()).toMatchObject({
      globalAudioMuteFadeOutSeconds: 0.5,
      globalDisplayBlackoutFadeOutSeconds: 0.25,
    });
  });

  it('defaults fade durations to one second when a show file omits them', () => {
    const director = new Director(() => 1000);
    const minimal: PersistedShowConfig = {
      schemaVersion: 5,
      savedAt: '2026-01-01T00:00:00.000Z',
      audioExtractionFormat: 'm4a',
      loop: { enabled: false, startSeconds: 0 },
      visuals: {},
      audioSources: {},
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [],
          busLevelDb: 0,
        },
      },
      displays: [],
    };
    director.restoreShowConfig(minimal, { visuals: {}, audioSources: {} });
    expect(director.getState().globalAudioMuteFadeOutSeconds).toBe(1);
    expect(director.getState().globalDisplayBlackoutFadeOutSeconds).toBe(1);
  });

  it('allows loop and seek across the longest active timeline span', () => {
    const director = new Director(() => 1000);
    addReadyVideo(director, 'visual-a', 10);
    addReadyVideo(director, 'visual-b', 20);
    director.registerDisplay({
      id: 'display-0',
      fullscreen: false,
      layout: { type: 'split', visualIds: ['visual-a', 'visual-b'] },
      health: 'ready',
    });
    director.applyTransport({ type: 'set-loop', loop: { enabled: true, startSeconds: 12, endSeconds: 18 } });
    expect(director.getState().loop).toEqual({ enabled: true, startSeconds: 12, endSeconds: 18 });
    director.applyTransport({ type: 'seek', seconds: 15 });
    expect(director.getPlaybackTimeSeconds()).toBe(15);
    expect(director.getState().readiness.issues).not.toContainEqual(expect.objectContaining({ target: 'loop' }));
  });

  it('clamps invalid loop settings to the active timeline span', () => {
    const director = new Director(() => 1000);
    addReadyVideo(director, 'visual-a', 10);
    addReadyVideo(director, 'visual-b', 20);
    director.registerDisplay({
      id: 'display-0',
      fullscreen: false,
      layout: { type: 'split', visualIds: ['visual-a', 'visual-b'] },
      health: 'ready',
    });
    director.applyTransport({ type: 'set-loop', loop: { enabled: true, startSeconds: 22, endSeconds: 30 } });
    expect(director.getState().loop).toEqual({ enabled: true, startSeconds: 0, endSeconds: 20 });
    expect(director.getState().readiness.issues).toContainEqual(expect.objectContaining({ target: 'loop', severity: 'warning' }));
  });

  it('manages virtual output source assignments and readiness', () => {
    const director = new Director(() => 1000);
    const first = director.addAudioFileSource('F:\\media\\mix-a.wav', 'file:///F:/media/mix-a.wav');
    const second = director.addAudioFileSource('F:\\media\\mix-b.wav', 'file:///F:/media/mix-b.wav');
    const output = director.createVirtualOutput();
    director.updateVirtualOutput(output.id, {
      sources: [
        { audioSourceId: first.id, levelDb: -12 },
        { audioSourceId: second.id, levelDb: -6 },
      ],
      busLevelDb: -3,
      sinkId: 'hdmi-2',
      sinkLabel: 'HDMI 2',
    });
    director.updateAudioMetadata({ audioSourceId: first.id, durationSeconds: 10, ready: true });
    director.updateAudioMetadata({ audioSourceId: second.id, durationSeconds: 20, ready: true });
    expect(director.getState().outputs[output.id]).toMatchObject({
      sources: [
        { audioSourceId: first.id, levelDb: -12 },
        { audioSourceId: second.id, levelDb: -6 },
      ],
      busLevelDb: -3,
      sinkId: 'hdmi-2',
      ready: true,
    });
  });

  it('updates labels, meter, preview warnings, and audio source clear state', () => {
    const director = new Director(() => 1000);
    addReadyVideo(director, 'visual-a', 10);
    expect(director.updateVisual('visual-a', { label: 'Lobby Loop' }).label).toBe('Lobby Loop');
    const source = director.addAudioFileSource('F:\\media\\mix-a.wav', 'file:///F:/media/mix-a.wav');
    expect(director.updateAudioSource(source.id, { label: 'Room Mix' }).label).toBe('Room Mix');
    expect(director.clearAudioSource(source.id)).toMatchObject({ id: source.id, label: 'Room Mix', ready: false });
    const output = director.createVirtualOutput();
    let emitted = 0;
    director.on('state', () => {
      emitted += 1;
    });
    director.updateOutputMeter({
      outputId: output.id,
      lanes: [
        {
          id: `${output.id}:${source.id}:ch-1`,
          label: 'L',
          audioSourceId: source.id,
          channelIndex: 0,
          db: -12,
          clipped: false,
        },
      ],
      peakDb: -12,
      reportedAtWallTimeMs: 1000,
    });
    expect(emitted).toBe(0);
    expect(director.getState().outputs[output.id].meterDb).toBe(-12);
    expect(director.getState().outputs[output.id].meterLanes).toHaveLength(1);
    director.updatePreviewStatus({
      key: 'display:display-0:visual-a',
      displayId: 'display-0',
      visualId: 'visual-a',
      ready: false,
      error: 'Preview failed.',
      reportedAtWallTimeMs: 1000,
    });
    expect(director.getState().readiness.issues).toContainEqual(expect.objectContaining({ severity: 'warning', target: 'preview:display:display-0:visual-a' }));
  });

  it('does not degrade displays for modest repeated drift and recovers drift-only degradation', () => {
    const director = new Director(() => 1000);
    addReadyVideo(director, 'visual-a', 10);
    director.registerDisplay({ id: 'display-0', fullscreen: false, layout: { type: 'single', visualId: 'visual-a' }, health: 'ready' });
    for (let index = 0; index < 20; index += 1) {
      director.ingestDrift({
        kind: 'display',
        displayId: 'display-0',
        observedSeconds: 1.25,
        directorSeconds: 1,
        driftSeconds: 0.25,
        reportedAtWallTimeMs: 1000 + index,
      });
    }
    expect(director.getState().displays['display-0']).toMatchObject({ health: 'ready', lastDriftSeconds: 0.25 });
    director.ingestDrift({
      kind: 'display',
      displayId: 'display-0',
      observedSeconds: 1,
      directorSeconds: 1,
      driftSeconds: 0,
      frameRateFps: 59.8,
      reportedAtWallTimeMs: 1500,
    });
    expect(director.getState().displays['display-0'].lastFrameRateFps).toBe(59.8);

    for (let index = 0; index < 12; index += 1) {
      director.ingestDrift({
        kind: 'display',
        displayId: 'display-0',
        observedSeconds: 4,
        directorSeconds: 1,
        driftSeconds: 3,
        reportedAtWallTimeMs: 2000 + index,
      });
    }
    expect(director.getState().displays['display-0'].health).toBe('degraded');
    director.ingestDrift({
      kind: 'display',
      displayId: 'display-0',
      observedSeconds: 1,
      directorSeconds: 1,
      driftSeconds: 0,
      reportedAtWallTimeMs: 3000,
    });
    expect(director.getState().displays['display-0'].health).toBe('ready');
  });

  it('blocks output readiness on missing sources and routing fallback', () => {
    const director = new Director(() => 1000);
    const output = director.createVirtualOutput();
    director.updateVirtualOutput(output.id, {
      sources: [{ audioSourceId: 'missing', levelDb: 0 }],
      physicalRoutingAvailable: false,
      fallbackAccepted: false,
    });
    const issues = director.getState().readiness.issues;
    expect(issues).toContainEqual(expect.objectContaining({ target: `output:${output.id}` }));
  });

  it('applies pool-native presets over visuals', () => {
    const director = new Director(() => 1000);
    addReadyVideo(director, 'visual-a', 10);
    addReadyVideo(director, 'visual-b', 10);
    const displays = [
      { id: 'display-0', fullscreen: false, layout: { type: 'single' as const }, health: 'ready' as const },
      { id: 'display-1', fullscreen: false, layout: { type: 'single' as const }, health: 'ready' as const },
    ];
    let next = 0;
    director.applyPreset('two-displays', (layout) => ({ ...displays[next++], layout }));
    expect(director.getState().displays['display-0'].layout).toEqual({ type: 'single', visualId: 'visual-a' });
    expect(director.getState().displays['display-1'].layout).toEqual({ type: 'single', visualId: 'visual-b' });
  });

  it('serializes runtime state into schema v5', () => {
    const director = new Director(() => 1000);
    addReadyVideo(director, 'visual-a', 10);
    director.registerDisplay({
      id: 'display-0',
      fullscreen: true,
      layout: { type: 'single', visualId: 'visual-a' },
      health: 'ready',
    });
    expect(director.createShowConfig('2026-04-26T00:00:00.000Z')).toMatchObject({
      schemaVersion: 5,
      audioExtractionFormat: 'm4a',
      visuals: { 'visual-a': { id: 'visual-a', path: 'F:\\media\\visual-a.mp4', opacity: 1, brightness: 1, contrast: 1, playbackRate: 1 } },
      displays: [{ id: 'display-0', fullscreen: true, layout: { type: 'single', visualId: 'visual-a' } }],
    });
  });
});
