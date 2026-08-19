# Docker quick start

This directory contains the two supported Compose definitions:

- `compose.yaml` deploys `ghcr.io/einlichtvogel/artnet-hue-entertainment:latest` on a server.
- `compose.local.yaml` builds and tests the source checked out in this repository.

Both definitions mount their own directory as the container's working directory. They therefore read and write `config.json` beside the selected Compose file, even for temporary containers created with `docker compose run --rm`. The file is ignored by Git because it contains Hue credentials.

Run the following commands from the repository root. On Linux, set the container identity to the current user so it can create and update the configuration:

```bash
export ARTNET_HUE_UID="$(id -u)"
export ARTNET_HUE_GID="$(id -g)"
```

## Server deployment

Pair with the Hue Bridge. This command creates `docker/config.json` with owner-only permissions when the file does not exist:

```bash
docker compose -f docker/compose.yaml pull
docker compose -f docker/compose.yaml run --rm bridge pair --ip 192.168.1.10
docker compose -f docker/compose.yaml run --rm bridge list-areas
```

If the required area is not the legacy `/groups/200` area, put the UUID shown by `list-areas` in `hue.entertainmentConfigurationId`. Also set `artnet.host` (normally `0.0.0.0`) and the required universe in `docker/config.json`.

Generate consecutive DMX mappings and start the service:

```bash
docker compose -f docker/compose.yaml run --rm bridge auto-setup --overwrite
docker compose -f docker/compose.yaml up -d
docker compose -f docker/compose.yaml logs -f bridge
```

`auto-setup` reads the adjacent configuration automatically. A missing file is a valid starting point for `pair`, but `auto-setup` cannot succeed until pairing credentials have been saved.

To stop or update the service:

```bash
docker compose -f docker/compose.yaml down
docker compose -f docker/compose.yaml pull
docker compose -f docker/compose.yaml up -d
```

## Local testing

The local definition builds the runtime image from the current checkout and uses the same adjacent configuration:

```bash
docker compose -f docker/compose.local.yaml build
docker compose -f docker/compose.local.yaml run --rm bridge --help
docker compose -f docker/compose.local.yaml run --rm bridge auto-setup --overwrite
docker compose -f docker/compose.local.yaml up -d
docker compose -f docker/compose.local.yaml logs -f bridge
```

Stop the local container with:

```bash
docker compose -f docker/compose.local.yaml down
```

The local definition uses `pull_policy: build`, so commands use an image built from the checkout rather than pulling GHCR. Docker's build cache keeps unchanged rebuilds short.

## Configuration examples

For manual setup, copy one of the examples before editing it:

```bash
cp docker/config.lights.example.json docker/config.json
```

Use `config.lights.example.json` for normal lamp-ID mappings and `config.channels.example.json` only for advanced segment-level control. See [LIGHT-MODES.md](../LIGHT-MODES.md) for supported layouts and addressing rules.

For network behavior, server copies, image tags, and publishing details, see [DEPLOYMENT.md](DEPLOYMENT.md).
