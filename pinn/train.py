"""Train the RAPID stack-dispersion surrogate on physics-generated samples."""

import argparse
import math
from pathlib import Path

import numpy as np
import torch

try:
    from .model import StackADEPINN
except ImportError:
    from model import StackADEPINN


NORM_BOUNDS = {
    "r_max": (0.0, 20000.0),
    "z_max": (0.0, 300.0),
    "dh_max": (0.0, 250.0),
    "h0": (15.0, 120.0),
    "u": (-12.0, 12.0),
    "v": (-12.0, 12.0),
    "Kh": (0.1, 500.0),
    "Kz": (0.1, 200.0),
    "logQ": (0.01, 25.0)
}


def _column(values, device):
    return torch.as_tensor(values, dtype=torch.float32, device=device).reshape(-1, 1)


def make_batch(batch_size, device):
    rng = np.random.default_rng()
    downwind = rng.uniform(50.0, 20000.0, batch_size)
    crosswind = rng.normal(0.0, np.maximum(50.0, downwind * 0.15), batch_size)
    angle = rng.uniform(-math.pi, math.pi, batch_size)
    speed = rng.uniform(0.5, 12.0, batch_size)
    u = speed * np.cos(angle)
    v = speed * np.sin(angle)
    x = downwind * np.cos(angle) - crosswind * np.sin(angle)
    y = downwind * np.sin(angle) + crosswind * np.cos(angle)
    z = rng.uniform(0.0, 80.0, batch_size)
    h0 = rng.uniform(20.0, 100.0, batch_size)
    dh = rng.uniform(0.0, 120.0, batch_size)
    emission = np.power(10.0, rng.uniform(-2.0, math.log10(25.0), batch_size))

    sigma_y = np.maximum(12.0, 0.11 * downwind * np.power(1.0 + 0.0001 * downwind, -0.5))
    sigma_z = np.maximum(6.0, 0.08 * downwind * np.power(1.0 + 0.0002 * downwind, -0.5))
    effective_height = h0 + dh
    horizontal = np.exp(-0.5 * np.square(crosswind / sigma_y))
    vertical = (
        np.exp(-0.5 * np.square((z - effective_height) / sigma_z))
        + np.exp(-0.5 * np.square((z + effective_height) / sigma_z))
    )
    target = emission * 1e6 * horizontal * vertical / (2.0 * math.pi * speed * sigma_y * sigma_z)

    kh = np.clip(0.08 * speed * sigma_y, 0.1, 500.0)
    kz = np.clip(0.08 * speed * sigma_z, 0.1, 200.0)
    zeros = np.zeros(batch_size)
    inputs = tuple(_column(item, device) for item in (
        x, y, z, zeros, zeros, h0, dh, u, v, kh, kz, emission
    ))
    return inputs, _column(target, device)


def parse_args():
    parser = argparse.ArgumentParser(description="Train the RAPID PINN surrogate")
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--steps-per-epoch", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("houston_pinn_stack_v1_sens_best.pth"))
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


def train(args):
    device = torch.device(args.device)
    model = StackADEPINN(hidden_dim=256, num_layers=8).to(device)
    model.set_normalization(NORM_BOUNDS)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-6)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for _ in range(args.steps_per_epoch):
            inputs, target = make_batch(args.batch_size, device)
            prediction = model(*inputs)
            loss = torch.mean((torch.log1p(prediction) - torch.log1p(target)) ** 2)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            total_loss += loss.item()
        scheduler.step()
        if epoch == 1 or epoch % 10 == 0:
            print(f"epoch={epoch:04d} log_mse={total_loss / args.steps_per_epoch:.6f}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_state_dict": model.state_dict(),
        "norm_bounds": NORM_BOUNDS,
        "training": {
            "epochs": args.epochs,
            "steps_per_epoch": args.steps_per_epoch,
            "batch_size": args.batch_size,
            "loss": "log1p_mse"
        }
    }, args.output)
    print(f"saved={args.output}")


if __name__ == "__main__":
    train(parse_args())
