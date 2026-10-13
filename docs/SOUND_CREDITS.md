# Sound credits

Every fart type sound in `public/sounds/` is built from a real recording. `scripts/render-sounds.js` trims, pitches, filters and loudness-matches each one. Burp sounds are synthesized by `scripts/synth.js` until real burp recordings are added.

## Licenses

Both licenses allow free commercial use without attribution. Neither allows passing the original files on as-is (standalone redistribution).

- **Pixabay Content License**: https://pixabay.com/service/license-summary/
- **Mixkit Sound Effects Free License**: https://mixkit.co/license/#sfxFree

That is why the originals are kept out of git (`assets/samples/` is gitignored) and only the processed type sounds ship with the app.

## Sources

| Recording (file name in `assets/samples/`) | Source | Used for |
|---|---|---|
| `apebble-fart-3-228243` | [Pixabay](https://pixabay.com/sound-effects/fart-3-228243/), apebble | Classic |
| `apebble-fart-4-228244` | [Pixabay](https://pixabay.com/sound-effects/fart-4-228244/), apebble | Echo Chamber |
| `apebble-fart-5-228245` | [Pixabay](https://pixabay.com/sound-effects/fart-5-228245/), apebble | Dutch Oven |
| `apebble-fart-7-228247` | [Pixabay](https://pixabay.com/sound-effects/fart-7-228247/), apebble | Toot |
| `apebble-fart-8-228248` | [Pixabay](https://pixabay.com/sound-effects/fart-8-228248/), apebble | Elevator Special |
| `beanfrog-proud-fart-288263` | [Pixabay](https://pixabay.com/sound-effects/proud-fart-288263/), beanfrog | Morning Glory |
| `dragon-studio-wet-fart-335478` | [Pixabay](https://pixabay.com/sound-effects/wet-fart-335478/), DRAGON-STUDIO | Bubbler |
| `freesound_community-fart-3-89567` | [Pixabay](https://pixabay.com/sound-effects/fart-3-89567/), freesound_community | Growler |
| `freesound_community-fart-83471` | [Pixabay](https://pixabay.com/sound-effects/fart-83471/), freesound_community | Whisper |
| `freesound_community-fart-91011` | [Pixabay](https://pixabay.com/sound-effects/fart-91011/), freesound_community | Workout Pop |
| `freesound_community-fart-noises-83359` | [Pixabay](https://pixabay.com/sound-effects/fart-noises-83359/), freesound_community | Double Tap, Hot One |
| `freesound_community-fart-squeeze-60793` | [Pixabay](https://pixabay.com/sound-effects/fart-squeeze-60793/), freesound_community | Squeeze-Out |
| `freesound_community-long-fart-farting-80351` | [Pixabay](https://pixabay.com/sound-effects/long-fart-farting-80351/), freesound_community | Slow Leak |
| `freesound_community-wet-fart-6139` | [Pixabay](https://pixabay.com/sound-effects/wet-fart-6139/), freesound_community | Wet One |
| `mikrotop22-furtz22-198542` | [Pixabay](https://pixabay.com/sound-effects/furtz22-198542/), mikrotop22 | Fake-Out |
| `waltermidnight-fart-sound-310129` | [Pixabay](https://pixabay.com/sound-effects/fart-sound-310129/), WalterMidnight | Foghorn |
| `waltermidnight-ultimate-fart-sound-310131` | [Pixabay](https://pixabay.com/sound-effects/ultimate-fart-sound-310131/), WalterMidnight | Thunderclap, Cushion Muffler |
| `mixkit-cartoon-fail-blow-fart-3053` | [Mixkit](https://mixkit.co/free-sound-effects/fart/) #3053 | Sneeze Combo |
| `mixkit-cartoon-fart-sound-2891` | [Mixkit](https://mixkit.co/free-sound-effects/fart/) #2891 | Rapid Fire |
| `mixkit-cartoon-fart-triple-3055` | [Mixkit](https://mixkit.co/free-sound-effects/fart/) #3055 | Staircase |
| `mixkit-farting-balloon-deflate-3052` | [Mixkit](https://mixkit.co/free-sound-effects/fart/) #3052 | Squeaker, Whistler, Silent But Deadly |
| `mixkit-farting-doubt-male-laugh-3054` | [Mixkit](https://mixkit.co/free-sound-effects/fart/) #3054 | Crop Duster |

## Re-rendering

1. Download the recordings above into `assets/samples/`. Keep each file name (`.mp3`, `.wav` or `.flac` all work).
2. Run `npm run sounds`.

A fart whose recording is missing keeps its committed MP3, and the script lists which ones it skipped. To change how a type sounds, edit its line in `FARTS` at the top of `scripts/render-sounds.js`.
