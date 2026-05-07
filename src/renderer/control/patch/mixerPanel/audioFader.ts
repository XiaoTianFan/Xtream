import type { VirtualOutputState } from '../../../../shared/types';
import {
  busDbToFaderSliderValue,
  faderMaxSteps,
  faderSliderMax,
  faderSliderMin,
  faderSliderValueToBusDb,
  faderZeroSliderValue,
  quantizeBusFaderDb,
} from '../../meters/busFaderLaw';
import { labelCountFromHeight, observeElementHeight, renderAudioFaderGraticule } from '../../meters/graticuleLayout';
import { createSlider, syncSliderProgress } from '../../shared/dom';

export function createAudioFader(output: VirtualOutputState, onChange: (busLevelDb: number) => void): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'audio-fader';
  const rail = document.createElement('div');
  rail.className = 'audio-fader-rail';
  const cap = document.createElement('div');
  cap.className = 'audio-fader-cap';
  const faderScale = document.createElement('div');
  faderScale.className = 'audio-fader-scale';
  faderScale.setAttribute('aria-hidden', 'true');
  const input = createSlider({
    min: faderSliderMin(),
    max: faderSliderMax(),
    step: '1',
    value: String(busDbToFaderSliderValue(quantizeBusFaderDb(output.busLevelDb))),
    ariaLabel: `${output.label} bus level`,
    className: 'audio-fader-input vertical-slider',
  });
  input.setAttribute('orient', 'vertical');
  syncAudioFaderPosition(wrapper, input);
  input.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.altKey) {
      event.preventDefault();
      const z = faderZeroSliderValue();
      input.value = String(z);
      syncSliderProgress(input);
      syncAudioFaderPosition(wrapper, input);
      onChange(quantizeBusFaderDb(faderSliderValueToBusDb(z)));
    }
  });
  input.addEventListener('input', () => {
    syncAudioFaderPosition(wrapper, input);
    onChange(quantizeBusFaderDb(faderSliderValueToBusDb(Number(input.value))));
  });
  wrapper.append(rail, cap, faderScale, input);
  observeElementHeight(wrapper, (h) => {
    renderAudioFaderGraticule(faderScale, labelCountFromHeight(h));
  });
  return wrapper;
}

function syncAudioFaderPosition(wrapper: HTMLElement, input: HTMLInputElement): void {
  const min = Number(input.min || 0);
  const max = Number(input.max || faderMaxSteps());
  const value = Number(input.value || 0);
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  wrapper.style.setProperty('--fader-position', `${Math.min(100, Math.max(0, percent))}%`);
}
