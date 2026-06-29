# Needle What's New (Discourse theme component)

Renders the Needle "What's New" marketing feed
(`https://marketer.needle.tools/api/whats-new`) as a subtle banner at the **bottom of a
topic** (the `topic-above-suggested` plugin outlet, above Suggested Topics).

Standalone component — attach it to the active theme in
**Admin → Customize → Themes → <theme> → Components**.

## What it does
- Fetches the feed with `?surface=&license=&tags=` from the component settings.
- **Priority-weighted random** pick (`weight = priority + 1`), not always the top item.
- Renders into a **fixed-height slot** (no layout shift), text wraps (never clamped).
- Themes accents/border/CTA from the feed `colors`.
- Optional **rotation** with an opacity **crossfade**; honours `prefers-reduced-motion`.
- Engagement tracking via `whatsnew.js` **mode B**: `impression` / `hover` (sustained,
  500 ms dwell). No dismiss control (removed by design). **Clicks are counted by the `item.url`
  `/r/` redirect used as the CTA href — we never call `needleWhatsNew.click()`.**

## Settings (settings.yml)
`feed_url`, `tracker_url`, `surface`, `license_state` (`none`/`any`), `extra_tags`,
`rotate`, `rotate_interval_seconds`.

## Known caveats / to verify
- **Outlet name:** assumes `topic-above-suggested` exists in this Discourse version. If the
  banner never appears, that outlet name is the first suspect — confirm against the running
  forum and rename the `connectors/<outlet>/…` folder accordingly. (Live-reload makes this a
  fast check.)
- **Colour derivation is simplified** — `readableText()` uses a WCAG-luminance approximation
  for CTA contrast, not the full oklch derivation the feed docs recommend. Revisit if we need
  derived tints/shades/borders.
- **No automated tests** — this lives outside `needle-cloud-test`; verification is the
  Theme-CLI live-preview loop.

## Local preview
```
discourse_theme watch <repo>/components/whats-new
```
(Separate from the parent theme's watcher.)
