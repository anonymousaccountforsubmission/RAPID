import os
import sys
import math

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
if not os.path.isdir(os.path.join(ROOT_DIR, "pinn")):
    ROOT_DIR = os.path.dirname(ROOT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from pinn import StackADEPINN, load_model, predict_concentration

PINN_DIR = os.path.join(ROOT_DIR, "pinn")

_cached_model = None


def _bounded_number(payload, key, default, minimum=None, maximum=None):
    value = float(payload.get(key, default))
    if not math.isfinite(value):
        raise ValueError(f"{key} must be a finite number")
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value

def get_model():
    global _cached_model
    if _cached_model is None:
        ckpt_path = os.path.join(PINN_DIR, "houston_pinn_stack_v1_sens_best.pth")
        _cached_model = load_model(ckpt_path)
    return _cached_model

def predict_benzene(payload):
    if not isinstance(payload, dict):
        raise ValueError("Prediction payload must be a JSON object")

    model = get_model()

    red_pct = _bounded_number(payload, "reduction_percent", 50, 0, 100)
    rec_lat = _bounded_number(payload, "receptor_lat", 29.7150, -90, 90)
    rec_lng = _bounded_number(payload, "receptor_lng", -95.2600, -180, 180)
    stack_lat = _bounded_number(payload, "stack_lat", 29.7180, -90, 90)
    stack_lng = _bounded_number(payload, "stack_lng", -95.2530, -180, 180)
    wind_speed = _bounded_number(payload, "wind_speed_ms", 3.4, 0.5, 75)
    wind_dir = _bounded_number(payload, "wind_dir_deg", 135) % 360
    temperature_k = _bounded_number(payload, "temperature_k", 298.15, 180, 340)

    # Distance and coordinates in meters (local tangent plane approximation)
    dx = (rec_lng - stack_lng) * 111320.0 * math.cos(math.radians(stack_lat))
    dy = (rec_lat - stack_lat) * 110540.0

    # Wind vector components (from wind_dir)
    wind_rad = math.radians(wind_dir)
    u = -wind_speed * math.sin(wind_rad)
    v = -wind_speed * math.cos(wind_rad)

    base_q = _bounded_number(payload, "emission_rate_g_s", 0.368, 0, 1000)
    sim_q = base_q * (1.0 - (red_pct / 100.0))

    inference_args = dict(
        x=[dx], y=[dy], z=[1.5],
        cx=0.0, cy=0.0,
        h0=_bounded_number(payload, "stack_height_m", 35.0, 1, 500),
        D=_bounded_number(payload, "stack_diameter_m", 2.5, 0.1, 30),
        Ts=_bounded_number(payload, "stack_temperature_k", 450.0, temperature_k, 2000),
        V=_bounded_number(payload, "exit_velocity_m_s", 15.0, 0.1, 100),
        u=u, v=v,
        ustar=_bounded_number(payload, "ustar", max(0.1, wind_speed * 0.1), 0.05, 5),
        inv_L=_bounded_number(payload, "inv_L", -0.01, -1, 1),
        h_bl=_bounded_number(payload, "h_bl", 1200.0, 50, 5000),
        z0=_bounded_number(payload, "z0", 0.1, 0.001, 10),
        zi=_bounded_number(payload, "zi", 1200.0, 50, 5000),
        model=model
    )

    c_base = float(predict_concentration(
        Q=base_q, **inference_args
    )[0])

    c_sim = float(predict_concentration(
        Q=sim_q, **inference_args
    )[0])

    base_total = _bounded_number(payload, "baseline_concentration", 2.59, 0.01, 10000)
    background_fraction = _bounded_number(payload, "background_fraction", 0.40, 0, 0.95)
    background = base_total * background_fraction
    source_contribution = base_total - background
    response_ratio = 0.0 if c_base <= 1e-12 else max(0.0, min(1.0, c_sim / c_base))
    sim_total = round(background + source_contribution * response_ratio, 2)
    base_total = round(base_total, 2)
    delta = round(sim_total - base_total, 2)
    pct = round(((sim_total - base_total) / base_total) * 100, 1)

    return {
        "model_name": "Houston PINN Surrogate (Stack V1 Sobolev)",
        "facility_id": payload.get("facility_id", "fac-valero"),
        "receptor_id": payload.get("receptor_id", "tract-manchester"),
        "reduction_percent": red_pct,
        "baseline_concentration": base_total,
        "simulated_concentration": sim_total,
        "absolute_delta": delta,
        "percent_change": pct,
        "pinn_raw_baseline": float(c_base),
        "pinn_raw_simulated": float(c_sim),
        "weather": {
            "wind_speed_ms": wind_speed,
            "wind_dir_deg": wind_dir,
            "temperature_k": temperature_k
        },
        "status": "success"
    }

predict = predict_benzene
