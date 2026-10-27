---
language:
- en
license: mit
tags:
- physics-informed-neural-networks
- pinn
- atmospheric-dispersion
- air-quality
- benzene
- pytorch
metrics:
- fac2
- rmse
pipeline_tag: tabular-regression
---

# Houston Benzene PINN Surrogate

Custom 3D Physics-Informed Neural Network surrogate for stack-level atmospheric dispersion across Houston industrial corridors.

## Features
- Atmospheric dispersion modeling with exact physical closures.
- Differentiable Briggs plume rise and stack-tip downwash.
- Taylor dispersion horizontal and vertical eddy diffusivities.
- Low-wind lateral meander split.

## Files
- model.py: StackADEPINN architecture with Pre-LayerNorm and GELU.
- closures.py: Physical plume rise and diffusivity equations.
- inference.py: Prediction API for points and 2D grids.
- train.py: Training script with gradient-norm balancing.
- config.json: Model architecture and normalization bounds.
- houston_pinn_stack_v1_sens_best.pth: Optimal checkpoint (Epoch 138).

## Quickstart
```python
from model import StackADEPINN
from inference import predict_concentration

model = StackADEPINN.from_pretrained(".")
conc = predict_concentration(
    x=[500.0], y=[0.0], z=[1.5],
    cx=0.0, cy=0.0, h0=35.0, D=2.5, Ts=450.0, V=15.0, Q=5.0,
    u=3.5, v=0.5, ustar=0.35, inv_L=-0.01, h_bl=1200.0, z0=0.1, zi=1200.0,
    model=model
)
print("Concentration:", conc[0], "ug/m3")
```
