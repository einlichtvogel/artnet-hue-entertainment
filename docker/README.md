# Docker quick start

The Compose setup runs `ghcr.io/einlichtvogel/artnet-hue-entertainment:latest` with host networking so it can receive Art-Net broadcasts and reach the Hue Bridge directly.

## Start one instance

From the repository root:

```bash
mkdir -p docker-data/default
cp docker/config.lights.example.json docker-data/default/config.json
export ARTNET_HUE_UID="$(id -u)"
export ARTNET_HUE_GID="$(id -g)"
```

Edit `docker-data/default/config.json`. Set the Hue Bridge address, credentials, Entertainment area UUID, Art-Net universe, and lamp IDs. Then start the service:

```bash
docker compose up -d
docker compose logs -f bridge
```

To create credentials from the container, press the Hue Bridge link button and run:

```bash
docker compose run --rm bridge pair --ip 192.168.1.10 --config /data/config.json
docker compose run --rm bridge list-areas --config /data/config.json
docker compose run --rm bridge auto-setup --config /data/config.json
```

`auto-setup` creates the recommended lamp-ID mappings. Use `config.channels.example.json` only when you need advanced segment-level control with Hue Entertainment channel IDs.

## Multiple instances

Give every instance its own directory and configuration:

```bash
mkdir -p docker-data/main docker-data/stage
cp docker/config.lights.example.json docker-data/main/config.json
cp docker/config.lights.example.json docker-data/stage/config.json
docker compose -f compose.multiple.example.yaml up -d
```

Configure different Entertainment areas or bridges. A Hue Entertainment area can be controlled by only one active instance.

## Update or build locally

```bash
docker compose pull
docker compose up -d
```

To build the checked-out source instead of pulling GHCR:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

For networking details, image tags, and Docker Desktop notes, see [`../docs/docker.md`](../docs/docker.md).
