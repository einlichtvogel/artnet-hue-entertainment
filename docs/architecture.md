# Architecture

## Data flow

```text
ArtDMX UDP :6454
       │ universe and frame-length validation
       ▼
DMX mapping (8-bit, dimmable, or 16-bit)
       │ unsigned 16-bit RGB per Entertainment channel
       ▼
50 Hz coalescing scheduler and one-second keepalive
       │ HueStream v2 over DTLS 1.2 PSK, UDP :2100
       ▼
Hue Bridge → Entertainment area lights
```

Standard color bulbs normally occupy one Entertainment channel. Gradient products can expose multiple channels for independently addressable segments. Channel IDs are local to an Entertainment configuration and are assigned by the bridge.

The user-facing default is `hue.lights`: numeric Hue light IDs are resolved to their v2 Entertainment service and then to every matching channel at startup. This keeps ordinary lamp configuration stable and readable. A gradient lamp's segments share the lamp's DMX mapping. The optional `hue.channels` form bypasses that resolution for advanced per-segment control or resources without a legacy light ID.

## CLIP v2 and Axios

`HueApiClient` is a deliberately narrow wrapper over Axios. It performs pairing, resource discovery, light utilities, and Entertainment start/stop operations. Authenticated CLIP v2 requests send the paired username as the `hue-application-key` header.

Hue bridges use a self-signed local certificate. Before authenticated requests, the client reads the public bridge ID and verifies that it matches the certificate subject common name. Credentials and application keys are excluded from error messages.

Pairing still uses `POST /api` with `generateclientkey`; this is the Hue bootstrap operation that creates both the v2 application key and the DTLS pre-shared key.

## HueStream v2

Each packet contains:

1. The nine-byte ASCII header `HueStream`.
2. Version `2.0`, sequence, reserved, and RGB color-space fields for a 16-byte header.
3. The selected Entertainment configuration's 36-byte ASCII UUID.
4. Seven bytes per update: one-byte channel ID and big-endian 16-bit red, green, and blue values.

The scheduler sends no more than one packet every 20 ms. If Art-Net frames arrive faster, only the newest pending state is retained. When DMX stops, the last packet is repeated once per second to keep the Entertainment session alive.

## Lifecycle

Startup is transactional:

1. Parse and validate configuration.
2. Resolve configured lamp IDs to the v2 Entertainment configuration's channels, or validate explicit channel mappings.
3. Request Entertainment streaming mode through CLIP v2.
4. Complete the DTLS handshake.
5. Bind the Art-Net listener.
6. Send an initial black frame.

If any stage fails, completed stages are unwound in reverse order. Shutdown is idempotent and handles `SIGINT`, `SIGTERM`, an unexpected DTLS close, and partial startup. Art-Net is closed before the Entertainment area is released.

## Testing boundaries

Network and time-dependent components are represented by small interfaces or injected factories. Tests use mocked Axios adapters, DTLS sockets, Art-Net receivers, clocks, and timers. Pure functions cover configuration parsing, legacy mapping, DMX conversion, and packet encoding.
