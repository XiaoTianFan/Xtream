# Import Media

Use media import to add visual and audio sources to the current show project.

## When To Use It

Use this task when you need to add images, videos, audio files, or live visual sources to the media pool.

## Before You Start

- Create or open a show project.
- Decide whether the media should stay at its original location or be copied into the project.
- For live capture, make sure the camera, screen, region, or application window is available and permissions are granted.

## Supported File Imports

Xtream routes picked or dropped files into visual and audio imports by extension.

Visual imports include common video and image files: `mp4`, `mov`, `m4v`, `webm`, `ogv`, `png`, `jpg`, `jpeg`, `webp`, and `gif`.

Audio imports include common audio containers: `wav`, `mp3`, `m4a`, `aac`, `flac`, `ogg`, `opus`, and audio-capable video containers such as `mp4`, `mov`, `m4v`, and `webm`.

When a file can be both visual and audio, Xtream treats it as a visual import first. If embedded audio is detected, Xtream can offer to extract that audio as a separate audio source.

## Steps

1. Open Patch.
2. In **Media Pool**, choose **Add Media**.
3. Pick files from disk, or drag supported files into the media pool.
4. Review the import prompt.
5. Choose **Link originals** to reference the files where they are.
6. Choose **Copy into project** to store the files under the project folder.
7. If prompted to import video audio, choose the option that matches the show.
8. Wait for metadata probing to finish.

## Link Or Copy

**Link originals** is useful when media lives in a managed storage location and should not be duplicated. The show records the original disk path. If the file is moved, renamed, disconnected, or opened on a different machine, it may need relinking.

**Copy into project** is safer when the show folder needs to travel. Xtream stores copied media under project-local asset folders so the show is less likely to break when moved as a folder.

## What You Should See

- Visual files appear in the Visuals tab.
- Audio files appear in the Audio tab.
- Newly imported media is selected.
- Metadata such as duration or readiness updates after probing.
- Unsupported files are reported instead of silently added.

## Removing Media

Removing a media pool item removes the project record. It does not delete the source file from disk.

## Common Problems

**Nothing imports.** Check whether the files are supported and readable.

**Some files import and some do not.** Xtream reports unsupported or skipped files after the supported files are added.

**A linked file goes missing.** Use **Relink media...** in the status footer.

**A video imports but there is no audio source.** The file may not contain embedded audio, or extraction may have been skipped or failed. Try importing a separate audio file if the show needs sound.

## Related Pages

- [First show](../getting-started/first-show.md)
- [Patch workspace](../workspaces/patch.md)
- [Project files and media](../getting-started/project-files-and-media.md)
- [Save, open, and relink shows](save-open-and-relink-shows.md)

