import numpy as np
import torch

GRAVITY = 9.80665
VON_KARMAN = 0.4
U_MIN = 0.5
DELTA_H_MAX = 400.0
DTHDZ_STABLE_DEFAULT = 0.02
SOURCE_SIGMA_H = 100.0
SOURCE_SIGMA_Z_MIN = 10.0
Z_PRAIRIE_GRASS = 0.46
MEANDER_T_R = 86400.0
FR_DIVISOR_MIN = 0.05
N_LID_IMAGES = 3
WIND_OBS_HEIGHT = 10.0
KH_TIMESCALE_COEF = 78.0
KH_MIN, KH_MAX = 0.1, 5000.0
SURFACE_LAYER_FRACTION = 0.1
KZ_MIN = 0.1

# briggs plume rise with stack-tip downwash
def plume_rise(h0, D, Ts, V, Ta, U, inv_L, dthdz):
    U = np.maximum(U, U_MIN)
    r = D / 2.0
    h_stack = np.where(V < 1.5 * U, h0 + 2.0 * D * (V / U - 1.5), h0)
    h_stack = np.maximum(h_stack, 0.0)
    Fb = GRAVITY * V * (r ** 2) * (Ts - Ta) / Ts
    Fb_pos = np.maximum(Fb, 0.0)
    Fm = (Ta / Ts) * (V ** 2) * (r ** 2)
    rise_b_n = np.where(Fb_pos < 55.0, 21.425 * (Fb_pos ** 0.75), 38.71 * (Fb_pos ** 0.6)) / U
    rise_m_n = 3.0 * D * V / U
    s = GRAVITY / Ta * np.where(np.isfinite(dthdz) & (dthdz > 0), dthdz, DTHDZ_STABLE_DEFAULT)
    rise_b_s = 2.6 * ((Fb_pos / (U * s)) ** (1.0 / 3.0))
    rise_m_s = 1.5 * ((Fm / (U * np.sqrt(s))) ** (1.0 / 3.0))
    stable = inv_L > 0
    rise_b = np.where(stable, np.minimum(rise_b_s, rise_b_n), rise_b_n)
    rise_m = np.where(stable, np.minimum(rise_m_s, rise_m_n), rise_m_n)
    rise = np.clip(np.maximum(rise_b, rise_m), 0.0, DELTA_H_MAX)
    dh = (h_stack + rise) - h0
    return dh, rise, Fb, Fm


# differentiable briggs plume rise
def plume_rise_torch(h0, D, Ts, V, Ta, U, inv_L, dthdz):
    U = U.clamp(min=U_MIN)
    r = D / 2.0
    h_stack = torch.where(V < 1.5 * U, h0 + 2.0 * D * (V / U - 1.5), h0).clamp(min=0.0)
    Fb_pos = (GRAVITY * V * (r ** 2) * (Ts - Ta) / Ts).clamp(min=0.0)
    Fm = (Ta / Ts) * (V ** 2) * (r ** 2)
    rise_b_n = torch.where(Fb_pos < 55.0, 21.425 * (Fb_pos ** 0.75), 38.71 * (Fb_pos ** 0.6)) / U
    rise_m_n = 3.0 * D * V / U
    s = GRAVITY / Ta * torch.where(torch.isfinite(dthdz) & (dthdz > 0), dthdz,
                                   torch.full_like(dthdz, DTHDZ_STABLE_DEFAULT))
    cbrt = lambda a: torch.where(a > 0, torch.where(a > 0, a, torch.ones_like(a)) ** (1.0 / 3.0), torch.zeros_like(a))
    rise_b_s = 2.6 * cbrt(Fb_pos / (U * s))
    rise_m_s = 1.5 * cbrt(Fm / (U * torch.sqrt(s)))
    stable = inv_L > 0
    rise_b = torch.where(stable, torch.minimum(rise_b_s, rise_b_n), rise_b_n)
    rise_m = torch.where(stable, torch.minimum(rise_m_s, rise_m_n), rise_m_n)
    rise = torch.maximum(rise_b, rise_m).clamp(0.0, DELTA_H_MAX)
    h_e = (h_stack + rise).clamp(min=0.5)
    return h_e - h0


# vertical eddy diffusivity profile
def kz_profile(z, ustar, inv_L, h_bl, z0):
    z_eff = z.clamp(min=0.0) + z0
    zeta_s = torch.minimum(z_eff, SURFACE_LAYER_FRACTION * h_bl) * inv_L
    phi_stable = 1.0 + 5.0 * zeta_s.clamp(min=0.0)
    phi_unstable = torch.rsqrt(1.0 - 16.0 * zeta_s.clamp(max=0.0))
    phi_h = torch.where(zeta_s >= 0, phi_stable, phi_unstable)
    shape = torch.relu(1.0 - z_eff / h_bl) ** 2
    return (VON_KARMAN * ustar * z_eff / phi_h * shape).clamp(min=KZ_MIN)


# aermod reference wind profile
def wind_profile_factor(z, ustar, inv_L, z0, zi, U):
    def shape(zz):
        z_eval = torch.minimum(zz.clamp(min=0.0), zi)
        lower = 7.0 * z0
        zp = torch.maximum(z_eval, lower)

        def psi(zz_):
            zeta = zz_ * inv_L
            xx = (1.0 - 16.0 * zeta.clamp(max=0.0)) ** 0.25
            psi_u = (2.0 * torch.log((1.0 + xx) / 2.0) + torch.log((1.0 + xx * xx) / 2.0)
                     - 2.0 * torch.atan(xx) + np.pi / 2.0)
            psi_s = -17.0 * (1.0 - torch.exp(-0.29 * zeta.clamp(min=0.0)))
            return torch.where(inv_L < 0, psi_u, psi_s)

        value = torch.log(zp / z0) - psi(zp) + psi(z0)
        return torch.where(z_eval < lower, value * z_eval / lower, value)

    ref = shape(torch.full_like(ustar, WIND_OBS_HEIGHT))
    return torch.maximum(shape(z) / ref, 0.01 / U)


# horizontal eddy diffusivity profile
def kh_profile(s, U, kh_inf, t_l):
    t = s.clamp(min=0.0) / U
    return kh_inf * (1.0 - torch.exp(-t / t_l)) + KH_MIN


# aermod dispersion sigmas
def aermod_sigma2(x, ut, sv, sw, zi, lid, he, us, inv_L, alpha_y, N_bv, sb):
    a = sv / ut
    b = alpha_y * sv / (ut * zi)
    sya2 = (a * x) ** 2 * (1.0 + b * x) ** (-0.6)
    ab = (0.6 + 4.0 * he / zi).clamp(max=1.0)
    szg_c = 0.5 * torch.relu(1.0 - 10.0 * he / zi) * ((us / ut) ** 2) * (x ** 2) * inv_L.abs()
    sza2_c = (ab * sw * x / ut) ** 2 + szg_c ** 2
    t = x / ut
    l = 1.0 / (1.0 / (0.36 * he.clamp(min=1.0)) + N_bv / (0.27 * sw))
    sze_s = sw * t / torch.sqrt(1.0 + sw * t / (2.0 * l))
    szg_s = np.sqrt(2.0 / np.pi) * us * t * ((1.0 + 0.7 * x * inv_L.clamp(min=0.0)) ** (-1.0 / 3.0))
    w = (he / lid).clamp(max=1.0)
    sza2_s = ((1.0 - w) * szg_s + w * sze_s) ** 2
    sza2 = torch.where(inv_L < 0, sza2_c, sza2_s)
    sb2 = sb ** 2
    return sya2 + sb2, sza2 + sb2


# lid and ground reflected vertical distribution
def reflected_vertical(z, h_e, sz, lid):
    out = torch.zeros_like(z)
    for j in range(-N_LID_IMAGES, N_LID_IMAGES + 1):
        out = out + torch.exp(-0.5 * (((z - h_e + 2 * j * lid) / sz) ** 2)) \
            + torch.exp(-0.5 * (((z + h_e + 2 * j * lid) / sz) ** 2))
    out = out / (np.sqrt(2.0 * np.pi) * sz)
    return torch.where(sz > 1.6 * lid, 1.0 / lid, out)


# gaussian source term
def gaussian_source(x, y, z, cx, cy, h_e, sz, Q):
    sh2 = SOURCE_SIGMA_H ** 2
    norm = (Q * 1.0e6) / ((2.0 * np.pi) ** 1.5 * sh2 * sz)
    horiz = torch.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2.0 * sh2))
    vert = torch.exp(-((z - h_e) ** 2) / (2.0 * (sz ** 2))) + torch.exp(-((z + h_e) ** 2) / (2.0 * (sz ** 2)))
    return norm * horiz * vert
