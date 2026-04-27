---
name: Xtream Morandi-Tech System
colors:
  surface: '#131314'
  surface-dim: '#131314'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0f'
  surface-container-low: '#1b1c1c'
  surface-container: '#1f2020'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e4e2e2'
  on-surface-variant: '#c3c7ca'
  inverse-surface: '#e4e2e2'
  inverse-on-surface: '#303031'
  outline: '#8d9194'
  outline-variant: '#43474a'
  surface-tint: '#bcc8d0'
  primary: '#bcc8d0'
  on-primary: '#263238'
  primary-container: '#5e6a71'
  on-primary-container: '#deeaf2'
  inverse-primary: '#546067'
  secondary: '#93d2d1'
  on-secondary: '#003737'
  secondary-container: '#045252'
  on-secondary-container: '#85c3c3'
  tertiary: '#f7bd48'
  on-tertiary: '#412d00'
  tertiary-container: '#886200'
  on-tertiary-container: '#ffe6bd'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e4ec'
  primary-fixed-dim: '#bcc8d0'
  on-primary-fixed: '#111d23'
  on-primary-fixed-variant: '#3d484f'
  secondary-fixed: '#afeeed'
  secondary-fixed-dim: '#93d2d1'
  on-secondary-fixed: '#002020'
  on-secondary-fixed-variant: '#004f50'
  tertiary-fixed: '#ffdea6'
  tertiary-fixed-dim: '#f7bd48'
  on-tertiary-fixed: '#271900'
  on-tertiary-fixed-variant: '#5d4200'
  background: '#131314'
  on-background: '#e4e2e2'
  surface-variant: '#353535'
  bg-base: '#2A2E30'
  surface-muted: '#3A4042'
  surface-active: '#5E6A71'
  text-primary: '#F2F4F5'
  text-secondary: '#909DA1'
  accent-teal: '#5C9EAD'
  accent-ochre: '#C29958'
  status-critical: '#B34D4D'
  border-subtle: '#454B4E'
typography:
  timecode:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: -0.02em
  data-mono:
    fontFamily: Space Grotesk
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.01em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
  label-caps:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
spacing:
  unit: 4px
  compact: 2px
  gutter: 8px
  pane-padding: 12px
  header-height: 64px
  footer-height: 220px
---

# Xtream Design Specification (MVP & Future Expansion)

## 1. Product Vision
Xtream is a professional, high-density utility for live visual and audio routing/streaming in multi-screen/multi-output environments. It competes with tools like QLab and StageCue, prioritizing speed, reliability, and information density.

## 2. Visual Identity & Design Principles
*   **Aesthetic:** "Morandi-Technical." A sophisticated palette of muted, desaturated tones (Morandi) contrasted with high-visibility accents for active states and critical data.
*   **Geometry:** Strictly square. Zero rounded corners (`border-radius: 0`) across all elements (buttons, panels, inputs, containers) to emphasize a precise, "pro-tool" feel.
*   **Density:** Ultra-compact. Minimize whitespace while maintaining legibility. Use icons for common actions to maximize horizontal space.
*   **Consistency:** A unified single-page Electron interface with a persistent top control bar and a dynamic bottom detail/mixer area.

## 3. Layout Architecture (Single Page)
### A. Header: Timeline & Transport (Top)
*   **Timecode:** Large, high-contrast digital display.
*   **Transport Controls:** Play, Pause, Stop, Seek, Rate. (Icon-based).
*   **Global Actions:** Save, Open, Config, Diagnostics (Icon-based).
*   **Progress Bar:** A thin, full-width line acting as the visual separator between the header and the main content area.

### B. Workspace (Middle - Split)
*   **Left Pane: Media Pool:** Tabbed interface (Visuals | Audio). List/Grid view of imported assets with basic status indicators.
*   **Right Pane: Display Windows:** Management of physical/virtual outputs. Previews and status of active mappings.

### C. Footer: Outputs & Details (Bottom)
*   **Virtual Audio Outputs:** A persistent "Mixer" view on the left. Vertical faders, dB meters, and solo/mute toggles for each output.
*   **Dynamic Details Pane:** Contextual settings based on selection.
    *   *Visual selected:* Mapping, opacity, scale, loop settings.
    *   *Audio selected:* Routing, gain, effects.
    *   *Output selected:* Resolution, hardware assignment.

## 4. Design Tokens (Initial)
*   **Colors:**
    *   Background: Deep Charcoal/Slate (#2A2E30)
    *   Surface: Muted Dusty Blue/Grey (#5E6A71)
    *   Accent (Active): Desaturated Teal or Ochre
    *   Text: Off-white for readability; muted grey for labels.
*   **Typography:** Monospace or highly legible Sans-Serif (e.g., Inter, Roboto Mono) for data precision.
*   **Borders:** 1px solid lines for section separation. No shadows.

## 5. Detailed UI/UX Expectation
The application is structured as a single-page Electron interface with a persistent global shell and dynamic workflow-specific views.

### A. Global Shell (Persistent)
*   **Top Transport Bar:**
    *   Large Monospace Timecode display.
    *   Icon-based Transport Controls: Play, Pause, Stop, Seek (Back and Forth), Loop (Not in the HiFi image but need to be present, transformed from the current loop feature. It should be an icon button while clicked to expand into a tooltip config for loop parameters currently available in the project), Rate (See below).
    *   Global Playback Rate control (e.g., "Rate: 1.0x" Allow drag on number to tweak or double click to precisely input; applies on global level, on top of particular media rate setting).
    *   Utility Actions: Save, Open, Diagnostics (Icon-based).
    *   State Display: Live or Not (Dimmed then)
*   **Left Navigation Rail:**
    *   **Patch:** Media asset management and preview. (All current features)
    *   **Cue:** Sequential show control and triggering (QLab-like, Planned for future).
    *   **Performance:** Live execution and monitoring view (StageCue-like, Planned for future).
    *   **Config/Logs:** System-level settings and debugging.
*   **Status Footer:** Fixed bottom bar showing engine version, global mutes (Only audios), global blackouts (Both audios and displays), and meter resets.

### B. Patch View Layout (Transform Current MVP)
*   **Media Pool (Left Pane):**
    *   Tabbed view for **Visuals** and **Audio** assets, transformed from current separate video and audio pool UI.
    *   **Asset List:** Compact list of imported media with status indicators.
    *   **Integrated Preview:** Bottom half of the panel features an isolated, minimalist playback area (with minimal controls - play/pause/drag timeline) for the selected asset.
*   **Display Windows (Right Pane):**
    *   Management and preview of virtual display windows outputs (e.g., Display-0, Display-1).
    *   Status monitoring at the top right corner of each display (Ready, Standby, No Signal).
    *   Remove display feature at the bottom right corner of each display (Close Icon button)
*   **Control & Monitoring (Bottom Section):**
    *   **Audio Mixer:** Persistent vertical faders and meters for virtual outputs. Allow user to add virtual outputs here with a phantom button next to the last virtual outputs now. 
    *   **Details Config:** Dynamic, contextual configuration panel based on the current selection in Media Pool, Display Windows, or Virtual Audio Outputs. 
    *   The dynamic details section width should be expanded whenever a new item is selected to take up ~70vw.
*   **Layout Resizability:** Allow the panes widths and heights drag to resize (except for the header). The height of the middle row and the bottom section should be resizable. And within the middle row and bottom section, the proportion of Media Pool-Display windows and Audio Mixer-Details config should be internally adjustible.

## 4. Technical Requirements
*   **Platform:** Electron (Desktop) for low-level hardware access and cross-platform reliability.
*   **Routing Engine:** High-performance audio/video routing capable of handling multi-output 4K+ environments.
*   **Styling:** Utility-first CSS (Tailwind) following the "Morandi-Technical" design system tokens.
*   **Lucid Icons:** Use Lucid Icons whenever needed, avoid hardcoded SVG icons when possible.
