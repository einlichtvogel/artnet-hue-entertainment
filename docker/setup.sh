#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG_DIR="$SCRIPT_DIR/data/default"
CONFIG_FILE="$CONFIG_DIR/config.json"
EXAMPLE_FILE="$SCRIPT_DIR/config.lights.example.json"

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed or not available in PATH."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available."
docker info >/dev/null 2>&1 || fail "The Docker daemon is not running."

if [ -e "$CONFIG_FILE" ]; then
    fail "$CONFIG_FILE already exists. Move or remove it before running initial setup again."
fi

BRIDGE_IP=${1:-}
while [ -z "$BRIDGE_IP" ]; do
    printf 'Hue Bridge IP address: '
    IFS= read -r BRIDGE_IP
done

printf 'Art-Net universe [0]: '
IFS= read -r ARTNET_UNIVERSE
ARTNET_UNIVERSE=${ARTNET_UNIVERSE:-0}
case "$ARTNET_UNIVERSE" in
    *[!0-9]*|'') fail "The Art-Net universe must be an integer between 0 and 32767." ;;
esac
if [ "$ARTNET_UNIVERSE" -gt 32767 ]; then
    fail "The Art-Net universe must be an integer between 0 and 32767."
fi

printf '\nSelect the DMX mode for all bulbs:\n'
printf '  1) 8bit            (RGB, 3 channels)\n'
printf '  2) 8bit-dimmable   (Dimmer + RGB, 4 channels; recommended)\n'
printf '  3) 16bit           (RGB coarse/fine, 6 channels)\n'
printf '  4) 16bit-dimmable  (Dimmer + RGB coarse/fine, 8 channels)\n'
LIGHT_MODE=
while [ -z "$LIGHT_MODE" ]; do
    printf 'Mode [2]: '
    IFS= read -r MODE_SELECTION
    case "${MODE_SELECTION:-2}" in
        1|8bit) LIGHT_MODE=8bit ;;
        2|8bit-dimmable) LIGHT_MODE=8bit-dimmable ;;
        3|16bit) LIGHT_MODE=16bit ;;
        4|16bit-dimmable) LIGHT_MODE=16bit-dimmable ;;
        *) printf 'Please select 1, 2, 3, or 4.\n' >&2 ;;
    esac
done

export ARTNET_HUE_UID=${ARTNET_HUE_UID:-$(id -u)}
export ARTNET_HUE_GID=${ARTNET_HUE_GID:-$(id -g)}

mkdir -p "$CONFIG_DIR"
cp "$EXAMPLE_FILE" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

CLEAN_INCOMPLETE_CONFIG=1
cleanup() {
    status=$?
    trap - EXIT HUP INT TERM
    if [ "$status" -ne 0 ] && [ "$CLEAN_INCOMPLETE_CONFIG" -eq 1 ]; then
        rm -f "$CONFIG_FILE"
        printf 'Removed incomplete configuration: %s\n' "$CONFIG_FILE" >&2
    fi
    exit "$status"
}
trap cleanup EXIT HUP INT TERM

cd "$SCRIPT_DIR"

printf '\nPulling the current container image...\n'
docker compose pull

printf '\nPress the link button on the Hue Bridge, then press Enter here.\n'
IFS= read -r _continue

docker compose run --rm bridge pair --ip "$BRIDGE_IP" --config /data/config.json

printf '\nAvailable Hue Entertainment areas:\n'
docker compose run --rm bridge list-areas --config /data/config.json

AREA_ID=
while [ -z "$AREA_ID" ]; do
    printf '\nEntertainment area UUID: '
    IFS= read -r AREA_ID
done

docker compose run --rm \
    -e HUE_AREA_ID="$AREA_ID" \
    -e ARTNET_UNIVERSE="$ARTNET_UNIVERSE" \
    --entrypoint node \
    bridge \
    -e '
const fs = require("node:fs");
const path = "/data/config.json";
const config = JSON.parse(fs.readFileSync(path, "utf8"));
config.artnet.host = "0.0.0.0";
config.artnet.universe = Number(process.env.ARTNET_UNIVERSE);
config.hue.entertainmentConfigurationId = process.env.HUE_AREA_ID;
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {mode: 0o600});
fs.chmodSync(path, 0o600);
'

printf '\nGenerating lamp-ID mappings...\n'
docker compose run --rm bridge auto-setup --mode "$LIGHT_MODE" --config /data/config.json

CLEAN_INCOMPLETE_CONFIG=0

printf '\nStarting the bridge...\n'
docker compose up -d

printf '\nSetup complete. Configuration: %s\n' "$CONFIG_FILE"
printf 'Follow logs with: cd %s && docker compose logs -f bridge\n' "$SCRIPT_DIR"
