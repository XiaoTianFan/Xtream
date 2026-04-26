import { describe, expect, it } from 'vitest';
import { Director } from './director';

function prepareMode1ReadyDirector(director: Director): void {
  director.registerDisplay({
    id: 'display-0',
    fullscreen: false,
    layout: { type: 'split', slots: ['A', 'B'] },
    health: 'ready',
  });
  director.setSlotVideo('A', 'F:\\media\\a.mp4', 'file:///F:/media/a.mp4');
  director.setSlotVideo('B', 'F:\\media\\b.mp4', 'file:///F:/media/b.mp4');
  director.updateSlotMetadata({ slotId: 'A', durationSeconds: 20, ready: true });
  director.updateSlotMetadata({ slotId: 'B', durationSeconds: 20, ready: true });
  director.setAudioFile('F:\\media\\mix.wav', 'file:///F:/media/mix.wav');
  director.updateAudioMetadata({ durationSeconds: 20, ready: true });
}

describe('Director', () => {
  it('starts paused with two default video slots and no displays', () => {
    const director = new Director(() => 1000);
    const state = director.getState();

    expect(state.paused).toBe(true);
    expect(Object.keys(state.slots)).toEqual(['A', 'B']);
    expect(state.displays).toEqual({});
  });

  it('advances playback time from the shared anchor while playing', () => {
    let now = 1000;
    const director = new Director(() => now);
    prepareMode1ReadyDirector(director);

    director.applyTransport({ type: 'play' });
    now = 3500;

    expect(director.getPlaybackTimeSeconds()).toBe(2.5);
  });

  it('freezes offset when paused', () => {
    let now = 1000;
    const director = new Director(() => now);
    prepareMode1ReadyDirector(director);

    director.applyTransport({ type: 'play' });
    now = 2200;
    director.applyTransport({ type: 'pause' });
    now = 9000;

    expect(director.getPlaybackTimeSeconds()).toBe(1.2);
  });

  it('tracks display windows by registry id', () => {
    const director = new Director(() => 1000);

    director.registerDisplay({
      id: 'display-2',
      fullscreen: false,
      layout: { type: 'single', slot: 'A' },
      health: 'starting',
    });

    expect(director.getState().displays['display-2']).toMatchObject({
      id: 'display-2',
      layout: { type: 'single', slot: 'A' },
    });
  });

  it('updates a display layout without replacing other display state', () => {
    const director = new Director(() => 1000);

    director.registerDisplay({
      id: 'display-0',
      fullscreen: true,
      layout: { type: 'single', slot: 'A' },
      health: 'ready',
      lastDriftSeconds: 0.01,
    });

    director.updateDisplayLayout('display-0', { type: 'split', slots: ['A', 'B'] });

    expect(director.getState().displays['display-0']).toMatchObject({
      fullscreen: true,
      health: 'ready',
      lastDriftSeconds: 0.01,
      layout: { type: 'split', slots: ['A', 'B'] },
    });
  });

  it('stores video files per slot and resets readiness until metadata arrives', () => {
    const director = new Director(() => 1000);

    const slot = director.setSlotVideo('A', 'F:\\media\\a.mp4', 'file:///F:/media/a.mp4');

    expect(slot).toMatchObject({
      id: 'A',
      videoPath: 'F:\\media\\a.mp4',
      videoUrl: 'file:///F:/media/a.mp4',
      ready: false,
    });
  });

  it('updates slot metadata and longest-video duration', () => {
    const director = new Director(() => 1000);

    director.setSlotVideo('A', 'F:\\media\\a.mp4', 'file:///F:/media/a.mp4');
    director.updateSlotMetadata({
      slotId: 'A',
      durationSeconds: 12.5,
      ready: true,
    });

    expect(director.getState().slots.A).toMatchObject({
      ready: true,
      durationSeconds: 12.5,
    });
    expect(director.getState().durationSeconds).toBe(12.5);
  });

  it('stores an audio file and makes audio the duration authority', () => {
    const director = new Director(() => 1000);

    const audio = director.setAudioFile('F:\\media\\mix.wav', 'file:///F:/media/mix.wav');
    director.updateAudioMetadata({
      durationSeconds: 20,
      ready: true,
    });

    expect(audio).toMatchObject({
      path: 'F:\\media\\mix.wav',
      url: 'file:///F:/media/mix.wav',
      ready: false,
    });
    expect(director.getState().audio).toMatchObject({
      ready: true,
      durationSeconds: 20,
    });
    expect(director.getState().durationPolicy).toBe('audio');
    expect(director.getState().durationSeconds).toBe(20);
  });

  it('preserves selected sink when clearing the audio file', () => {
    const director = new Director(() => 1000);

    director.setAudioSink({ path: 'main', sinkId: 'device-1', sinkLabel: 'HDMI Output' });
    director.setAudioFile('F:\\media\\mix.wav', 'file:///F:/media/mix.wav');
    director.clearAudioFile();

    expect(director.getState().audio).toMatchObject({
      sinkId: 'device-1',
      sinkLabel: 'HDMI Output',
      ready: false,
    });
    expect(director.getState().audio.path).toBeUndefined();
    expect(director.getState().durationPolicy).toBe('longest-video');
  });

  it('records control audio drift separately from display drift', () => {
    const director = new Director(() => 1000);

    director.ingestDrift({
      kind: 'control',
      observedSeconds: 1.05,
      directorSeconds: 1,
      driftSeconds: 0.05,
      reportedAtWallTimeMs: 2000,
    });

    expect(director.getState().audio.lastDriftSeconds).toBe(0.05);
  });

  it('blocks play until active rails are ready', () => {
    const director = new Director(() => 1000);

    director.applyTransport({ type: 'play' });

    expect(director.getState().paused).toBe(true);
    expect(director.getState().readiness.ready).toBe(false);
    expect(director.getState().readiness.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });

  it('wraps playback time at director loop boundaries', () => {
    let now = 1000;
    const director = new Director(() => now);
    prepareMode1ReadyDirector(director);

    director.applyTransport({ type: 'set-loop', loop: { enabled: true, startSeconds: 2, endSeconds: 5 } });
    director.applyTransport({ type: 'seek', seconds: 4 });
    director.applyTransport({ type: 'play' });
    now = 3500;

    expect(director.getPlaybackTimeSeconds()).toBe(3.5);
  });

  it('creates display correction state and degrades repeated drift failures', () => {
    const director = new Director(() => 1000);
    director.registerDisplay({
      id: 'display-0',
      fullscreen: false,
      layout: { type: 'single', slot: 'A' },
      health: 'ready',
    });

    for (let index = 0; index < 4; index += 1) {
      director.ingestDrift({
        kind: 'display',
        displayId: 'display-0',
        observedSeconds: 1.5,
        directorSeconds: 1,
        driftSeconds: 0.5,
        reportedAtWallTimeMs: 2000 + index,
      });
    }

    expect(director.getState().displays['display-0']).toMatchObject({
      health: 'degraded',
    });
    expect(director.getState().corrections.displays['display-0']).toMatchObject({
      action: 'degraded',
    });
  });

  it('does not count warning-only drift as failed correction attempts', () => {
    const director = new Director(() => 1000);
    director.registerDisplay({
      id: 'display-0',
      fullscreen: false,
      layout: { type: 'single', slot: 'A' },
      health: 'ready',
    });

    for (let index = 0; index < 10; index += 1) {
      director.ingestDrift({
        kind: 'display',
        displayId: 'display-0',
        observedSeconds: 1.075,
        directorSeconds: 1,
        driftSeconds: 0.075,
        reportedAtWallTimeMs: 2000 + index,
      });
    }

    expect(director.getState().displays['display-0']).toMatchObject({
      health: 'ready',
    });
    expect(director.getState().corrections.displays['display-0']).toMatchObject({
      action: 'none',
      reason: 'Drift is above warning threshold but within correction tolerance.',
    });
  });

  it('resets failed correction attempts after drift returns within tolerance', () => {
    const director = new Director(() => 1000);
    director.registerDisplay({
      id: 'display-0',
      fullscreen: false,
      layout: { type: 'single', slot: 'A' },
      health: 'ready',
    });

    director.ingestDrift({
      kind: 'display',
      displayId: 'display-0',
      observedSeconds: 1.5,
      directorSeconds: 1,
      driftSeconds: 0.5,
      reportedAtWallTimeMs: 2000,
    });
    director.ingestDrift({
      kind: 'display',
      displayId: 'display-0',
      observedSeconds: 1.02,
      directorSeconds: 1,
      driftSeconds: 0.02,
      reportedAtWallTimeMs: 3000,
    });
    director.ingestDrift({
      kind: 'display',
      displayId: 'display-0',
      observedSeconds: 1.5,
      directorSeconds: 1,
      driftSeconds: 0.5,
      reportedAtWallTimeMs: 4000,
    });

    expect(director.getState().displays['display-0']).toMatchObject({
      health: 'ready',
    });
    expect(director.getState().corrections.displays['display-0']).toMatchObject({
      action: 'seek',
    });
  });

  it('removes a display record and its correction state', () => {
    const director = new Director(() => 1000);
    director.registerDisplay({
      id: 'display-0',
      fullscreen: false,
      layout: { type: 'single', slot: 'A' },
      health: 'ready',
    });
    director.ingestDrift({
      kind: 'display',
      displayId: 'display-0',
      observedSeconds: 1.5,
      directorSeconds: 1,
      driftSeconds: 0.5,
      reportedAtWallTimeMs: 2000,
    });

    director.removeDisplay('display-0');

    expect(director.getState().displays['display-0']).toBeUndefined();
    expect(director.getState().corrections.displays['display-0']).toBeUndefined();
  });

  it('uses an embedded slot as the audio source and duration authority', () => {
    const director = new Director(() => 1000);
    director.setSlotVideo('A', 'F:\\media\\a.mp4', 'file:///F:/media/a.mp4');
    director.updateSlotMetadata({ slotId: 'A', durationSeconds: 12, ready: true });

    const audio = director.setEmbeddedAudioSource({ slotId: 'A' });
    director.updateAudioMetadata({ durationSeconds: 12, ready: true });

    expect(audio).toMatchObject({
      sourceMode: 'embedded-slot',
      embeddedSlotId: 'A',
      ready: false,
    });
    expect(director.getState().durationPolicy).toBe('audio');
    expect(director.getState().durationSeconds).toBe(12);
    expect(director.getState().audio).toMatchObject({
      sourceMode: 'embedded-slot',
      embeddedSlotId: 'A',
      ready: true,
    });
  });

  it('blocks readiness when selected embedded audio slot has no video', () => {
    const director = new Director(() => 1000);

    director.setEmbeddedAudioSource({ slotId: 'A' });

    expect(director.getState().readiness.issues).toContainEqual(
      expect.objectContaining({
        target: 'audio',
        message: 'Selected embedded audio slot has no video selected.',
      }),
    );
  });

  it('stores independent left and right sink selections for mode 3', () => {
    const director = new Director(() => 1000);

    director.setAudioSink({ path: 'left', sinkId: 'hdmi-left', sinkLabel: 'HDMI Left' });
    director.setAudioSink({ path: 'right', sinkId: 'hdmi-right', sinkLabel: 'HDMI Right' });

    expect(director.getState().audio).toMatchObject({
      leftSinkId: 'hdmi-left',
      leftSinkLabel: 'HDMI Left',
      rightSinkId: 'hdmi-right',
      rightSinkLabel: 'HDMI Right',
    });
  });

  it('tracks physical split availability and fallback acceptance', () => {
    const director = new Director(() => 1000);

    director.updateAudioCapabilities({
      physicalSplitAvailable: false,
      fallbackAccepted: true,
    });

    expect(director.getState().audio).toMatchObject({
      physicalSplitAvailable: false,
      fallbackAccepted: true,
    });

    director.updateAudioCapabilities({
      physicalSplitAvailable: true,
    });

    expect(director.getState().audio).toMatchObject({
      physicalSplitAvailable: true,
      fallbackAccepted: true,
    });
  });

  it('serializes runtime state into a persisted show config', () => {
    const director = new Director(() => 1000);
    director.setAudioSink({ path: 'left', sinkId: 'left', sinkLabel: 'Left' });
    director.setSlotVideo('A', 'F:\\media\\a.mp4', 'file:///F:/media/a.mp4');
    director.registerDisplay({
      id: 'display-0',
      fullscreen: true,
      layout: { type: 'single', slot: 'A' },
      health: 'ready',
    });

    expect(director.createShowConfig('2026-04-26T00:00:00.000Z')).toMatchObject({
      schemaVersion: 1,
      mode: 1,
      slots: [{ id: 'A', videoPath: 'F:\\media\\a.mp4' }, { id: 'B' }],
      audio: {
        leftSinkId: 'left',
        leftSinkLabel: 'Left',
      },
      displays: [
        {
          fullscreen: true,
          layout: { type: 'single', slot: 'A' },
        },
      ],
    });
  });

  it('restores persisted show config without resurrecting runtime display ids', () => {
    const director = new Director(() => 1000);
    director.registerDisplay({
      id: 'display-old',
      fullscreen: false,
      layout: { type: 'single', slot: 'B' },
      health: 'ready',
    });

    director.restoreShowConfig(
      {
        schemaVersion: 1,
        savedAt: '2026-04-26T00:00:00.000Z',
        mode: 2,
        durationPolicy: 'audio',
        loop: { enabled: false, startSeconds: 0 },
        slots: [{ id: 'A', videoPath: 'F:\\media\\a.mp4' }],
        audio: {
          path: 'F:\\media\\mix.wav',
          fallbackAccepted: true,
        },
        displays: [{ fullscreen: true, layout: { type: 'single', slot: 'A' } }],
      },
      {
        slots: { A: 'file:///F:/media/a.mp4' },
        audio: 'file:///F:/media/mix.wav',
      },
    );

    expect(director.getState()).toMatchObject({
      paused: true,
      mode: 2,
      offsetSeconds: 0,
      slots: {
        A: {
          videoPath: 'F:\\media\\a.mp4',
          videoUrl: 'file:///F:/media/a.mp4',
          ready: false,
        },
      },
      audio: {
        path: 'F:\\media\\mix.wav',
        url: 'file:///F:/media/mix.wav',
        fallbackAccepted: true,
      },
      displays: {},
    });
  });
});
