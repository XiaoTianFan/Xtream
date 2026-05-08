# Install And Open

Use this page to install or run Xtream and open the control console.

## When To Use It

Use this guide when setting up a workstation for the first time, testing a source checkout, or helping an operator understand what Xtream needs from the operating system.

## Packaged App

When a packaged app is available, install it like a normal desktop application for your platform.

On Windows, use the installer or portable package supplied for the release. On macOS, use the packaged app if one is supplied for the release. Packaged builds should open directly into the Xtream launch dashboard.

If a packaged build is not available, use the source-run workflow below.

## Run From Source

Source-run setup is intended for development, testing, and nightly documentation users.

Before you start, install:

- Git.
- Node.js LTS.
- npm, which is included with Node.js.

Then run:

```bash
git clone https://github.com/XiaoTianFan/Xtream.git
cd Xtream
npm install
npm start
```

`npm start` builds the app, runs type checks and tests, then opens Xtream in Electron.

## Windows Notes

- Connect external displays and audio devices before opening the show when possible.
- If Windows asks about firewall, camera, microphone, or screen permissions, allow the permissions needed for the show.
- Audio device names can change when devices are unplugged or reconnected. Refresh outputs in Xtream after changing hardware.

## macOS Notes

- macOS may ask for screen recording, camera, microphone, or accessibility-style permissions depending on the capture sources you use.
- After granting a system permission, you may need to restart Xtream.
- If running from source, open Terminal, move into the Xtream folder, and run `npm start`.

## Permissions

Live capture and routing depend on operating-system permission and device availability.

Common permissions:

- Camera access for webcam visuals.
- Screen recording access for screen or window capture.
- Microphone or media permissions when live sources or audio devices require them.
- Audio output access through the system and browser/Electron audio APIs.

If a live source or output is unavailable, check system permissions first, then check Xtream diagnostics.

## Launch Dashboard

When Xtream opens, the launch dashboard offers:

- Open an existing show.
- Create a new show.
- Open the default show.
- Open a recent show.

Recent shows are convenience links. If several copies of a show exist, confirm the folder path before editing.

## Related Pages

- [First show](first-show.md)
- [Project files and media](project-files-and-media.md)
- [Save, open, and relink shows](../tasks/save-open-and-relink-shows.md)
- [Config and diagnostics](../workspaces/config-and-diagnostics.md)

