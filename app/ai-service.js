/**
 * Gemini-backed investigator with a deterministic scientific fallback.
 * API credentials remain on the Python server and are never exposed to the browser.
 */

import {
  buildHypotheticalScenarioContext,
  synthesizeHypotheticalScenario
} from './rapid-engine.js';

const AI_ENDPOINT = '/api/ai';
const AI_STATUS_ENDPOINT = '/api/ai/status';
let aiAvailable = null;

export async function getAiStatus() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const response = await fetch(AI_STATUS_ENDPOINT, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      aiAvailable = false;
      return { available: false };
    }
    const status = await response.json();
    aiAvailable = Boolean(status.available);
    return status;
  } catch {
    aiAvailable = false;
    return { available: false };
  }
}

function compactScenario(context) {
  const { activeTract, activeFacility, reductionPercent, metrics, nearbyFacilities } = context;
  return {
    receptor: {
      id: activeTract.id,
      name: activeTract.name,
      geoid: activeTract.geoid,
      population: activeTract.population,
      latitude: activeTract.center[0],
      longitude: activeTract.center[1],
      demographics: metrics.demographics
    },
    facility: {
      id: activeFacility.id,
      name: activeFacility.name,
      type: activeFacility.type,
      address: activeFacility.address,
      emissions: activeFacility.details?.airEmissions
    },
    reductionPercent,
    concentrations: metrics.current,
    projectedConcentrations: metrics.simulated,
    benchmarks: metrics.thresholds,
    nearbyFacilities
  };
}

export async function executeInvestigatorQuery(userQuery, activeState = {}, history = []) {
  const scenarioContext = buildHypotheticalScenarioContext(userQuery, activeState);

  if (aiAvailable === null) {
    await getAiStatus();
  }

  if (aiAvailable) {
    try {
      const response = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userQuery,
          history: history.slice(-6),
          scenario: compactScenario(scenarioContext)
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (typeof data.reply === 'string' && data.reply.trim()) {
          return {
            reply: data.reply.trim(),
            action: scenarioContext.action,
            actionLabel: scenarioContext.actionLabel,
            isLiveAi: true
          };
        }
      }
    } catch (error) {
      console.info('Gemini is unavailable; using the local scientific response engine.', error);
    }
  }

  const synthesized = synthesizeHypotheticalScenario(scenarioContext);
  return {
    reply: synthesized.reply,
    action: scenarioContext.action,
    actionLabel: scenarioContext.actionLabel,
    isLiveAi: false
  };
}
