# PhotoBrick

PhotoBrick turns a photo into a buildable mosaic of round 1x1 tiles (LEGO® part 98138). Every colour
it uses is one you can actually buy, and it gives you the parts list, shopping-cart exports and
printable panel-by-panel instructions to build it.

<img width="1354" height="866" alt="image" src="https://github.com/user-attachments/assets/ffde9839-b5d0-4d20-a90b-5f9656b80963" />


- **Your photo stays on your device.** All image processing runs in your browser. The photo is never
  uploaded; a share link carries only the finished grid of colour ids.
- **Real, buyable colours.** The palette is built from Rebrickable's data and limited to colours that
  98138 is currently made in.
- **Ready to build.** You get a parts list with counts and cost estimates, exports for BrickLink,
  LEGO Pick a Brick and Rebrickable, and instructions to print.

## Features (v0.1)

1. **Open a photo** from your phone or computer: the file picker, drag and drop anywhere on the
   page, or paste from the clipboard. Three public-domain examples are one click away. JPEG, PNG,
   WebP, AVIF and anything else the browser decodes work; HEIC gets clear advice where the browser
   can't read it.
2. **See the mosaic straight away** in a zoomable WebGL viewer (flat Canvas2D fallback) with real
   stud shading, a 16 × 16 panel grid, **hold to compare** with the photo and, on desktop, a
   before/after split slider.
3. **Pick the size** in 16 × 16 panels: S/M/L/XL presets that follow the photo's shape, the
   48 × 48 LEGO® Art size, or 1–10 panels each way. Each option shows studs, centimetres, pieces
   and an estimated price. **Adjust the crop** by dragging and pinching the mosaic itself; a warning
   appears when the photo has too few pixels for the size.
4. **Choose a style** (Natural, which keeps skin tones natural, Faithful, Sepia or Greyscale) and
   fine-tune texture, skin protection, exposure, contrast, saturation, detail, single-stud
   clean-up and the base plate colour. Every change regenerates the mosaic live.
5. **Control the colours**: turn palette colours on and off (rare colours and those not sold on
   Pick a Brick are marked), cap the number of colours, and merge colours used only a few times.
6. **Get the parts list** with spares, base plates and BrickLink / Pick a Brick cost estimates, and
   export it as a BrickLink wanted list (XML), a LEGO Pick a Brick list (CSV) or a Rebrickable
   parts list (CSV). Download the mosaic as a PNG at 20 px per stud.
7. **Print building instructions**: an A4 cover with the whole mosaic, the panel map and the colour
   legend, then one page per panel with every stud's colour and 2-letter code. Print or save as PDF
   from Chrome or Firefox.
8. **Share a link** to the mosaic. The link carries only the colour grid (in the `#` fragment, which
   never reaches a server); people who open it see the mosaic, the parts list and the instructions.
9. **Private by design**: the photo is decoded and processed only in your browser, there are no
   cookies or analytics, and only your look preferences are remembered locally.

## Architecture

- A **React + MUI** single-page app (Vite), with the mosaic engine in **plain TypeScript** running in
  a Web Worker: 2–25 ms per regeneration on a desktop, no WebAssembly.
- A **WebGL2** viewer draws every stud in one draw call, with a Canvas2D fallback.
- A small **Go** binary (standard library only) embeds the built app and serves it with strict
  security headers. It will later add short share links and preview images. The app also works
  without it, from any static host.

The decisions, public APIs and algorithm spec are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The
benchmarks and research behind them are in [docs/research/](docs/research/).

## Requirements

- Node.js 22.12 or newer and pnpm 10
- Go 1.25 or newer (only to build the server binary)
- GNU make (optional; wraps the commands below)

## Quick start

```sh
pnpm install          # or: make install (uses the lockfile as is)
pnpm dev              # Vite dev server with hot reload on http://localhost:5173
```

You don't need the Go server during development. To build and run the production binary, with the
app embedded:

```sh
make build            # pnpm build, then go build -> out/photobrick
./out/photobrick      # serves on http://127.0.0.1:8080 (-addr or PHOTOBRICK_ADDR to change)
```

`make help` lists all targets: `test`, `lint`, `typecheck`, `dev`, `run`, `go-build`, `clean` and more.
A binary built without `make web` still runs, but answers `/` with a "UI not built" page.

## Repository layout

| Path | What |
| --- | --- |
| `apps/web` | The React app: screens, the engine worker, the WebGL2/Canvas2D viewer, printable instructions, i18n. |
| `packages/engine` | The pure TypeScript engine: colour science, resampling, quantisers, parts list, cost, exports, share codec. Tested with vitest. |
| `tools/palette` | Builds the palette JSON in `packages/engine/src/palette/` from the Rebrickable downloads. |
| `server` | The Go server. `internal/webui/dist` receives the Vite build and is embedded with `go:embed`. |
| `deploy` | systemd unit and Caddyfile. |
| `docs` | Architecture and research reports. |
| `Makefile` | Build, test and run targets. |

## Deployment

The binary is static and has no runtime dependencies. It listens on `127.0.0.1:8080`; Caddy in front
of it provides HTTPS and compression.

```sh
make build
sudo install -m 0755 out/photobrick /usr/local/bin/photobrick
sudo install -m 0644 deploy/photobrick.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now photobrick
curl -s http://127.0.0.1:8080/healthz    # ok
```

- The unit runs the server as a dynamic user under a tight sandbox; `systemd-analyze security
  photobrick` rates it 0.9 ("SAFE") on systemd 259.
- Add the site block from [deploy/Caddyfile](deploy/Caddyfile) to your Caddy configuration, with your
  domain, and reload Caddy.
- The server logs one line per request (method, path, status, bytes, duration) to the journal. It
  never logs query strings.
- To upgrade, install the new binary and run `sudo systemctl restart photobrick`. In-flight requests
  get up to 10 seconds to finish.

## Palette refresh

The palette is generated at build time, never at run time, so results don't change under a user
mid-project. See [tools/palette/README.md](tools/palette/README.md) for the sources and the rules;
`pnpm palette` rebuilds it. Commit the regenerated JSON after reviewing the diff.

## Legal

- LEGO® is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this site.
- PhotoBrick is an unofficial fan project. Following LEGO's Fair Play policy, it doesn't use the LEGO
  logo or put "LEGO" in its domain name.
- Colour and part data from Rebrickable ([rebrickable.com](https://rebrickable.com)). Rebrickable's
  licence for its downloads requires this credit.
- BrickLink and Pick a Brick are only export targets; PhotoBrick doesn't use their APIs.

## Licence

TBD by the author.
