# RAPID Application

Mobile application for atmospheric dispersion analysis, environmental justice mapping, and emission scenarios across Greater Houston.

## Features
- Interactive geospatial map with Houston industrial facility stacks and census tracts.
- Community demographic and air toxics exposure indicators.
- Simulation Studio for testing stack-level emission reductions in real time.
- Ask RAPID assistant with server-side Gemini integration and a local scientific fallback.

## File Structure
- index.html: Application interface and layout.
- styles.css: Mobile-first styling and theme tokens.
- app.js: Map rendering, tract interaction, and UI controllers.
- rapid-engine.js: Simulation engine and community health benchmarks.
- ai-service.js: Same-origin AI client and scientific fallback.
- model-bridge.js: Live bridge to the PINN and realtime APIs.
- sw.js: Service worker for offline mobile caching.

## Run Locally
Run `python3 server/model_server.py` from the repository root and open `http://localhost:5001`.
