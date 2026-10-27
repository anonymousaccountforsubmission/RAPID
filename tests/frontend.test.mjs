import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOUSTON_FACILITIES,
  HOUSTON_TRACTS,
  buildHypotheticalScenarioContext,
  simulateFacilityReduction,
  synthesizeHypotheticalScenario
} from '../app/rapid-engine.js';
import { executeInvestigatorQuery } from '../app/ai-service.js';

test('every facility and tract has a unique selector id', () => {
  const ids = [...HOUSTON_FACILITIES, ...HOUSTON_TRACTS].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('simulation lowers concentration and preserves background', () => {
  const result = simulateFacilityReduction({
    facilityId: 'fac-valero',
    receptorTractId: 'tract-manchester',
    reductionPercent: 50,
    pollutantId: 'BENZENE'
  });
  assert.equal(result.success, true);
  assert.ok(result.simulatedConcentration < result.baselineConcentration);
  assert.ok(result.simulatedConcentration >= result.backgroundConcentration);
});

test('investigator context uses valid dataset fields', () => {
  const context = buildHypotheticalScenarioContext('What if Valero cuts emissions by 40%?', {
    selectedTractId: 'tract-manchester',
    selectedFacilityId: 'fac-valero',
    simReductionPct: 40
  });
  assert.equal(context.reductionPercent, 40);
  assert.ok(Number.isFinite(context.metrics.current.benzene));
  assert.ok(context.nearbyFacilities.length > 0);
  assert.ok(context.metrics.demographics.peopleOfColor.endsWith('%'));
  assert.match(synthesizeHypotheticalScenario(context).reply, /40%/);
});

test('investigator skips the Gemini request when the server has no key', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ available: false }) };
  };
  try {
    const result = await executeInvestigatorQuery('What is the current benzene estimate?', {
      selectedTractId: 'tract-manchester',
      selectedFacilityId: 'fac-valero'
    });
    assert.equal(result.isLiveAi, false);
    assert.deepEqual(calls, ['/api/ai/status']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
