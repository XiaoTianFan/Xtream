Potential Python sidecar cases:

- Specialty timecode decoding.
- Hardware integrations with mature Python-only libraries.
- Offline media analysis or preprocessing.
- Installation-specific automation scripts.

## 18. Suggested Priority Order

1. Stabilize the MVP and hardware validation workflow.
2. Add cue list foundation and manual `GO` operation.
3. Expand media cues with fades, preload, and loop control.
4. Add the generic adapter framework.
5. Add OSC as the first external protocol.
6. Add MIDI after package reliability is proven.
7. Add Art-Net lighting looks and fades.
8. Add serial device control.
9. Add timecode sync.
10. Add advanced sequencing and authoring tools.
11. Add remote operation and multi-client monitoring.
12. Add project bundles, migrations, and production operations hardening.

## 19. Major Risks

- Feature creep before the MVP is show-stable could weaken reliability.
- Native Node modules for MIDI or serial may complicate packaging.
- Multi-output audio behavior may vary by Electron version, OS, permissions, and hardware.
- Lighting and device-control mistakes can affect real equipment, so dry-run validation and global output disable switches are required.
- Timecode chase behavior can be surprising around jumps, loops, and dropouts unless policies are explicit.
- Remote operation introduces safety and authentication concerns.
- Show-file schema changes require careful migration once any show has shipped.

## 20. Near-Term Next Steps After MVP

- Define the cue-list schema and cue engine state machine.
- Add tests for cue lifecycle transitions before adding UI complexity.
- Add a minimal operator cue list UI with current cue, next cue, and `GO`.
- Wrap the current playback mode application as the first media cue action.
- Add a readiness checklist that can include cue-list validation.
- Add a diagnostics section for cue execution history.
- Choose OSC as the first adapter implementation unless a real show requirement demands MIDI, lighting, or serial first.