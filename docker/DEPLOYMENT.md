# Docker deployment

The server definition pulls `ghcr.io/einlichtvogel/artnet-hue-entertainment:latest`; the local definition builds the runtime image from the repository root. Both run the compiled Node.js application as an unprivileged UID/GID and use host networking for Art-Net broadcasts and direct Hue LAN access.

## Relative configuration

Compose resolves `./` relative to the Compose file, not the shell's current directory. Both definitions bind that directory to `/data`, make it the working directory, and invoke the CLI through its absolute image path. Consequently, the CLI's default `config.json` always resolves beside the Compose file, including when a service command is replaced by `run --rm`.

The directory bind is intentional: Docker cannot reliably bind a host file that does not exist yet as a writable file. Binding the containing directory lets `pair` create `config.json` atomically. Set `ARTNET_HUE_UID` and `ARTNET_HUE_GID` to an identity that can write to the deployment directory.

```bash
export ARTNET_HUE_UID="$(id -u)"
export ARTNET_HUE_GID="$(id -g)"
docker compose -f docker/compose.yaml run --rm bridge pair --ip 192.168.1.10
```

The resulting file contains credentials, is written with owner-only permissions, and must not be committed or shared.

## Independent server deployments

For another server instance, copy the server Compose file into its own directory. Its relative mount gives the copy an independent adjacent `config.json`:

```bash
mkdir -p deployments/stage
cp docker/compose.yaml deployments/stage/compose.yaml
docker compose -f deployments/stage/compose.yaml run --rm bridge pair --ip 192.168.1.10
docker compose -f deployments/stage/compose.yaml up -d
```

Every running instance needs its own credentials, mappings, and Entertainment area. A Hue Entertainment area can be owned by only one active application.

## Network behavior

The supplied definitions use `network_mode: host`, the most reliable arrangement for Art-Net broadcasts on Linux. Set `artnet.host` to a host-interface address or `0.0.0.0`.

Multiple host-network instances can share UDP 6454 because the receiver enables address reuse. Broadcast frames reach all instances, which filter their configured universe. Unicast delivery to multiple sockets is platform-dependent.

Docker Desktop host networking must be enabled on supported macOS and Windows versions. If host networking is unavailable, replace it with `ports: ["6454:6454/udp"]` and send unicast Art-Net to the Docker host. Only one bridged instance can publish that port per host address.

Stop containers normally so the application can close DTLS and release the Hue Entertainment area after Docker sends `SIGTERM`.

## Image publishing

The workflow in `.github/workflows/container.yml` runs the Node.js checks, validates both Compose files, and builds the runtime image for AMD64 and ARM64. Pushes to `main`, version tags, and manual dispatches publish to GHCR; pull requests build without publishing.

The `latest` tag follows `main`. Version tags such as `v1.2.3` also publish `1.2.3` and `1.2`, and every published image receives an immutable `sha-<commit>` tag. Published images receive a GitHub artifact attestation tied to their registry digest.
