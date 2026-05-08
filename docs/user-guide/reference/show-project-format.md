# Show Project Format

This is a user-level reference for Xtream show projects. It explains what travels with a show and what stays with the workstation.

## Short Definition

A show project is a folder containing `show.xtream-show.json`. Copied and extracted media lives under project-local asset folders. Linked media can live outside the project.

## Project Folder

The project folder is the unit to back up or move.

```txt
show-folder/
  show.xtream-show.json
  assets/
    audio/
    visuals/
```

Some projects may not contain every asset folder until media is copied or extracted.

## Show File

`show.xtream-show.json` stores show data such as:

- Media pool records.
- Display windows.
- Visual mappings.
- Virtual audio outputs.
- Stream scenes, triggers, sub-cues, Flow layout, and playback preferences.
- Show-level fade and display composition settings.
- Per-project UI state where applicable.

Do not hand-edit the show file during operation. Use Xtream and save the show.

## Relative Project Assets

Copied visual and audio media is stored relative to the project folder. Extracted embedded audio is also project-local.

Relative project assets make the show portable because the media travels with the folder.

## Linked Absolute Paths

Linked media points to a file outside the project folder. It is useful when media should stay in a shared media library, but it can go missing when paths change.

If linked media is missing, use relink instead of editing the show file directly.

## App-Local Preferences

Some settings are machine-local and are not saved in the show file. Examples include performance mode, embedded audio extraction format, and control display preview frame rate.

These settings stay with the workstation.

## Schema Migration

Current show files use schema v9. Supported older show schemas migrate automatically when opened.

After opening an older show, save a copy before doing major work if you need a preserved pre-migration file.

## Persistence And Scope

Saved with the show:

- Patch media, displays, mappings, outputs, and routing.
- Stream scenes and cue data.
- Show-level playback and composition settings.

Saved on the machine:

- App-local performance and preview preferences.
- Some workstation capability choices.

Runtime/session only:

- Current playback state.
- Session log contents.
- Global audio mute and display blackout button state.
- Live telemetry.

## Related Tasks

- [Project files and media](../getting-started/project-files-and-media.md)
- [Save, open, and relink shows](../tasks/save-open-and-relink-shows.md)
- [Import media](../tasks/import-media.md)
- [Settings reference](settings-reference.md)

