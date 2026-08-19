# Light configuration and DMX modes

Each light mapping connects a range of Art-Net DMX channels to a Hue light. `dmxStart` is one-based: a mapping starting at `1` reads the first DMX channel.

`channelMode` describes the DMX channel layout. It does not change the operating mode of the physical Hue lamp. The short names in this document summarize the channel layout; configuration files continue to use the canonical mode names.

## Recommended lamp-ID mapping

Use `hue.lights` for normal installations. `lightId` is the familiar numeric Hue ID displayed by `list-lights` and used in Hue v1 paths such as `/lights/1`.

```json
"lights": [
  {
    "lightId": "1",
    "dmxStart": 1,
    "channelMode": "8bit-dimmable"
  },
  {
    "lightId": "2",
    "dmxStart": 5,
    "channelMode": "8bit-dimmable"
  }
]
```

A normal bulb resolves to one Hue Entertainment channel. For a gradient light, lamp-ID mode sends the same DMX color to all of its segments. Run `auto-setup` to generate consecutive lamp-ID mappings automatically. Add `--overwrite` when replacing existing `lights` or `channels` mappings.

See [config.lights.example.json](docker/config.lights.example.json) for a complete configuration.

## Advanced channel-ID mapping

Use `hue.channels` only when individual gradient segments need separate colors or when a Hue area does not expose legacy light IDs.

```json
"channels": [
  {
    "channelId": 0,
    "dmxStart": 1,
    "channelMode": "8bit-dimmable"
  }
]
```

Run `list-channels` to find the area-local IDs. Explicit channel mode must cover the complete selected Entertainment area. Do not configure `lights` and `channels` together. Running `auto-setup` switches the configuration back to lamp-ID mode.

See [config.channels.example.json](docker/config.channels.example.json) for a complete configuration.

## Supported DMX channel modes

| Mode | Short name | Width | Channel order | Description |
| --- | --- | ---: | --- | --- |
| `8bit` | `RGB` | 3 | Red, Green, Blue | Standard RGB with 256 values per color. |
| `8bit-dimmable` | `DRGB` | 4 | Dimmer, Red, Green, Blue | RGB multiplied by a master dimmer; recommended for lighting consoles. |
| `16bit` | `RGB16` | 6 | Red coarse, Red fine, Green coarse, Green fine, Blue coarse, Blue fine | High-resolution RGB with 65,536 values per color. |
| `16bit-dimmable` | `DRGB16` | 8 | Dimmer coarse/fine, then RGB coarse/fine | High-resolution RGB multiplied by a high-resolution master dimmer. |

### `8bit`

For `dmxStart: 1`, the mapping consumes DMX channels 1–3:

| DMX channel | Function | Range |
| ---: | --- | ---: |
| 1 | Red | 0–255 |
| 2 | Green | 0–255 |
| 3 | Blue | 0–255 |

The next non-overlapping mapping can start at channel 4.

### `8bit-dimmable`

For `dmxStart: 1`, the mapping consumes DMX channels 1–4:

| DMX channel | Function | Range |
| ---: | --- | ---: |
| 1 | Master dimmer | 0–255 |
| 2 | Red | 0–255 |
| 3 | Green | 0–255 |
| 4 | Blue | 0–255 |

The dimmer scales all three colors. A dimmer value of `0` produces black; `255` applies the full RGB values. The next non-overlapping mapping can start at channel 5.

### `16bit`

For `dmxStart: 1`, the mapping consumes DMX channels 1–6:

| DMX channel | Function | Range |
| ---: | --- | ---: |
| 1 | Red coarse | 0–255 |
| 2 | Red fine | 0–255 |
| 3 | Green coarse | 0–255 |
| 4 | Green fine | 0–255 |
| 5 | Blue coarse | 0–255 |
| 6 | Blue fine | 0–255 |

Each 16-bit color value is calculated as `coarse × 256 + fine`. The next non-overlapping mapping can start at channel 7.

### `16bit-dimmable`

For `dmxStart: 1`, the mapping consumes DMX channels 1–8:

| DMX channel | Function | Range |
| ---: | --- | ---: |
| 1 | Master dimmer coarse | 0–255 |
| 2 | Master dimmer fine | 0–255 |
| 3 | Red coarse | 0–255 |
| 4 | Red fine | 0–255 |
| 5 | Green coarse | 0–255 |
| 6 | Green fine | 0–255 |
| 7 | Blue coarse | 0–255 |
| 8 | Blue fine | 0–255 |

The 16-bit dimmer scales all three 16-bit colors. Dimmer `0, 0` produces black; `255, 255` applies the full RGB values. The next non-overlapping mapping can start at channel 9.

## Addressing rules

- `dmxStart` must be between 1 and 512 and leave enough room for the complete mode.
- Different mappings may not partially overlap.
- Multiple lights may intentionally use the exact same `dmxStart` and `channelMode` to receive the same color.
- Incoming ArtDMX frames must contain every channel required by the highest configured mapping.
- `artnet.universe` must match the universe transmitted by the Art-Net node.
