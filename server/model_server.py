#!/usr/bin/env python3
"""
RAPID: Atmospheric Dispersion Model Server
Port: 5001
Zero external dependencies required (uses standard library http.server).

This server acts as the plug-and-play bridge for any model you paste into the workspace.
It auto-detects any pasted model files:
- model.py
- surrogate_model.py
- dispersion_model.py
- aermod_surrogate.py

Usage:
  python model_server.py         # Start HTTP bridge on port 5001
  python model_server.py --test  # Run standalone verification test
"""

import os
import sys
import json
import math
import importlib.util
import urllib.error
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(os.environ.get("RAPID_PORT", "5001"))
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SERVER_DIR)
APP_DIR = os.path.join(PROJECT_DIR, "app")

# Potential model filenames to search for in the workspace
CANDIDATE_MODEL_FILES = [
    "dispersion_model.py",
    "surrogate_model.py",
    "aermod_surrogate.py",
    "aermod_model.py",
    "model.py",
    "surrogate.py"
]

loaded_custom_module = None
loaded_model_name = "Calibrated AERMOD Physics Engine"

def discover_and_load_model():
    """Dynamically discover and import any user-pasted model in the workspace."""
    global loaded_custom_module, loaded_model_name

    if loaded_custom_module is not None:
        return True

    search_paths = [SERVER_DIR, os.path.join(PROJECT_DIR, "pinn")]

    for search_dir in search_paths:
        if not os.path.isdir(search_dir):
            continue
        for candidate in CANDIDATE_MODEL_FILES:
            full_path = os.path.join(search_dir, candidate)
            if os.path.isfile(full_path):
                try:
                    spec = importlib.util.spec_from_file_location("custom_rapid_model", full_path)
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    loaded_custom_module = mod
                    loaded_model_name = f"Custom Model ({candidate})"
                    print(f"[*] Successfully loaded custom model from: {full_path}")
                    return True
                except Exception as e:
                    print(f"[!] Found {candidate} but error importing: {e}")

    loaded_custom_module = None
    loaded_model_name = "Calibrated AERMOD Physics Engine"
    return False

def calculate_gaussian_dispersion(q_rate, stack_lat, stack_lng, rec_lat, rec_lng, wind_speed, wind_dir_deg, stack_h=45.0):
    """
    Standard steady-state Gaussian Plume atmospheric dispersion calculation.
    Q: emission rate (g/s)
    wind_speed: m/s
    wind_dir_deg: degrees clockwise from North
    """
    # Distance in meters (haversine)
    R = 6371000.0
    phi1 = math.radians(stack_lat)
    phi2 = math.radians(rec_lat)
    dphi = math.radians(rec_lat - stack_lat)
    dlambda = math.radians(rec_lng - stack_lng)

    a = math.sin(dphi/2.0)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    dist_m = R * c

    if dist_m < 50.0:
        dist_m = 50.0

    # Bearing from stack to receptor
    y_b = math.sin(dlambda) * math.cos(phi2)
    x_b = math.cos(phi1)*math.sin(phi2) - math.sin(phi1)*math.cos(phi2)*math.cos(dlambda)
    bearing_deg = (math.degrees(math.atan2(y_b, x_b)) + 360.0) % 360.0

    # Plume downwind vector
    # Wind direction is where wind blows FROM; plume travels toward (wind_dir + 180) % 360
    plume_dir_deg = (wind_dir_deg + 180.0) % 360.0
    angle_diff_rad = math.radians((bearing_deg - plume_dir_deg + 180.0) % 360.0 - 180.0)

    downwind_x = dist_m * math.cos(angle_diff_rad)
    crosswind_y = dist_m * math.sin(angle_diff_rad)

    # If upwind, minimal dispersion contribution
    if downwind_x <= 0:
        return 0.05

    # Pasquill-Gifford Stability Class C (urban daytime) coefficients
    x_km = downwind_x / 1000.0
    sigma_y = 104.0 * (x_km ** 0.894)
    sigma_z = 61.0 * (x_km ** 0.911)

    sigma_y = max(sigma_y, 10.0)
    sigma_z = max(sigma_z, 5.0)

    u = max(wind_speed, 0.5)

    # Ground-level concentration equation (µg/m³)
    # Q in g/s * 10^6 to get µg/s
    q_ug = q_rate * 1e6
    term1 = q_ug / (math.pi * u * sigma_y * sigma_z)
    term2 = math.exp(-0.5 * (crosswind_y / sigma_y)**2)
    term3 = math.exp(-0.5 * (stack_h / sigma_z)**2)

    conc_ug_m3 = term1 * term2 * term3
    return conc_ug_m3

def run_model_inference(payload):
    """Unified inference dispatcher."""
    discover_and_load_model()

    fac_id = payload.get("facility_id", "fac-valero")
    red_pct = float(payload.get("reduction_percent", 50))
    rec_id = payload.get("receptor_id", "tract-manchester")
    rec_lat = float(payload.get("receptor_lat", 29.7150))
    rec_lng = float(payload.get("receptor_lng", -95.2600))
    stack_lat = float(payload.get("stack_lat", 29.7180))
    stack_lng = float(payload.get("stack_lng", -95.2530))
    wind_speed = float(payload.get("wind_speed_ms", 3.4))
    wind_dir = float(payload.get("wind_dir_deg", 135))

    # Check if user-pasted model exposes a predict function
    if loaded_custom_module is not None:
        for fn_name in ["predict_benzene", "predict_concentration", "predict", "run_dispersion"]:
            if hasattr(loaded_custom_module, fn_name):
                fn = getattr(loaded_custom_module, fn_name)
                try:
                    res = fn(payload)
                    if isinstance(res, dict):
                        return res
                    elif isinstance(res, (int, float)):
                        base = 2.59
                        sim = float(res)
                        return {
                            "model_name": loaded_model_name,
                            "baseline_concentration": base,
                            "simulated_concentration": round(sim, 2),
                            "absolute_delta": round(sim - base, 2),
                            "percent_change": round(((sim - base)/base) * 100, 1)
                        }
                except Exception as e:
                    print(f"[!] Error running {fn_name} in custom model: {e}")

    # Default AERMOD Physics Formulation
    # 12.8 tons/year Benzene = ~0.368 g/s baseline stack rate
    base_q_gs = 0.368
    fac_contribution_base = calculate_gaussian_dispersion(
        base_q_gs, stack_lat, stack_lng, rec_lat, rec_lng, wind_speed, wind_dir
    )

    # Background urban ambient concentration in Houston Ship Channel
    background = 1.05
    baseline_total = round(background + fac_contribution_base, 2)

    # Calculate simulated reduction
    cut_factor = 1.0 - (red_pct / 100.0)
    sim_q_gs = base_q_gs * cut_factor
    fac_contribution_sim = calculate_gaussian_dispersion(
        sim_q_gs, stack_lat, stack_lng, rec_lat, rec_lng, wind_speed, wind_dir
    )
    simulated_total = round(background + fac_contribution_sim, 2)

    delta = round(simulated_total - baseline_total, 2)
    pct_change = round(((simulated_total - baseline_total) / baseline_total) * 100, 1)

    return {
        "model_name": loaded_model_name,
        "facility_id": fac_id,
        "receptor_id": rec_id,
        "reduction_percent": red_pct,
        "baseline_concentration": baseline_total,
        "simulated_concentration": simulated_total,
        "absolute_delta": delta,
        "percent_change": pct_change,
        "status": "success"
    }

def _gemini_status():
    return {
        "available": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
        "provider": "Google Gemini",
        "model": os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
    }


def _run_gemini(payload):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    query = str(payload.get("query", "")).strip()
    if not query or len(query) > 4000:
        raise ValueError("query must contain between 1 and 4000 characters")

    scenario = payload.get("scenario", {})
    history = payload.get("history", [])
    if not isinstance(scenario, dict) or not isinstance(history, list):
        raise ValueError("scenario and history have invalid formats")

    system_text = (
        "You are RAPID's air-quality investigator. Answer only from the supplied "
        "scenario data. Distinguish modeled estimates, observations, regulatory "
        "standards, and risk-screening values. Never call a screening value a safe "
        "limit. Keep answers concise, include units, and state uncertainty when relevant."
    )
    contents = []
    for message in history[-6:]:
        if not isinstance(message, dict):
            continue
        text = str(message.get("text", ""))[:4000]
        role = "model" if message.get("role") == "assistant" else "user"
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})
    contents.append({
        "role": "user",
        "parts": [{"text": f"Scenario JSON:\n{json.dumps(scenario)}\n\nQuestion: {query}"}]
    })

    model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    request = urllib.request.Request(
        url,
        data=json.dumps({
            "system_instruction": {"parts": [{"text": system_text}]},
            "contents": contents,
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 900}
        }).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST"
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.loads(response.read().decode("utf-8"))
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    reply = "".join(part.get("text", "") for part in parts).strip()
    if not reply:
        raise RuntimeError("Gemini returned an empty response")
    return {"reply": reply, "model": model}


class ModelHTTPRequestHandler(SimpleHTTPRequestHandler):
    def _set_cors_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_cors_headers(204)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            discover_and_load_model()
            self._set_cors_headers(200)
            resp = {
                "status": "healthy",
                "model_name": loaded_model_name,
                "has_custom_model": loaded_custom_module is not None
            }
            self.wfile.write(json.dumps(resp).encode("utf-8"))
        elif path == "/api/ai/status":
            self._set_cors_headers(200)
            self.wfile.write(json.dumps(_gemini_status()).encode("utf-8"))
        elif path in ("/api/realtime", "/realtime"):
            try:
                import realtime_pipeline
                data = realtime_pipeline.get_cached_realtime_state()
                self._set_cors_headers(200)
                self.wfile.write(json.dumps(data).encode("utf-8"))
            except Exception as e:
                self._set_cors_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        elif path in ("/api/weather", "/weather"):
            try:
                import realtime_pipeline
                w = realtime_pipeline.fetch_noaa_weather()
                self._set_cors_headers(200)
                self.wfile.write(json.dumps(w).encode("utf-8"))
            except Exception as e:
                self._set_cors_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        elif path in ("/api/facilities", "/facilities"):
            try:
                import realtime_pipeline
                facs = realtime_pipeline.fetch_nei_facilities()
                self._set_cors_headers(200)
                self.wfile.write(json.dumps(facs).encode("utf-8"))
            except Exception as e:
                self._set_cors_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            super().do_GET()

    def _read_json(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 1_000_000:
            raise ValueError("Request body is too large")
        body = self.rfile.read(content_length)
        return json.loads(body.decode("utf-8")) if body else {}

    def do_POST(self):
        path = urlparse(self.path).path
        if path in ("/predict", "/api/simulate"):
            try:
                payload = self._read_json()
                result = run_model_inference(payload)
                self._set_cors_headers(200)
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except (ValueError, json.JSONDecodeError) as e:
                self._set_cors_headers(400)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            except Exception as e:
                self._set_cors_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        elif path == "/api/ai":
            try:
                result = _run_gemini(self._read_json())
                self._set_cors_headers(200)
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except (ValueError, json.JSONDecodeError) as e:
                self._set_cors_headers(400)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            except urllib.error.HTTPError as e:
                self._set_cors_headers(502)
                self.wfile.write(json.dumps({"error": f"Gemini API returned HTTP {e.code}"}).encode("utf-8"))
            except Exception as e:
                self._set_cors_headers(503)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            self._set_cors_headers(404)
            self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode("utf-8"))

def run_server():
    discover_and_load_model()
    # start realtime pipeline worker
    try:
        import realtime_pipeline
        realtime_pipeline.start_pipeline_worker(interval=300)
        print("[*] Real-time NOAA + NEI pipeline worker started (5 min interval)")
    except Exception as e:
        print(f"[!] Real-time pipeline worker error: {e}")

    server_address = ("", PORT)
    handler = partial(ModelHTTPRequestHandler, directory=APP_DIR)
    httpd = ThreadingHTTPServer(server_address, handler)
    print(f"RAPID is running at http://localhost:{PORT}")
    print(f"Model: {loaded_model_name}")
    print(f"Gemini: {'configured' if _gemini_status()['available'] else 'local fallback'}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Shutting down model server.")
        httpd.server_close()

if __name__ == "__main__":
    if "--test" in sys.argv:
        print("[*] Running standalone model inference test...")
        test_payload = {
            "facility_id": "fac-valero",
            "facility_name": "Valero Houston Refinery",
            "stack_lat": 29.7180,
            "stack_lng": -95.2530,
            "reduction_percent": 50,
            "receptor_id": "tract-manchester",
            "receptor_lat": 29.7150,
            "receptor_lng": -95.2600,
            "pollutant": "BENZENE",
            "wind_speed_ms": 3.4,
            "wind_dir_deg": 135
        }
        res = run_model_inference(test_payload)
        print(json.dumps(res, indent=2))
    else:
        run_server()
