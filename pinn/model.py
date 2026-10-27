import os
import json
import torch
import torch.nn as nn
import numpy as np

class ResidualBlock(nn.Module):
    def __init__(self, in_dim, out_dim):
        super().__init__()
        self.norm1 = nn.LayerNorm(in_dim)
        self.linear1 = nn.Linear(in_dim, out_dim)
        self.norm2 = nn.LayerNorm(out_dim)
        self.linear2 = nn.Linear(out_dim, out_dim)
        self.skip = nn.Identity() if in_dim == out_dim else nn.Linear(in_dim, out_dim)

    def forward(self, x):
        h = torch.nn.functional.gelu(self.norm1(x))
        h = self.linear1(h)
        h = torch.nn.functional.gelu(self.norm2(h))
        h = self.linear2(h)
        return self.skip(x) + h


class StackADEPINN(nn.Module):
    # 3D advection-diffusion PINN for stack dispersion
    INPUT_NAMES = ['x', 'y', 'z', 'cx', 'cy', 'h0', 'dh', 'u', 'v', 'Kh', 'Kz', 'Q']
    LINEAR_FEATURES = ['h0', 'u', 'v']
    LOG_FEATURES = ['Kh', 'Kz']
    N_FEATURES = 5 + len(LINEAR_FEATURES) + len(LOG_FEATURES) + 1

    def __init__(self, hidden_dim=256, num_layers=8):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.input_layer = nn.Linear(self.N_FEATURES, hidden_dim)
        self.residual_blocks = nn.ModuleList([ResidualBlock(hidden_dim, hidden_dim) for _ in range(num_layers)])
        self.output_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.GELU(),
            nn.Linear(hidden_dim // 2, 1),
            nn.Softplus(),
        )

        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

        for name in self.LINEAR_FEATURES + self.LOG_FEATURES + ['logQ']:
            self.register_buffer(f'{name}_min', torch.tensor(0.0))
            self.register_buffer(f'{name}_max', torch.tensor(1.0))

        self.register_buffer('r_max', torch.tensor(1.0e5))
        self.register_buffer('z_max', torch.tensor(500.0))
        self.register_buffer('dh_max', torch.tensor(400.0))

    def set_normalization(self, bounds):
        for name, (lo, hi) in bounds.items():
            if name in ('r_max', 'z_max', 'dh_max'):
                getattr(self, name).fill_(float(hi))
                continue
            if name in self.LOG_FEATURES:
                lo, hi = np.log10(lo), np.log10(hi)
            if name == 'logQ':
                lo, hi = np.log10(lo + 1e-8), np.log10(hi + 1e-8)
            if hi - lo < 1e-6:
                lo, hi = lo - 1.0, hi + 1.0
            getattr(self, f'{name}_min').fill_(float(lo))
            getattr(self, f'{name}_max').fill_(float(hi))

    def _scale(self, val, name):
        lo = getattr(self, f'{name}_min')
        hi = getattr(self, f'{name}_max')
        return 2.0 * (val - lo) / (hi - lo + 1e-8) - 1.0

    def build_features(self, x, y, z, cx, cy, h0, dh, u, v, Kh, Kz, Q):
        speed = torch.sqrt(u ** 2 + v ** 2).clamp(min=0.1)
        ex, ey = u / speed, v / speed
        dx, dy = x - cx, y - cy
        s = dx * ex + dy * ey
        n = -dx * ey + dy * ex

        h_norm = torch.asinh(self.r_max / 100.0)
        z_norm = torch.asinh(self.z_max / 10.0)
        dh_norm = torch.asinh(self.dh_max / 10.0)
        h_e = h0 + dh

        feats = [
            torch.asinh(s / 100.0) / h_norm,
            torch.asinh(n / 100.0) / h_norm,
            2.0 * torch.asinh(z / 10.0) / z_norm - 1.0,
            torch.asinh((z - h_e) / 10.0) / z_norm,
            torch.asinh(dh / 10.0) / dh_norm,
        ]

        vals = dict(h0=h0, u=u, v=v)
        for name in self.LINEAR_FEATURES:
            feats.append(self._scale(vals[name], name))

        logs = dict(Kh=Kh, Kz=Kz)
        for name in self.LOG_FEATURES:
            feats.append(self._scale(torch.log10(logs[name].clamp(min=1e-12)), name))

        feats.append(self._scale(torch.log10(Q + 1e-8), 'logQ'))
        return feats

    def forward(self, x, y, z, cx, cy, h0, dh, u, v, Kh, Kz, Q):
        h = torch.cat(self.build_features(x, y, z, cx, cy, h0, dh, u, v, Kh, Kz, Q), dim=1)
        h = torch.nn.functional.gelu(self.input_layer(h))
        for block in self.residual_blocks:
            h = block(h)
        return self.output_head(h)

    @classmethod
    def from_pretrained(cls, path_or_dir, device='cpu'):
        if os.path.isdir(path_or_dir):
            ckpt_path = os.path.join(path_or_dir, 'houston_pinn_stack_v1_sens_best.pth')
            if not os.path.exists(ckpt_path):
                pth_files = [f for f in os.listdir(path_or_dir) if f.endswith('.pth')]
                if pth_files:
                    ckpt_path = os.path.join(path_or_dir, pth_files[0])
                else:
                    raise FileNotFoundError(f"No .pth checkpoint found in {path_or_dir}")
            cfg_path = os.path.join(path_or_dir, 'config.json')
        else:
            ckpt_path = path_or_dir
            cfg_path = os.path.join(os.path.dirname(path_or_dir), 'config.json')

        checkpoint = torch.load(ckpt_path, map_location=device, weights_only=False)

        if os.path.exists(cfg_path):
            with open(cfg_path, 'r') as f:
                cfg = json.load(f)
            arch = cfg.get('architecture', {})
            hidden_dim = arch.get('hidden_dim', 256)
            num_layers = arch.get('num_layers', 8)
        else:
            hidden_dim = 256
            num_layers = 8

        model = cls(hidden_dim=hidden_dim, num_layers=num_layers)

        if 'norm_bounds' in checkpoint:
            model.set_normalization(checkpoint['norm_bounds'])

        state_dict = checkpoint.get('model_state_dict', checkpoint)
        model.load_state_dict(state_dict)
        model.to(device)
        model.eval()
        return model
