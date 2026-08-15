# Run the image locally

This deployment runs the locally built `artnet-hue-entertainment:local` image. It never pulls from GHCR and uses an isolated configuration under `docker/data/local-test`.

Run all commands from the repository root.

## Build the current source

```bash
docker compose -f compose.build.yaml build
```

## Prepare the configuration

To test with an existing configuration:

```bash
mkdir -p docker/data/local-test
cp config.json docker/data/local-test/config.json
export ARTNET_HUE_UID="$(id -u)"
export ARTNET_HUE_GID="$(id -g)"
```

Alternatively, copy the lamp-ID example and fill in the Hue Bridge address, credentials, Entertainment area UUID, Art-Net universe, and lamp IDs:

```bash
mkdir -p docker/data/local-test
cp docker/config.lights.example.json docker/data/local-test/config.json
```

## Smoke-test the CLI

This checks that the image starts without starting the Art-Net/Hue stream:

```bash
docker compose -f docker/local-test/compose.yaml run --rm bridge --help
```

## Start the bridge

```bash
docker compose -f docker/local-test/compose.yaml up -d
docker compose -f docker/local-test/compose.yaml logs -f bridge
```

Stop and remove the test container with:

```bash
docker compose -f docker/local-test/compose.yaml down
```

After changing source code, rebuild the image before starting it again:

```bash
docker compose -f compose.build.yaml build
docker compose -f docker/local-test/compose.yaml up -d
```

On Docker Desktop, host networking must be enabled. The test container needs UDP 6454 for Art-Net and outbound access to the Hue Bridge on its local network.
