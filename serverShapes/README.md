# ServerShapes

Custom shapes and contour-following glows for Discord’s server list, with per-server overrides and a live settings preview.

## Install

ServerShapes is a **custom Vencord userplugin**. Follow [Vencord’s custom plugin installation guide](https://docs.vencord.dev/installing/custom-plugins/) to prepare a development checkout.

To install all plugins in this repository:

```sh
./install.sh /path/to/Vencord
cd /path/to/Vencord
pnpm build
```

To install only ServerShapes, copy this directory into your Vencord checkout as `src/userplugins/serverShapes`, then run `pnpm build`. Reload Discord and enable **ServerShapes** in Settings → Vencord → Plugins.

## Features

- **16 shapes:** Discord Default, Circle, Square, Soft Square, Squircle, Heart, Star, Hexagon, Diamond, Octagon, Shield, Blob, Leaf, Clover, Gem, and Triangle.
- **Four glow styles:** outline, soft glow, outline plus glow, and neon.
- **Colours:** solid, linear gradient, conic gradient, or a palette sampled from each server icon.
- **Motion:** breathing, rotating gradients, hue cycling, hover bloom, and hover lift. Animations respect reduced-motion preferences.
- **Per-server styling:** right-click a server or choose it in the settings to override global defaults.
- **Presets and history:** built-in looks, saved presets, undo/redo, and selective resets.
- **Optional avatar styling and audio reactivity.**

## Settings

The preview stays visible while adjusting controls. Sliders have exact numeric inputs; press Enter or leave a numeric field to apply it.

| Tab | Controls |
| --- | --- |
| Appearance | Shape, glow style, brightness, spread, blur, outline, and hover behaviour |
| Colour & motion | Colours, gradient stops, breathing, rotation, and hue cycling |
| Audio | Audio source, sensitivity, smoothing, and reactive effects |
| Servers | Per-server overrides, folders, extra rail space, glow spill, and diagnostics |
| Avatars | Account panel, popouts, and profile styling |
| Presets | Apply or save looks, and reset individual settings |

**Let the glow spill past the rail** is on by default. Turn it off to keep the light inside the server list. **Rail breathing room** adds spacing; it is not required for glow spill.

When automatic colours are enabled, the preview uses the configured sample colours. Live servers use colours sampled from their own icons.

## Rendering

The icon and glow share one shape definition. SVG masks expand the contour with a stroke instead of stretching the shape, keeping outline thickness consistent around diagonal edges and concave shapes.

The soft glow is masked on a child and blurred on its parent, preserving the soft falloff. The in-rail glow sits in a shared rail layer outside individual clipped icon containers, behind the icons and badges. A viewport overlay draws its continuation beyond the rail. Its stationary cutoff remains separate from glow animation.

Scroll and resize updates keep the layers aligned. Hidden rows are restored when they scroll back into view. Disabling the plugin removes its layers, observers, attributes, and styles.

## Local data and audio

Settings, overrides, and presets are stored in Vencord locally. Automatic colour sampling reads server icon images. Optional audio capture begins only when enabled and uses browser audio permissions; the analyser is not connected to audio output. The plugin does not upload captured audio or settings.

## Limitations

- Discord markup and themes can change; use the troubleshooting section if targeting stops working.
- Avatar shape matching can affect Discord’s status-indicator cutout. It is off by default.
- Very wide glows can overlap neighbouring icons or sidebar content; reduce spread, blur, or opacity to soften the effect.
- Preview samples illustrate the configured style, not the exact colours of each live server.

## Validation

This version was built and type-checked against the local Vencord checkout. Chromium browser checks covered all 16 shape previews, settings tabs, glow continuation beyond clipped icon wrappers, scroll hide/restore, spill toggling, audio-size updates, and cleanup. Standalone settings checks used substitutes for Discord’s shared UI components; live Discord appearance may vary with themes.

## Authors

- **Eve** — [@Zykoraa on GitHub](https://github.com/Zykoraa)
- **Demonjane** — [@Demonjane-jpg on GitHub](https://github.com/Demonjane-jpg) · [Discord profile](https://discord.com/users/725525081555730542)

Both are credited as authors in Vencord’s ServerShapes plugin settings.

## License

GPL-3.0-or-later, matching Vencord and this repository.
