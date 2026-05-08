# Use Control Sub-Cues

Control sub-cues let a scene automate other show behavior.

## When To Use It

Use this task when a scene should start, stop, pause, or resume another scene; change audio sub-cue level or pan; stop an audio sub-cue; toggle global audio mute; or toggle display blackout.

## Before You Start

- Build the scenes and sub-cues you want to control.
- Name scenes clearly so targets are easy to choose.
- Decide whether the control should affect live output immediately.
- Avoid self-targeting unless the behavior is intentionally supported and validated.

## Control Actions

Control sub-cues can:

- Play a scene.
- Stop a scene.
- Pause a scene.
- Resume a scene.
- Stop an audio sub-cue.
- Set an audio sub-cue level.
- Set an audio sub-cue pan.
- Set global audio muted.
- Set global display blackout.

Stop-scene behavior can use fade-out so active output does not disappear abruptly.

## Steps

1. Open Stream.
2. Select a scene.
3. Add a control sub-cue.
4. Choose the action.
5. Choose the target scene, sub-cue, or global control.
6. Set timing inside the scene.
7. Set values such as level, pan, muted state, blackout state, or fade-out timing where applicable.
8. Review validation warnings.
9. Test in a rehearsal pass before using the automation live.

## Global Safety Actions

Global audio mute and display blackout affect live output. They are useful as show actions, but they are also safety controls in the footer. Make sure operators know when a Stream scene is going to toggle them automatically.

Show-level fade settings can affect how these global actions transition.

## Self-Target Warnings

A control sub-cue that targets its own scene or related cue can be confusing or unsafe. Treat self-target warnings seriously. If the show design needs a scene to stop or pause itself, test the exact behavior in rehearsal and document it in the scene note.

## What You Should See

- The control sub-cue appears in the selected scene.
- The target is named in user-facing terms.
- Validation warns about missing targets, unsafe relationships, or invalid values.
- During playback, the target behavior happens at the cue's scheduled time.

## Common Problems

**The action does nothing.** Check whether the target scene or sub-cue exists, is enabled, and is reachable.

**A scene stops too abruptly.** Add or increase fade-out on the stop action where available.

**Audio changes are not heard.** Check the target audio sub-cue, output routing, mute/solo state, and global audio mute.

**Blackout or mute surprises the operator.** Add a scene note and review global safety automation during rehearsal.

## Related Pages

- [Build Stream scenes](build-stream-scenes.md)
- [Program scene triggers](program-scene-triggers.md)
- [Run and cue a show](run-and-cue-a-show.md)
- [Settings reference](../reference/settings-reference.md)

