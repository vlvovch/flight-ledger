# Branding

The mark outside the app. The app's own icons live where Next serves them
(`src/app/icon.svg`, `src/app/apple-icon.png`, `public/icon-*.png`,
`public/icon-mark.svg`); this folder holds renders for third-party surfaces
that want their own shape — nothing in here ships in a build.

- `logo.svg` — the mark as it presents itself: the full three-rule design
  on its navy tile. Vector master; `logo-512.png` and `logo-192.png` are
  its renders (the same files the web-app manifest serves).
- `logo-white.svg` — the same mark on solid white, for surfaces that build
  their own frame. Cropped tight and struck slightly heavier than the tile
  version: consent screens render it around 40px, where padding is shrink
  and thin rules are lint.
- `logo-white-120.png` — Google OAuth consent screen (their recommended
  120×120, opaque white so nothing composites it unpredictably).
- `logo-white-512.png` — the same at 512, for whatever asks next.
