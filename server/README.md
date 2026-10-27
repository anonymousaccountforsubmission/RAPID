# RAPID Backend Server

Real-time dispersion API and data ingestion pipeline.

## Files
- model_server.py: HTTP server running on port 5001.
- realtime_pipeline.py: Ingests NOAA weather and NEI stack data.
- model.py: Bridge between API endpoints and PINN surrogate model.

## Endpoints
- GET /api/weather: Current NOAA observations for Houston Hobby (KHOU).
- GET /api/realtime: Live benzene concentrations across Houston tracts.
- GET /api/facilities: Industrial point source stack specifications.
- POST /predict: Run emission reduction simulation.

## Run from the repository root
```bash
python3 server/model_server.py
```

The same process serves the mobile application and API, so no CORS configuration or second static server is required.
