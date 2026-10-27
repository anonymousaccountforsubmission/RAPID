import os
import torch
import numpy as np
try:
    from .model import StackADEPINN
    from .closures import plume_rise, kh_profile, kz_profile
except ImportError:
    from model import StackADEPINN
    from closures import plume_rise, kh_profile, kz_profile

DEFAULT_CHECKPOINT = os.path.join(os.path.dirname(__file__), "houston_pinn_stack_v1_sens_best.pth")

def load_model(checkpoint_path=None, device=None):
    if device is None:
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    if checkpoint_path is None:
        checkpoint_path = DEFAULT_CHECKPOINT
    return StackADEPINN.from_pretrained(checkpoint_path, device=device)


def predict_concentration(
    x, y, z,
    cx, cy, h0, D, Ts, V, Q,
    u, v, ustar, inv_L, h_bl, z0, zi,
    model=None,
    device=None
):
    # predict benzene concentration in ug/m3
    if model is None:
        model = load_model(device=device)

    dev = next(model.parameters()).device

    x_arr = np.atleast_1d(x).astype(np.float32)
    y_arr = np.atleast_1d(y).astype(np.float32)
    z_arr = np.atleast_1d(z).astype(np.float32)

    n_pts = len(x_arr)
    if len(y_arr) != n_pts or len(z_arr) != n_pts:
        raise ValueError("x, y, z must have the same length")

    U = float(np.maximum(np.hypot(u, v), 0.5))
    Ta = 293.15
    dh, rise, _, _ = plume_rise(h0, D, Ts, V, Ta, U, inv_L, 0.02)

    sigma_v = max(0.5, float(ustar * 1.5))
    Kh_val = np.clip(sigma_v * zi / 78.0, 0.1, 5000.0)
    T_L_val = zi / (78.0 * sigma_v)

    _t = lambda val: torch.tensor(val, dtype=torch.float32, device=dev).view(-1, 1)

    xt = _t(x_arr)
    yt = _t(y_arr)
    zt = _t(z_arr)
    cxt = _t(np.full(n_pts, cx))
    cyt = _t(np.full(n_pts, cy))
    h0t = _t(np.full(n_pts, h0))
    dht = _t(np.full(n_pts, dh))
    ut = _t(np.full(n_pts, u))
    vt = _t(np.full(n_pts, v))
    Ut = _t(np.full(n_pts, U))
    Qt = _t(np.full(n_pts, Q))

    st = ((xt - cxt) * ut + (yt - cyt) * vt) / Ut
    Kh_t = kh_profile(st, Ut, _t(np.full(n_pts, Kh_val)), _t(np.full(n_pts, T_L_val)))
    Kz_t = kz_profile(zt, _t(np.full(n_pts, ustar)), _t(np.full(n_pts, inv_L)), _t(np.full(n_pts, h_bl)), _t(np.full(n_pts, z0)))

    with torch.no_grad():
        phi = model(xt, yt, zt, cxt, cyt, h0t, dht, ut, vt, Kh_t, Kz_t, Qt)

    return phi.cpu().numpy().ravel()


def predict_grid(
    cx, cy, h0, D, Ts, V, Q,
    u, v, ustar, inv_L, h_bl, z0, zi,
    extent_m=5000.0,
    n_grid=100,
    z_level=1.5,
    model=None,
    device=None
):
    # generate 2d spatial concentration grid
    xs = np.linspace(cx - extent_m, cx + extent_m, n_grid)
    ys = np.linspace(cy - extent_m, cy + extent_m, n_grid)
    Xg, Yg = np.meshgrid(xs, ys)

    conc_flat = predict_concentration(
        Xg.ravel(), Yg.ravel(), np.full(Xg.size, z_level),
        cx, cy, h0, D, Ts, V, Q,
        u, v, ustar, inv_L, h_bl, z0, zi,
        model=model, device=device
    )

    return Xg, Yg, conc_flat.reshape(n_grid, n_grid)


if __name__ == "__main__":
    print("Testing Houston PINN Stack Surrogate Model...")
    model = load_model()
    print(f"Loaded {model.__class__.__name__} successfully.")

    preds = predict_concentration(
        x=[100.0, 500.0, 1000.0],
        y=[0.0, 50.0, 100.0],
        z=[1.5, 1.5, 1.5],
        cx=0.0, cy=0.0, h0=35.0, D=2.5, Ts=450.0, V=15.0, Q=5.0,
        u=3.5, v=0.5, ustar=0.35, inv_L=-0.01, h_bl=1200.0, z0=0.1, zi=1200.0,
        model=model
    )
    for d, p in zip([100, 500, 1000], preds):
        print(f"  Downwind ~{d:4d} m: {p:.4f} µg/m³")
