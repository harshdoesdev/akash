# Akash Itch.io Alpha Packaging Spec

## Goal

Package `akash` as an itch.io-ready browser game build, then generate the first batch of store media from the live game:

- playable web build packaged for itch.io
- reproducible packaging script
- alpha-build labeling inside the game
- branded favicon plus text/icon logo assets
- gameplay footage assembled into a promo clip with existing repo BGM
- store screenshots exported to `~/Projects/akash-screenshots`

## Constraints And Assumptions

- Repo is a Vite web game, so the itch.io target is an HTML5 upload bundle.
- Existing music source is `public/bgm.mp3`; use that for promo media.
- `ffmpeg` is available locally.
- `agent-browser` CLI is not installed in this environment, so gameplay capture will use Playwright automation as the compatible fallback.
- Deliverables should be generated without relying on further user input.

## Deliverables

1. In-game alpha labeling
2. Logo assets
3. Favicon wired into `index.html`
4. Packaging script that builds and zips the HTML5 bundle
5. Playwright capture script for deterministic gameplay footage and screenshots
6. ffmpeg assembly step for stitched gameplay video with BGM
7. Exported screenshots in `~/Projects/akash-screenshots`
8. Exported logo media in `~/Projects/akash-screenshots`

## Execution Sequence

1. Add release-facing branding
   - show `alpha build` in menu and boot flow
   - add a visible badge or subtitle treatment so screenshots clearly communicate the build state
   - wire favicon and menu logo assets

2. Add automation
   - install Playwright tooling
   - create a local capture script that launches the game, starts flight, performs controlled movement, and saves frames/screenshots
   - create a packaging script that builds and archives the game for itch.io

3. Generate media assets
   - create text logo and icon logo
   - save repo copies under `public/branding/`
   - export media copies to `~/Projects/akash-screenshots`

4. Produce footage
   - build and serve the game locally
   - run Playwright capture
   - stitch frame sequences with `ffmpeg`
   - mix in `public/bgm.mp3`

5. Produce screenshots
   - capture a mix of menu and in-flight compositions
   - export in a landscape ratio suitable for itch.io page/gallery use

6. Verify output
   - confirm packaged zip exists
   - confirm screenshot and video assets exist
   - confirm branding assets are in repo and export folder

## Output Locations

- Packaging bundle: `release/`
- Automation scripts: `scripts/`
- Branding assets in repo: `public/branding/`
- Store media export: `~/Projects/akash-screenshots`

## Notes For Continuation

- Prefer deterministic seeds during capture so media can be regenerated.
- Keep scripts composable so packaging and media generation can run independently.
- If browser capture performance is unstable in headless mode, switch the Playwright script to headed mode before changing any gameplay logic.
