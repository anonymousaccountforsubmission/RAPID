# RAPID

RAPID is a mobile-first Houston air-quality screening platform. It combines current NOAA meteorology, a packaged PyTorch physics-informed neural network (PINN), industrial point-source records, community indicators, emission-reduction scenarios, and an optional Gemini investigator.

## What runs in the demo

1. `server/realtime_pipeline.py` requests the latest observation from NOAA station KHOU and converts it into the boundary-layer inputs used by the dispersion model.
2. `pinn/houston_pinn_stack_v1_sens_best.pth` is loaded by `server/model.py`. Each facility/receptor pair is evaluated with the current wind field.
3. `server/model_server.py` exposes the predictions and simulation API and serves the mobile web application from the same origin.
4. The browser refreshes realtime predictions every five minutes. Simulation controls send the selected source, receptor, reduction, and current meteorology back through the PINN.
5. Ask RAPID sends a compact, grounded scenario to Gemini when `GEMINI_API_KEY` is configured. A deterministic scientific response engine remains available offline.

## Run locally

Python 3.10 or newer is recommended.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r pinn/requirements.txt
python3 server/model_server.py
```

Open `http://localhost:5001`. Do not launch `app/index.html` directly: the browser application expects the API routes served by the Python process.

To enable Gemini without exposing a key to the browser:

```bash
export GEMINI_API_KEY="your-key"
export GEMINI_MODEL="gemini-3.5-flash"  # optional override
python3 server/model_server.py
```

`RAPID_PORT` can be used to select a different port.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Model and server readiness |
| `GET` | `/api/weather` | Latest KHOU weather observation |
| `GET` | `/api/facilities` | Point-source inputs used by the pipeline |
| `GET` | `/api/realtime` | Cached weather and receptor predictions |
| `POST` | `/api/simulate` | PINN emission-reduction scenario |
| `GET` | `/api/ai/status` | Gemini availability, without revealing credentials |
| `POST` | `/api/ai` | Grounded investigator response |

## Verification

```bash
python3 -m unittest discover -s tests -v
node --test tests/frontend.test.mjs
python3 server/model_server.py --test
```

## Interpretation

RAPID is a screening and education tool. Its modeled values are not regulatory determinations, personal exposure measurements, emergency alerts, or medical advice. Realtime refers to current meteorological input; the source inventory and community indicators update on their own publication schedules. Scenario results hold all non-selected sources and regional background constant.

See [DATA_SOURCES.md](DATA_SOURCES.md) for provenance and limitations.

## Repository layout

- `app/`: installable mobile web interface and local scientific response engine
- `pinn/`: model architecture, physical closures, checkpoint, inference, and training entry point
- `server/`: same-origin HTTP API, NOAA ingestion, PINN bridge, and Gemini proxy
- `tests/`: backend and frontend regression checks
