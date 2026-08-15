# Docker deployment

The ready-to-use Compose files pull `ghcr.io/einlichtvogel/artnet-hue-entertainment:latest`. The image runs the compiled Node.js application as an unprivileged user and stores the writable configuration under `/data/config.json`. It exposes Art-Net UDP port 6454; Hue HTTPS and DTLS connections are outbound.

For a shorter setup guide and ready-to-copy configurations, see [`../docker/README.md`](../docker/README.md).

## Single instance

Create a host directory that the container user can write. The default UID/GID is 1000; override it when the host account uses different IDs.

```bash
mkdir -p docker-data/default
export ARTNET_HUE_UID="$(id -u)"
export ARTNET_HUE_GID="$(id -g)"
docker compose pull
```

To reuse an existing configuration:

```bash
cp config.json docker-data/default/config.json
```

For a fresh configuration, pair and generate lamp-ID mappings from inside temporary containers:

```bash
docker compose run --rm bridge pair --ip 192.168.1.10 --config /data/config.json
docker compose run --rm bridge list-areas --config /data/config.json
docker compose run --rm bridge auto-setup --config /data/config.json
```

Then start and inspect the service:

```bash
docker compose up -d
docker compose logs -f bridge
docker compose down
```

`docker compose run` uses the image entrypoint, so arguments begin with the CLI command rather than `node build/cli.js`.

## Multiple instances

Each instance needs its own writable configuration directory, credentials, Entertainment area, and DMX mapping. The example file defines `bridge-main` and `bridge-stage`:

```bash
mkdir -p docker-data/main docker-data/stage
cp config-main.json docker-data/main/config.json
cp config-stage.json docker-data/stage/config.json
docker compose -f compose.multiple.example.yaml up -d
docker compose -f compose.multiple.example.yaml logs -f
```

Add more services by copying one service block and assigning a new `docker-data/<name>` directory. Never mount the same configuration directory into two running instances.

Only one application can own a Hue Entertainment area at a time. Multiple containers must therefore use different areas or bridges.

## Network behavior

The supplied Compose files use `network_mode: host`. This is the most reliable arrangement for Art-Net broadcasts and direct Hue LAN access on Linux. Set `artnet.host` to a real host-interface address or `0.0.0.0`.

Multiple host-network instances can share UDP 6454 because the Art-Net receiver enables address reuse. Broadcast Art-Net frames reach all instances, which independently filter their configured universe. For unicast Art-Net on one Docker host, delivery to multiple sockets is platform-dependent; use broadcast, separate host addresses, or deploy the instances on different hosts.

Docker Desktop host networking must be enabled in Docker settings on supported macOS/Windows versions. If host networking is unavailable, remove `network_mode: host`, add `ports: ["6454:6454/udp"]`, and send unicast Art-Net to the Docker host. Only one such bridged instance can publish host port 6454 unless separate host addresses or nonstandard sender ports are used.

## Image commands

The `latest` image is built from the `main` branch for AMD64 and ARM64. Version tags such as `v1.2.3` additionally publish `1.2.3` and `1.2`. Every published image also gets an immutable `sha-<commit>` tag.

To build the current checkout locally instead of pulling GHCR, apply the build override:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

The image can also be used without Compose:

```bash
docker build -t artnet-hue-entertainment:local .
docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/docker-data/default:/data" \
  artnet-hue-entertainment:local list-lights --config /data/config.json
```

Stop containers normally so the application can close DTLS and release the Hue Entertainment area. Docker sends `SIGTERM` directly to the Node.js entrypoint, and the bridge performs its normal transactional shutdown.

## Publishing images

The GitHub Actions workflow in `.github/workflows/container.yml` runs the automated checks and builds the image on pull requests. Pushes to `main`, tags beginning with `v`, and manually dispatched runs publish to GitHub Container Registry. Publishing uses the repository's `GITHUB_TOKEN`; the repository must belong to `einlichtvogel` and GitHub Actions must have permission to create packages. No registry password is stored in the repository.
