# Docker quick start

This folder contains only the files needed to deploy the published image: Compose definitions, example configurations, and runtime documentation. The default Compose setup runs `ghcr.io/einlichtvogel/artnet-hue-entertainment:latest` with host networking so it can receive Art-Net broadcasts and reach the Hue Bridge directly.

## Start one instance

Run the interactive initial setup from the repository root:

```bash
./docker/setup.sh
```

You can optionally provide the Hue Bridge address directly:

```bash
./docker/setup.sh 192.168.1.10
```

The script checks Docker, creates `data/default/config.json`, pulls the current image, pairs with the bridge, shows the available Entertainment areas, sets the Art-Net universe, asks for the DMX mode, assigns consecutive addresses from the lowest light ID upward, and starts the service. It never overwrites an existing configuration unless `--overwrite` is provided.

To replace an existing setup deliberately, use `--overwrite`. The previous configuration is backed up and restored automatically if the new setup fails:

```bash
./docker/setup.sh --overwrite 192.168.1.10
```

For manual setup, enter this directory and copy the recommended example:

```bash
cd docker
mkdir -p data/default
cp config.lights.example.json data/default/config.json
```

`auto-setup` creates the recommended lamp-ID mappings. Use `config.channels.example.json` only when you need advanced segment-level control with Hue Entertainment channel IDs.

When running auto-setup manually against a configuration that already contains `lights` or `channels`, confirm replacement explicitly:

```bash
docker compose run --rm bridge auto-setup --overwrite --mode 16bit --config /data/config.json
```

See [LIGHT-MODES.md](LIGHT-MODES.md) for all supported DMX layouts, channel widths, addressing examples, and the difference between lamp and channel mappings.

## Multiple instances

Give every instance its own directory and configuration:

```bash
mkdir -p data/main data/stage
cp config.lights.example.json data/main/config.json
cp config.lights.example.json data/stage/config.json
docker compose -f compose.multiple.example.yaml up -d
```

Configure different Entertainment areas or bridges. A Hue Entertainment area can be controlled by only one active instance.

## Update or build locally

```bash
docker compose pull
docker compose up -d
```

Build files are kept in the repository root. To build and run the checked-out source instead of pulling GHCR:

```bash
cd ..
docker compose -f compose.build.yaml up -d --build
```

For an isolated test using its own configuration, see [local-test/README.md](local-test/README.md).

For networking details, image tags, and Docker Desktop notes, see [DEPLOYMENT.md](DEPLOYMENT.md).
