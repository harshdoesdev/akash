# Spec: screens system, main menu, sound settings, BGM, rename → akash

Goal: turn the raw prototype boot into a proper game shell. Vanilla DOM/CSS
screens over the live canvas — no UI framework. The world itself is the main
menu art: the finished game renders behind the menu with a slow cinematic
drift camera (Breath-of-the-Wild style), which shows off the meadow better
than any static illustration and costs no assets.

## Flow

boot (asset preload) → **main menu** (live world + cinematic cam)
→ Fly → **playing** (HUD, chase cam, input live)
→ ESC → **paused** (panel; world keeps breathing) → Resume / Settings / Main menu
Settings is reachable from both menu and pause, and returns to wherever it
was opened from.

## Checklist

### Rename → akash
- [x] index.html title, boot screen, menu wordmark (आकाश / akash)
- [x] package.json name
- [x] memory notes updated

### Screens system (src/ui.js)
- [x] Screen registry: DOM sections with `.screen`, crossfade via `.active`
- [x] States: `menu | playing | paused | settings`; settings remembers its return screen
- [x] ESC: playing→paused, paused→playing, settings→back
- [x] HUD + controls text only visible while playing (body.in-game)
- [x] Input gated: drone gets zero input except while playing
- [x] Cinematic menu camera: slow orbit around spawn, gentle bob; chase cam while playing/paused

### Main menu
- [x] Wordmark art: आकाश over "akash", subtitle, soft edge-shade over the live world
- [x] Buttons: fly, settings
- [x] Seed line: shows current world seed
- [x] Audio starts on Fly (user gesture — satisfies autoplay policy)

### Sound settings
- [x] Audio buses: master / drone (motor) / ambience (wind + birds) / bgm
- [x] Settings screen with 4 sliders (0–100), live while dragging
- [x] Persisted to localStorage (`akash-audio-v1`), loaded on boot
- [x] M mute toggle still works (independent of master slider)

### BGM
- [x] Generative music layer in audio.js (no audio files): slow warm pad
      chords (maj7 progression, triangle pads through a lowpass) + sparse
      music-box plucks on a pentatonic scale through a feedback delay
- [x] Runs on the bgm bus; default volume low; pauses with mute

### Verification
- [x] Menu shows over live drifting world after boot
- [x] Fly enters game, ESC pauses, settings sliders audible + persisted
- [x] Screenshots: menu, pause, settings
