/**
 * RAPID: Model Integration Bridge
 * Connects the UI/Simulator to any external machine learning or dispersion model.
 *
 * Integration modes:
 * 1. Python API (/api/simulate): packaged PyTorch PINN inference
 * 2. Injected In-Browser Model (window.RAPID_CUSTOM_MODEL): for JS/WASM models
 * 3. Precomputed Weights / Surrogate Matrix (JSON)
 * 4. Calibrated Analytical Dispersion Engine (Built-in fallback)
 */

import { simulateFacilityReduction, HOUSTON_FACILITIES, HOUSTON_TRACTS } from './rapid-engine.js';

export const MODEL_CONFIG = {
  serverUrl: '/api/simulate',
  healthUrl: '/health',
  realtimeUrl: '/api/realtime',
  timeoutMs: 8000,
  activeSource: 'physics' // 'physics' | 'python_server' | 'injected_js'
};

let realtimeState = null;

// Listeners for model status updates
const statusListeners = [];
export function onModelStatusChange(fn) {
  statusListeners.push(fn);
}

function notifyStatus(status) {
  MODEL_CONFIG.activeSource = status.source;
  statusListeners.forEach((fn) => {
    try { fn(status); } catch (e) { console.error('Status listener error:', e); }
  });
}

/**
 * Check if a local Python model server is running
 */
export async function checkModelServerHealth() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(MODEL_CONFIG.healthUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      notifyStatus({
        connected: true,
        source: 'python_server',
        modelName: data.model_name || 'AERMOD Surrogate',
        details: data
      });
      return true;
    }
  } catch (err) {
    // Server not running, fallback to internal engine
  }

  if (typeof window !== 'undefined' && window.RAPID_CUSTOM_MODEL) {
    notifyStatus({
      connected: true,
      source: 'injected_js',
      modelName: window.RAPID_CUSTOM_MODEL.name || 'Custom Injected Model'
    });
    return true;
  }

  notifyStatus({
    connected: false,
    source: 'physics',
    modelName: 'Calibrated Atmospheric Physics'
  });
  return false;
}

/**
 * Unified execution hook for dispersion modeling
 *
 * @param {Object} params
 * @param {string} params.facilityId
 * @param {number} params.reductionPercent
 * @param {string} params.receptorTractId
 * @param {string} [params.pollutantId='BENZENE']
 * @returns {Promise<Object>} Formatted simulation output
 */
export async function executeDispersionModel(params) {
  const {
    facilityId,
    reductionPercent = 0,
    receptorTractId,
    pollutantId = 'BENZENE'
  } = params;

  const facility = HOUSTON_FACILITIES.find((f) => f.id === facilityId) || HOUSTON_FACILITIES[0];
  const tract = HOUSTON_TRACTS.find((t) => t.id === receptorTractId) || HOUSTON_TRACTS[0];

  const startTime = performance.now();
  const weather = realtimeState?.weather || {};
  const baselineConcentration = realtimeState?.predictions?.[tract.id]?.benzene_ug_m3
    ?? simulateFacilityReduction({
      facilityId: facility.id,
      reductionPercent: 0,
      receptorTractId: tract.id,
      pollutantId
    }).baselineConcentration;

  // Mode 1: Injected In-Browser Model (window.RAPID_CUSTOM_MODEL)
  if (typeof window !== 'undefined' && window.RAPID_CUSTOM_MODEL && typeof window.RAPID_CUSTOM_MODEL.predict === 'function') {
    try {
      const customOut = await window.RAPID_CUSTOM_MODEL.predict({
        facility: {
          id: facility.id,
          name: facility.name,
          lat: facility.lat,
          lng: facility.lng,
          stackHeightM: 45,
          emissionsTpy: 12.8
        },
        reductionPercent,
        receptor: {
          id: tract.id,
          name: tract.name,
          lat: tract.center[0],
          lng: tract.center[1]
        },
        meteorology: {
          windSpeedMs: weather.wind_speed_ms ?? 3.4,
          windDirDeg: weather.wind_dir_deg ?? 135,
          tempK: weather.temperature_k ?? 298.15
        }
      });

      const execTime = Math.round(performance.now() - startTime);
      return {
        success: true,
        facility: { id: facility.id, name: facility.name },
        receptor: { id: tract.id, name: tract.name },
        reductionPercent,
        baselineConcentration: customOut.baselineConcentration ?? baselineConcentration,
        simulatedConcentration: customOut.simulatedConcentration,
        absoluteDelta: +(customOut.simulatedConcentration - (customOut.baselineConcentration ?? baselineConcentration)).toFixed(2),
        percentChange: +(
          ((customOut.simulatedConcentration - (customOut.baselineConcentration ?? baselineConcentration)) /
            (customOut.baselineConcentration ?? baselineConcentration)) * 100
        ).toFixed(1),
        modelSource: window.RAPID_CUSTOM_MODEL.name || 'Injected Custom Model',
        executionTimeMs: execTime
      };
    } catch (e) {
      console.warn('Injected model failed, falling back to local engine:', e);
    }
  }

  // Mode 2: Local Python Model Server (if available)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MODEL_CONFIG.timeoutMs);
    const resp = await fetch(MODEL_CONFIG.serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facility_id: facility.id,
        facility_name: facility.name,
        stack_lat: facility.lat,
        stack_lng: facility.lng,
        reduction_percent: reductionPercent,
        receptor_id: tract.id,
        receptor_lat: tract.center[0],
        receptor_lng: tract.center[1],
        pollutant: pollutantId,
        baseline_concentration: baselineConcentration,
        annual_emissions: facility.details?.airEmissions,
        wind_speed_ms: weather.wind_speed_ms ?? 3.4,
        wind_dir_deg: weather.wind_dir_deg ?? 135,
        temperature_k: weather.temperature_k ?? 298.15,
        ustar: weather.ustar ?? 0.34,
        inv_L: weather.inv_L ?? -0.01,
        h_bl: weather.h_bl ?? 1200,
        z0: weather.z0 ?? 0.1,
        zi: weather.zi ?? 1200
      }),
      signal: ctrl.signal
    });
    clearTimeout(timer);

    if (resp.ok) {
      const data = await resp.json();
      const execTime = Math.round(performance.now() - startTime);
      return {
        success: true,
        facility: { id: facility.id, name: facility.name },
        receptor: { id: tract.id, name: tract.name },
        reductionPercent: data.reduction_percent ?? reductionPercent,
        baselineConcentration: data.baseline_concentration ?? baselineConcentration,
        simulatedConcentration: data.simulated_concentration,
        absoluteDelta: data.absolute_delta ?? +(data.simulated_concentration - (data.baseline_concentration ?? baselineConcentration)).toFixed(2),
        percentChange: data.percent_change ?? +(
          ((data.simulated_concentration - (data.baseline_concentration ?? baselineConcentration)) /
            (data.baseline_concentration ?? baselineConcentration)) * 100
        ).toFixed(1),
        modelSource: data.model_name || 'Houston PINN Surrogate',
        executionTimeMs: execTime
      };
    }
  } catch (err) {
    // Model server not active, proceed cleanly to built-in physics
  }

  // Mode 3: Built-in Physics Engine
  const physicsResult = simulateFacilityReduction({
    facilityId: facility.id,
    reductionPercent,
    receptorTractId: tract.id,
    pollutantId
  });

  const execTime = Math.round(performance.now() - startTime);
  return {
    ...physicsResult,
    modelSource: 'Calibrated Atmospheric Dispersion (Built-in)',
    executionTimeMs: execTime
  };
}

export async function fetchRealtimePipeline() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(MODEL_CONFIG.realtimeUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.ok) {
      realtimeState = await resp.json();
      return realtimeState;
    }
  } catch (e) {
    // server unreachable
  }
  return null;
}
