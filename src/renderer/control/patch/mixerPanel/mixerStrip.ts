import type { AudioSourceId, DirectorState, VirtualOutputId, VirtualOutputState } from '../../../../shared/types';
import { quantizeBusFaderDb } from '../../meters/busFaderLaw';
import { createButton, createPanKnob } from '../../shared/dom';
import type { SelectedEntity } from '../../shared/types';
import { isMediaPoolDragEvent, readMediaPoolDragPayload } from '../mediaPool/dragDrop';
import { createAudioFader } from './audioFader';
import { showMixerOutputContextMenu } from './contextMenu';

export type MixerStripDeps = {
  isSelected: (type: SelectedEntity['type'], id: string) => boolean;
  soloOutputIds: ReadonlySet<VirtualOutputId>;
  setSoloOutputIds: (outputIds: Iterable<VirtualOutputId>) => void;
  selectEntity: (entity: SelectedEntity) => void;
  clearSelectionIf?: (entity: SelectedEntity) => void;
  renderState: (state: DirectorState) => void;
  refreshDetails: (state: DirectorState) => void;
  renderOutputs: (state: DirectorState) => void;
  syncOutputMeters: (state: DirectorState) => void;
  createOutputMeter: (output: VirtualOutputState) => HTMLElement;
  assignAudioSourceToOutput?: (outputId: VirtualOutputId, audioSourceId: AudioSourceId) => Promise<void> | void;
  rejectMediaPoolDrop?: (outputId: VirtualOutputId) => void;
};

function mountMixerStripContents(container: HTMLElement, output: VirtualOutputState, deps: MixerStripDeps): void {
  container.replaceChildren();
  const busPan = createPanKnob({
    name: `${output.label} bus pan`,
    value: output.pan ?? 0,
    variant: 'mixer',
    onChange: (pan) => {
      void window.xtream.outputs.update(output.id, { pan });
    },
  });
  const panWrap = document.createElement('div');
  panWrap.className = 'mixer-strip-pan';
  panWrap.append(busPan);
  const db = document.createElement('strong');
  db.className = 'mixer-db';
  db.textContent = `${quantizeBusFaderDb(output.busLevelDb).toFixed(1)} dB`;
  const body = document.createElement('div');
  body.className = 'mixer-strip-body';
  const track = document.createElement('div');
  track.className = 'mixer-strip-track';
  const meter = deps.createOutputMeter(output);
  const fader = createAudioFader(output, (busLevelDb) => {
    db.textContent = `${busLevelDb.toFixed(1)} dB`;
    void window.xtream.outputs.update(output.id, { busLevelDb });
  });
  track.append(meter, fader);
  body.append(track);
  const toggles = document.createElement('div');
  toggles.className = 'mixer-toggles';
  const isSoloed = deps.soloOutputIds.has(output.id);
  const solo = createButton('S', isSoloed ? 'secondary active' : 'secondary', () => {
    const nextSoloOutputIds = new Set(deps.soloOutputIds);
    if (nextSoloOutputIds.has(output.id)) {
      nextSoloOutputIds.delete(output.id);
    } else {
      nextSoloOutputIds.add(output.id);
    }
    deps.setSoloOutputIds(nextSoloOutputIds);
  });
  solo.title = `${isSoloed ? 'Unsolo' : 'Solo'} ${output.label}`;
  solo.setAttribute('aria-label', solo.title);
  solo.setAttribute('aria-pressed', String(isSoloed));
  const mute = createButton('M', output.muted ? 'secondary active' : 'secondary', async () => {
    await window.xtream.outputs.update(output.id, { muted: !output.muted });
    const nextState = await window.xtream.director.getState();
    deps.renderState(nextState);
    deps.renderOutputs(nextState);
    deps.syncOutputMeters(nextState);
  });
  mute.title = `${output.muted ? 'Unmute' : 'Mute'} ${output.label}`;
  mute.setAttribute('aria-label', mute.title);
  mute.setAttribute('aria-pressed', String(Boolean(output.muted)));
  toggles.append(solo, mute);
  toggles.addEventListener('click', (event) => event.stopPropagation());
  const label = document.createElement('span');
  label.className = 'mixer-label';
  label.textContent = output.label;
  const status = document.createElement('span');
  status.className = `status-dot ${output.ready ? 'ready' : output.sources.length > 0 ? 'blocked' : 'standby'}`;
  const labelRow = document.createElement('div');
  labelRow.className = 'mixer-label-row';
  labelRow.append(status, label);
  container.append(panWrap, db, body, toggles, labelRow);
}

function attachMixerStripSelectionHandlers(strip: HTMLElement, outputId: VirtualOutputId, deps: MixerStripDeps): void {
  strip.tabIndex = 0;
  strip.addEventListener('click', () => deps.selectEntity({ type: 'output', id: outputId }));
  strip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      deps.selectEntity({ type: 'output', id: outputId });
    }
  });
}

function attachMixerStripContextMenu(strip: HTMLElement, output: VirtualOutputState, deps: MixerStripDeps): void {
  strip.addEventListener('contextmenu', (event) =>
    showMixerOutputContextMenu(event, output, {
      clearSelectionIf: deps.clearSelectionIf,
      renderState: deps.renderState,
      refreshDetails: deps.refreshDetails,
    }),
  );
}

function attachMixerStripMediaDropHandlers(strip: HTMLElement, outputId: VirtualOutputId, deps: MixerStripDeps): void {
  if (!deps.assignAudioSourceToOutput) {
    return;
  }
  strip.classList.add('media-drop-target');
  strip.addEventListener('dragenter', (event) => {
    if (!isMediaPoolDragEvent(event)) {
      return;
    }
    event.preventDefault();
    if (readMediaPoolDragPayload(event.dataTransfer)?.type === 'audio-source') {
      strip.classList.add('media-drop-over');
    }
  });
  strip.addEventListener('dragover', (event) => {
    if (!isMediaPoolDragEvent(event)) {
      return;
    }
    event.preventDefault();
    const payload = readMediaPoolDragPayload(event.dataTransfer);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = payload?.type === 'audio-source' ? 'copy' : 'none';
    }
    strip.classList.toggle('media-drop-over', payload?.type === 'audio-source');
  });
  strip.addEventListener('dragleave', (event) => {
    if (!strip.contains(event.relatedTarget as Node | null)) {
      strip.classList.remove('media-drop-over');
    }
  });
  strip.addEventListener('drop', (event) => {
    if (!isMediaPoolDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    strip.classList.remove('media-drop-over');
    const payload = readMediaPoolDragPayload(event.dataTransfer);
    if (payload?.type === 'audio-source') {
      void deps.assignAudioSourceToOutput?.(outputId, payload.id);
    } else {
      deps.rejectMediaPoolDrop?.(outputId);
    }
  });
}

export function createMixerStrip(output: VirtualOutputState, deps: MixerStripDeps): HTMLElement {
  const strip = document.createElement('article');
  strip.className = `mixer-strip${deps.isSelected('output', output.id) ? ' selected' : ''}${deps.soloOutputIds.has(output.id) ? ' solo' : ''}`;
  strip.dataset.outputStrip = output.id;
  attachMixerStripSelectionHandlers(strip, output.id, deps);
  attachMixerStripContextMenu(strip, output, deps);
  attachMixerStripMediaDropHandlers(strip, output.id, deps);
  mountMixerStripContents(strip, output, deps);
  return strip;
}

export function createOutputDetailMixerStrip(output: VirtualOutputState, deps: MixerStripDeps): HTMLElement {
  const strip = document.createElement('article');
  strip.className = `mixer-strip mixer-strip--detail${deps.isSelected('output', output.id) ? ' selected' : ''}${deps.soloOutputIds.has(output.id) ? ' solo' : ''}`;
  strip.dataset.outputStrip = output.id;
  attachMixerStripSelectionHandlers(strip, output.id, deps);
  attachMixerStripContextMenu(strip, output, deps);
  attachMixerStripMediaDropHandlers(strip, output.id, deps);
  mountMixerStripContents(strip, output, deps);
  return strip;
}
