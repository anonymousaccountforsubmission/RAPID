import os
import sys
import math
import time
import json
import threading
import urllib.request
import numpy as np

# add local pinn package to path
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
if not os.path.isdir(os.path.join(ROOT_DIR, "pinn")):
    ROOT_DIR = os.path.dirname(ROOT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from pinn import load_model, predict_concentration

PINN_DIR = os.path.join(ROOT_DIR, "pinn")

# default noaa weather station for houston ship channel
NOAA_STATION = "KHOU"
NOAA_API_URL = f"https://api.weather.gov/stations/{NOAA_STATION}/observations/latest"

# default nei facilities with stack specs
DEFAULT_NEI_FACILITIES = [
    {
        "id": "fac-valero",
        "nei_id": "4801001",
        "name": "Valero Houston Refinery",
        "lat": 29.7212,
        "lng": -95.2618,
        "h0": 35.0,
        "D": 2.5,
        "Ts": 450.0,
        "V": 15.0,
        "Q": 0.368,
        "annual_tons": 12.8
    },
    {
        "id": "fac-galveston-bay",
        "nei_id": "4835311",
        "name": "Galveston Bay Refinery",
        "lat": 29.3737,
        "lng": -94.9325,
        "h0": 45.0,
        "D": 3.2,
        "Ts": 480.0,
        "V": 18.0,
        "Q": 0.520,
        "annual_tons": 18.1
    },
    {
        "id": "fac-channelview",
        "nei_id": "4941411",
        "name": "Channelview Petrochemical Plant",
        "lat": 29.8177,
        "lng": -95.1098,
        "h0": 38.0,
        "D": 2.2,
        "Ts": 430.0,
        "V": 14.0,
        "Q": 0.295,
        "annual_tons": 10.3
    },
    {
        "id": "fac-baytown",
        "nei_id": "4924411",
        "name": "Baytown Refinery",
        "lat": 29.7356,
        "lng": -95.0106,
        "h0": 42.0,
        "D": 3.0,
        "Ts": 475.0,
        "V": 16.5,
        "Q": 0.485,
        "annual_tons": 16.9
    },
    {
        "id": "fac-deer-park",
        "nei_id": "4058611",
        "name": "Deer Park Terminal",
        "lat": 29.7391,
        "lng": -95.0933,
        "h0": 40.0,
        "D": 2.8,
        "Ts": 460.0,
        "V": 15.5,
        "Q": 0.410,
        "annual_tons": 14.3
    },
    {
        "id": "fac-texas-city",
        "nei_id": "3930711",
        "name": "Texas City Chemical Plant",
        "lat": 29.3608,
        "lng": -94.9320,
        "h0": 40.0,
        "D": 2.6,
        "Ts": 455.0,
        "V": 15.0,
        "Q": 0.380,
        "annual_tons": 13.2
    }
]

# community receptors
DEFAULT_RECEPTORS = [
    {"id": "tract-manchester", "name": "Manchester", "lat": 29.7180, "lng": -95.2650},
    {"id": "tract-fifth-ward", "name": "Fifth Ward", "lat": 29.7750, "lng": -95.3350},
    {"id": "tract-kashmere", "name": "Kashmere Gardens", "lat": 29.8050, "lng": -95.3300},
    {"id": "tract-magnolia-park", "name": "Magnolia Park", "lat": 29.7300, "lng": -95.2950},
    {"id": "tract-galena-park", "name": "Galena Park", "lat": 29.7400, "lng": -95.2350},
    {"id": "tract-pasadena", "name": "Pasadena", "lat": 29.6911, "lng": -95.2091},
    {"id": "tract-baytown", "name": "Baytown", "lat": 29.7355, "lng": -94.9774},
    {"id": "tract-sunnyside", "name": "Sunnyside", "lat": 29.6750, "lng": -95.3700},
    {"id": "tract-river-oaks", "name": "River Oaks", "lat": 29.7550, "lng": -95.4200}
]

# state cache
_cached_state = {
    "timestamp": None,
    "status": "initializing",
    "last_error": None,
    "weather": None,
    "facilities": DEFAULT_NEI_FACILITIES,
    "receptors": DEFAULT_RECEPTORS,
    "predictions": {}
}
_state_lock = threading.Lock()
_model_instance = None


def get_model():
    global _model_instance
    if _model_instance is None:
        ckpt = os.path.join(PINN_DIR, "houston_pinn_stack_v1_sens_best.pth")
        _model_instance = load_model(ckpt)
    return _model_instance


def fetch_noaa_weather(station=NOAA_STATION):
    # fetch live observations from noaa api
    req = urllib.request.Request(
        f"https://api.weather.gov/stations/{station}/observations/latest",
        headers={"User-Agent": "RAPID-AirQuality-Pipeline/1.0 (contact@rapid-air.org)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            props = data.get("properties", {})

            # parse wind speed in m/s
            ws_info = props.get("windSpeed", {})
            raw_ws = ws_info.get("value")
            ws_unit = ws_info.get("unitCode", "")
            if raw_ws is not None:
                wind_speed = float(raw_ws) / 3.6 if "km_h" in ws_unit else float(raw_ws)
            else:
                wind_speed = 3.5

            # parse wind direction
            wd_val = props.get("windDirection", {}).get("value")
            wind_dir = float(wd_val) if wd_val is not None else 135.0

            # parse temperature in C
            temp_c = props.get("temperature", {}).get("value")
            temp_c = float(temp_c) if temp_c is not None else 24.0

            # parse pressure
            baro = props.get("barometricPressure", {}).get("value")
            pressure_pa = float(baro) if baro is not None else 101325.0

            # parse humidity
            rh = props.get("relativeHumidity", {}).get("value")
            rel_humidity = float(rh) if rh is not None else 65.0

            timestamp = props.get("timestamp", time.strftime("%Y-%m-%dT%H:%M:%SZ"))

            # derive boundary layer variables
            wind_speed = max(0.5, wind_speed)
            wind_rad = math.radians(wind_dir)
            u = -wind_speed * math.sin(wind_rad)
            v = -wind_speed * math.cos(wind_rad)

            # friction velocity
            ustar = max(0.1, 0.1 * wind_speed)

            # daytime convective vs nighttime stable
            hour = time.gmtime().tm_hour
            is_day = 12 <= hour <= 23
            inv_L = -0.015 if is_day else 0.010
            h_bl = 1250.0 if is_day else 350.0
            zi = h_bl
            z0 = 0.10

            return {
                "source": "NOAA NWS Live API",
                "station": station,
                "timestamp": timestamp,
                "wind_speed_ms": round(wind_speed, 2),
                "wind_dir_deg": round(wind_dir, 1),
                "temperature_c": round(temp_c, 1),
                "temperature_k": round(temp_c + 273.15, 2),
                "relative_humidity": round(rel_humidity, 1),
                "pressure_pa": round(pressure_pa, 0),
                "u_ms": round(u, 3),
                "v_ms": round(v, 3),
                "ustar": round(ustar, 3),
                "inv_L": inv_L,
                "h_bl": h_bl,
                "zi": zi,
                "z0": z0
            }
    except Exception as e:
        # fallback baseline weather if noaa is unreachable
        return {
            "source": "Fallback Meteorological Baseline",
            "station": station,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "wind_speed_ms": 3.4,
            "wind_dir_deg": 135.0,
            "temperature_c": 25.0,
            "temperature_k": 298.15,
            "relative_humidity": 65.0,
            "pressure_pa": 101325.0,
            "u_ms": -2.404,
            "v_ms": 2.404,
            "ustar": 0.34,
            "inv_L": -0.01,
            "h_bl": 1200.0,
            "zi": 1200.0,
            "z0": 0.10,
            "error": str(e)
        }


def fetch_nei_facilities():
    # returns active nei facilities
    return DEFAULT_NEI_FACILITIES


def run_realtime_dispersion(weather=None, facilities=None, receptors=None, reduction_map=None):
    if weather is None:
        weather = fetch_noaa_weather()
    if facilities is None:
        facilities = fetch_nei_facilities()
    if receptors is None:
        receptors = DEFAULT_RECEPTORS
    if reduction_map is None:
        reduction_map = {}

    model = get_model()
    urban_background = 1.05

    results = {}

    for rec in receptors:
        total_pinn_conc = 0.0
        facility_contributions = {}

        for fac in facilities:
            # compute local coordinates in meters
            dx = (rec["lng"] - fac["lng"]) * 111320.0 * math.cos(math.radians(fac["lat"]))
            dy = (rec["lat"] - fac["lat"]) * 110540.0

            # apply emission reduction factor
            cut_pct = float(reduction_map.get(fac["id"], 0.0))
            eff_q = fac["Q"] * max(0.0, 1.0 - (cut_pct / 100.0))

            conc = float(predict_concentration(
                x=[dx], y=[dy], z=[1.5],
                cx=0.0, cy=0.0,
                h0=fac["h0"], D=fac["D"], Ts=fac["Ts"], V=fac["V"], Q=eff_q,
                u=weather["u_ms"], v=weather["v_ms"],
                ustar=weather["ustar"], inv_L=weather["inv_L"],
                h_bl=weather["h_bl"], z0=weather["z0"], zi=weather["zi"],
                model=model
            )[0])

            total_pinn_conc += conc
            facility_contributions[fac["id"]] = round(conc, 4)

        total_conc = round(urban_background + total_pinn_conc, 2)
        results[rec["id"]] = {
            "name": rec["name"],
            "lat": rec["lat"],
            "lng": rec["lng"],
            "benzene_ug_m3": total_conc,
            "background_ug_m3": urban_background,
            "industrial_excess_ug_m3": round(total_pinn_conc, 4),
            "contributions": facility_contributions
        }

    return {
        "timestamp": weather["timestamp"],
        "weather": weather,
        "receptors": results
    }


def update_pipeline_cache():
    global _cached_state
    try:
        w = fetch_noaa_weather()
        f = fetch_nei_facilities()
        disp = run_realtime_dispersion(weather=w, facilities=f)
        with _state_lock:
            _cached_state["timestamp"] = disp["timestamp"]
            _cached_state["status"] = "live" if not disp["weather"].get("error") else "degraded"
            _cached_state["last_error"] = disp["weather"].get("error")
            _cached_state["weather"] = disp["weather"]
            _cached_state["predictions"] = disp["receptors"]
    except Exception as err:
        with _state_lock:
            _cached_state["status"] = "error"
            _cached_state["last_error"] = str(err)


def _background_loop(interval=300):
    while True:
        update_pipeline_cache()
        time.sleep(interval)


def start_pipeline_worker(interval=300):
    # warm up cache immediately
    update_pipeline_cache()
    # launch background updater thread
    t = threading.Thread(target=_background_loop, args=(interval,), daemon=True)
    t.start()
    return t


def get_cached_realtime_state():
    with _state_lock:
        needs_update = _cached_state["timestamp"] is None
    if needs_update:
        update_pipeline_cache()
    with _state_lock:
        return dict(_cached_state)


if __name__ == "__main__":
    print("Testing real-time NOAA + NEI + PINN pipeline...")
    state = run_realtime_dispersion()
    print(f"Timestamp: {state['timestamp']}")
    print(f"Weather: Wind {state['weather']['wind_speed_ms']} m/s @ {state['weather']['wind_dir_deg']} deg ({state['weather']['source']})")
    print("Real-time Concentrations:")
    for rid, rdata in state["receptors"].items():
        print(f"  {rdata['name']:18s}: {rdata['benzene_ug_m3']:.2f} µg/m³ (Excess: +{rdata['industrial_excess_ug_m3']:.4f} µg/m³)")
