# Project Files And Media

Xtream saves each show as a project folder. The project folder is the safest unit to back up, move, or share.

## Project Folder

A show project contains `show.xtream-show.json`. This is the show file. It stores the show structure, Patch routing, Stream scenes, displays, virtual outputs, and show-level settings.

Copied and extracted media is stored under project-local asset folders:

```txt
show-folder/
  show.xtream-show.json
  assets/
    audio/
    visuals/
```

## Linked Media

Linked media stays in its original disk location. The show records the path to that original file.

Linked media is useful when files live in a managed media library or should not be duplicated. The tradeoff is portability: if the file is moved, renamed, disconnected, or opened on another machine with a different path, Xtream may report it missing.

## Copied Media

Copied media is stored inside the project folder. This makes the show easier to move because the media travels with the project.

Use copied media for touring, handoff, backup, and multi-machine operation.

## Extracted Embedded Audio

When a video contains embedded audio, Xtream can extract that audio into a project audio source. Extracted audio is stored under the project-local audio assets area and is tracked like other copied project media.

The embedded audio extraction format is a machine-local app setting, not a per-show setting.

## Moving Projects Between Machines

Move the whole project folder, not only `show.xtream-show.json`.

After moving:

1. Open the show.
2. Check the status footer for missing media.
3. Use **Relink media...** if linked media paths no longer resolve.
4. Check display monitor assignment and physical audio output selection because those depend on the workstation.
5. Save after confirming the show opens correctly.

## Schema Migrations

Current show files use schema v9. Supported older schemas migrate automatically when opened. If you are opening an older show, save a copy before making major edits so the original remains available.

## Why Media Goes Missing

Media usually goes missing because:

- A linked file moved.
- A linked file was renamed.
- A drive or network volume is disconnected.
- A show was opened on another operating system with different paths.
- Only the show file was copied, not the whole project folder.

## Relinking

Relinking updates the show record to point at available media. You can relink one item at a time or batch relink from a folder by matching filenames.

During relink, choose link if the replacement should stay outside the project. Choose copy if the replacement should become part of the project folder.

## Related Pages

- [Import media](../tasks/import-media.md)
- [Save, open, and relink shows](../tasks/save-open-and-relink-shows.md)
- [Show project format](../reference/show-project-format.md)
- [Settings reference](../reference/settings-reference.md)

