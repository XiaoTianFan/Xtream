# Program Scene Triggers

Triggers decide when Stream scenes start. Use them to mix operator-started scenes with automated follow behavior.

## When To Use It

Use this task when you need a scene to start manually, start with another scene, start after another scene ends, wait for a delay, or participate in a thread-based playback branch.

## Before You Start

- Build the scenes you want to connect.
- Give scenes clear titles so trigger relationships are easy to read.
- Confirm media durations when using follow-end behavior.
- Decide where the operator should take manual control.

## Trigger Types

**Manual** means the scene starts when the operator starts it. Manual scenes are boundaries. They should not unexpectedly auto-start just because earlier scenes finished.

**Follow-start** means the scene starts relative to another scene's start. Use it for parallel or layered scenes that should begin together or after a start delay.

**Follow-end** means the scene starts relative to another scene's end. Use it for normal scene chains.

**Timecode** is for timecode-driven behavior. Treat it as an advanced setup path and verify the external time basis before using it live.

## Delay

Delay offsets the trigger. A follow-start scene with a delay starts after its parent starts. A follow-end scene with a delay starts after its parent ends. Use delay for beats, transitions, and pre-planned offsets.

## Steps

1. Open Stream.
2. Select the scene.
3. Open the scene edit panel.
4. Choose a trigger type.
5. If the trigger follows another scene, choose the parent scene.
6. Set delay if needed.
7. Review the result in List, Flow, or Gantt mode.
8. Fix validation warnings before showtime.

## Manual Boundaries

Manual scenes are important because they give the operator control. A chain that reaches a manual scene can hold instead of drifting forward. This helps you step through cue points without losing timing context.

Double-check manual boundaries in Gantt and Flow. If a scene should be automatic, do not leave it manual. If a scene should wait for the operator, do not attach it as a normal follow.

## Thread-Based Behavior

Stream playback can run independent threads. A manual root can launch a side timeline while the main timeline continues. Follow-start scenes can form parallel branches. Infinite manual loops can run beside the main timeline without stretching the main duration.

This makes complex playback possible, but it also means you should review shows in Gantt mode. Look for:

- Main timeline scenes.
- Side timelines.
- Parallel branches.
- Infinite loops.
- Manual scenes that are ready but waiting.

## What You Should See

- Flow mode shows scene relationships visually.
- Gantt mode shows where scenes and threads land over time.
- Manual scenes remain available for operator action.
- Validation points out unreachable or structurally invalid relationships.

## Common Problems

**A scene starts automatically when it should wait.** Change it to manual or revise its follow relationship.

**A scene never starts.** Check whether its parent scene is disabled, missing, blocked, or never reached.

**Gantt timing looks too long.** Check for scene loops, sub-cue loops, unknown durations, and infinite manual side threads.

**A follow-end scene starts at the wrong time.** Check the parent scene duration, media trims, playback rate, loops, and duration overrides.

## Related Pages

- [Build Stream scenes](build-stream-scenes.md)
- [Run and cue a show](run-and-cue-a-show.md)
- [Stream model](../reference/stream-model.md)
- [Triggers, loops, and time](../reference/triggers-loops-and-time.md)

