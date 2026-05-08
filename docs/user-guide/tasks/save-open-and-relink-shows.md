# Save, Open, And Relink Shows

Xtream show projects are folders centered on `show.xtream-show.json`. Saving, opening, and relinking carefully keeps media and routing reliable across rehearsals, moves, and machines.

## When To Use It

Use this task when creating a new show, opening an existing show, saving work, moving a project folder, or fixing missing media.

## Before You Start

- Know where the show project folder should live.
- Decide whether imported media should be copied into the project or linked from original locations.
- If moving a show, move the entire project folder, not only the show file.
- If relinking, locate the replacement media folder or files first.

## New, Open, Save, And Save As

**New** creates a new show project.

**Open** opens an existing `show.xtream-show.json` project file.

**Save** writes changes to the current show project.

**Save As** writes the show to a new location. After Save As, verify copied and linked media behavior before deleting or moving the old folder.

Unsaved-change prompts protect edits when opening, creating, or closing shows. Treat them seriously during show operation.

## Recent Shows

The launch dashboard lists recent shows. Use it for quick return to known projects, but confirm the path if several copies of a show exist.

## Moving Show Folders

Copied media and extracted embedded audio are stored relative to the project folder, usually under `assets/audio` and `assets/visuals`. These are the safest media records to move between machines.

Linked media remains at its original disk path. If linked media is not available on the new machine or drive path, Xtream reports it as missing.

## Relink Media One By One

Use **Relink media...** when the footer reports missing clips. The relink view shows broken visual or audio items.

For each missing item:

1. Select the missing media item.
2. Choose a replacement file.
3. Decide whether to link the replacement or copy it into the project.
4. Confirm the media becomes ready.

## Batch Relink From Folder

Use batch relink when many files moved together. Choose a folder that contains the missing media. Xtream can match by filename and relink or copy matching files in bulk.

After batch relink, review the media pool and diagnostics. Matching by filename is fast, but you should confirm the correct files were chosen when multiple versions exist.

## Link Or Copy During Relink

Choose link when the replacement media should remain outside the project folder. Choose copy when the project should carry the media with it.

For touring, handoff, backup, or multi-machine operation, copied media is usually safer.

## Schema Migrations

Current show files use schema v9. Supported older schemas migrate automatically when opened. After opening an older show, save a new copy before major edits if you need to preserve the original file.

## What You Should See

- The status footer clears missing-media issues after successful relink.
- Media pool records show ready metadata after probing.
- Stream validation refreshes after media issues are fixed.
- Copied media lives under the project assets folders.

## Common Problems

**The wrong copy of a show opened.** Check the project path and recent-show entry.

**Media is still missing after relink.** Confirm the replacement file exists, is readable, and matches the media type.

**A moved show lost media.** Linked media probably stayed behind. Relink it or copy it into the project.

**A show opens but behaves strangely.** Export diagnostics before changing too much, then check media validation, Stream validation, display telemetry, and audio routing state.

## Related Pages

- [Project files and media](../getting-started/project-files-and-media.md)
- [Import media](import-media.md)
- [Config and diagnostics](../workspaces/config-and-diagnostics.md)
- [Export diagnostics](export-diagnostics.md)
- [Show project format](../reference/show-project-format.md)

