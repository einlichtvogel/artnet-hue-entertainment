# ArtNet Hue Entertainment

ArtNet Hue Entertainment receives ArtDMX frames and streams their RGB values to a Philips Hue Entertainment area using the CLIP v2 and HueStream v2 APIs.

It supports independently addressable standard color bulbs and the individual entertainment channels exposed by gradient products. Philips/Signify color-capable lights and a Hue Bridge with Entertainment support are required.

> **Photosensitivity warning:** Rapidly changing light can trigger seizures, migraines, or other adverse effects. The operator is responsible for safe programming and use.

## Requirements

- Node.js 22 or newer
- A Hue Bridge and color-capable Hue lights
- A Hue Entertainment area created in the Hue app
- An Art-Net source such as QLC+

In the Hue app, select the lamps for the Entertainment area and position them in the virtual room. Configuration normally uses the familiar numeric Hue light IDs; the software resolves the bridge's internal Entertainment channels automatically.

## Install and build

```bash
npm install
npm run build
npm install .
```

For development, run all compiler and automated checks with:

```bash
npm run check
```

## Docker

The repository includes a multi-stage image and Compose definitions. On Linux, host networking provides reliable Art-Net broadcast reception and direct Hue LAN access.

```bash
mkdir -p docker-data/default
cp config.json docker-data/default/config.json
export ARTNET_HUE_UID="$(id -u)"
export ARTNET_HUE_GID="$(id -g)"
docker compose up -d --build
docker compose logs -f bridge
```

Use [compose.multiple.example.yaml](compose.multiple.example.yaml) for multiple isolated deployments. Each instance gets its own configuration directory and must target a different Hue Entertainment area or bridge. See [docs/docker.md](docs/docker.md) for pairing in a container, UID/GID handling, multi-instance examples, and host-network limitations.

## Initial setup

1. Discover the bridge, or use its known address:

   ```bash
   artnet-hue-entertainment discover
   ```

2. Press the physical link button and pair:

   ```bash
   artnet-hue-entertainment pair --ip 192.168.1.10
   ```

3. List the Entertainment areas. If the existing area has legacy ID `/groups/200`, it is selected automatically; otherwise copy its UUID into `hue.entertainmentConfigurationId`.

   ```bash
   artnet-hue-entertainment list-areas
   ```

4. Optionally inspect the bridge-assigned channels, then generate consecutive lamp-ID DMX mappings:

   ```bash
   artnet-hue-entertainment list-channels
   artnet-hue-entertainment auto-setup
   ```

5. Start streaming:

   ```bash
   artnet-hue-entertainment run
   ```

Use `--config <path>` with any command to select a file other than `./config.json`.

## Configuration

`pair` and `auto-setup` create a configuration shaped like [config.example.json](config.example.json):

```json
{
  "artnet": {
    "host": "127.0.0.1",
    "universe": 11
  },
  "hue": {
    "host": "192.168.1.10",
    "username": "application-key",
    "clientKey": "dtls-client-key",
    "entertainmentConfigurationId": "123e4567-e89b-42d3-a456-426614174000",
    "lights": [
      {
        "lightId": "1",
        "dmxStart": 1,
        "channelMode": "8bit-dimmable"
      }
    ]
  }
}
```

- `artnet.host` is the local interface address on which UDP port 6454 is bound.
- `artnet.universe` must match the incoming ArtDMX universe.
- `entertainmentConfigurationId` is the v2 UUID shown by `list-areas`.
- `lightId` is the familiar numeric Hue ID shown by `list-lights`, for example `1` for `/lights/1`.
- `dmxStart` is one-based and must leave room for the selected mode within the 512-channel universe.

The file contains credentials and is written with owner-only permissions. Do not commit or share it.

### DMX channel modes

- `8bit`: `R, G, B` (3 channels)
- `8bit-dimmable`: `Dimmer, R, G, B` (4 channels, recommended)
- `16bit`: `R, R fine, G, G fine, B, B fine` (6 channels)

The included [`qlc+/Artnet-Hue-RGB.qxf`](qlc+/Artnet-Hue-RGB.qxf) defines all three modes for QLC+.

### Entertainment channel mappings

HueStream v2 communicates with area-local channel IDs internally. At startup, each configured `lightId` is resolved to the selected area's channel or channels. A normal bulb generally resolves to one channel; all segments of a gradient lamp receive the same configured DMX color.

For advanced segment-level control, replace `lights` with explicit channel mappings:

```json
"channels": [
  {
    "channelId": 0,
    "dmxStart": 1,
    "channelMode": "8bit-dimmable"
  }
]
```

Use `list-channels` to discover those IDs. Explicit channels are also the fallback for a bridge or area that does not expose legacy light IDs. Do not configure `lights` and `channels` together. `auto-setup` always returns the configuration to lamp-ID mode and removes explicit channels.

## Commands

| Command | Purpose |
| --- | --- |
| `discover` | Query the official Hue discovery service for bridges. |
| `pair --ip <address>` | Create an application key and DTLS client key after the link button is pressed. |
| `list-areas` / `list-rooms` | List v2 Entertainment areas, UUIDs, and legacy IDs. |
| `list-channels` | List the selected area's bridge-assigned stream channels. |
| `list-lights` | List v2 light UUIDs and legacy light IDs. |
| `ping-light --id <id-or-uuid>` | Flash one light; use `all` for all lights. |
| `ping-lights` | Flash all lights in sequence. |
| `rename-lights-after-id` | Rename Hue devices to `Light <legacy-id>`. |
| `auto-setup` | Generate consecutive four-channel dimmable mappings using lamp IDs. |
| `run` | Start the Art-Net receiver and Hue Entertainment stream. |

## Troubleshooting

- **No `/groups/200` area:** run `list-areas` and set `hue.entertainmentConfigurationId` to the required UUID.
- **Light/channel mapping mismatch:** rerun `auto-setup` after editing the Entertainment area.
- **Art-Net bind error:** set `artnet.host` to an address assigned to the local machine, or `0.0.0.0` to listen on all IPv4 interfaces.
- **No DMX response:** verify the universe and ensure UDP port 6454 is reachable. Frames shorter than the highest configured DMX channel are ignored.
- **DTLS failure:** ensure UDP port 2100 is reachable, no other application owns the Entertainment area, and the stored `clientKey` came from pairing with this bridge.
- **Certificate mismatch:** verify that `hue.host` points to the paired Hue Bridge rather than a proxy or another device.

See [docs/architecture.md](docs/architecture.md) for protocol and lifecycle details.

## Protocol references

- [Philips Hue developer program](https://developers.meethue.com/)
- [Art-Net specification](https://artisticlicence.com/WebSiteMaster/User%20Guides/art-net.pdf)

## License

MIT — see [LICENSE.txt](LICENSE.txt).
