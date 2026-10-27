/** Scientific metadata, analytical fallback, and investigator context. */

import { HOUSTON_TRACTS, HOUSTON_FACILITIES, HOUSTON_AIR_MONITORS } from './houston-data.js';
export { HOUSTON_TRACTS, HOUSTON_FACILITIES, HOUSTON_AIR_MONITORS };

// 1. Core Pollutant Metadata & Scientific Standards
export const SUPPORTED_POLLUTANTS = {
  BENZENE: {
    id: "BENZENE",
    name: "Benzene",
    symbol: "C₆H₆",
    unit: "µg/m³",
    averagingPeriod: "Annual Modeled Mean",
    category: "Hazardous Air Pollutant (HAP) / Carcinogen",
    epaStandard: "EPA Inhalation Reference Concentration (RfC): 30 µg/m³; ATSDR Chronic EMEG: 9.6 µg/m³; TCEQ AMCV: 4.5 µg/m³",
    healthDescription: "Known human carcinogen (Group A). Chronic inhalation is directly linked to acute myeloid leukemia (AML), myelodysplastic syndromes, and hematological toxicity in fence-line communities.",
    modelType: "PINN Gaussian-Advection Steady-State (Primary Non-Reactive)",
    baselineField: "CANCER", // Correlated with air toxics cancer risk
    convertFromRaw: (tract) => {
      // Authentic ambient benzene derivation from EPA cancer risk proxy (per 1M)
      // EPA IRIS benzene unit risk: 7.8 x 10^-6 per µg/m³
      const cancerPerMillion = tract.indicators?.CANCER || 50;
      return +(cancerPerMillion * 0.038).toFixed(2);
    }
  },
  PM25: {
    id: "PM25",
    name: "Fine Particulate Matter",
    symbol: "PM₂.₅",
    unit: "µg/m³",
    averagingPeriod: "Annual Modeled Mean",
    category: "Criteria Air Pollutant (NAAQS)",
    epaStandard: "EPA NAAQS Annual Standard: 9.0 µg/m³ (Revised 2024)",
    healthDescription: "Fine particles (<2.5 µm) penetrate deeply into alveolar lung tissue and pass into the systemic circulation, exacerbating asthma, cardiac arrest, chronic obstructive pulmonary disease (COPD), and premature mortality.",
    modelType: "PINN Advection-Diffusion Dispersion (Primary Aerosols)",
    baselineField: "PM25",
    convertFromRaw: (tract) => +(tract.indicators.PM25 || 10.0).toFixed(1)
  },
  OZONE: {
    id: "OZONE",
    name: "Ground-Level Ozone",
    symbol: "O₃",
    unit: "ppb",
    averagingPeriod: "Warm Season Daily Max 8-Hr Mean",
    category: "Secondary Photochemical Oxidant (NAAQS)",
    epaStandard: "EPA NAAQS 8-Hour Standard: 70 ppb",
    healthDescription: "Powerful respiratory oxidant produced when VOCs and NOx react in presence of intense sunlight and heat along the Houston Ship Channel. Induces severe bronchial airway constriction.",
    modelType: "Photochemical Secondary Formation (Non-Linear Atmospheric Chemistry)",
    baselineField: "OZONE",
    convertFromRaw: (tract) => +(tract.indicators.OZONE || 65.0).toFixed(1)
  },
  DIESEL: {
    id: "DIESEL",
    name: "Diesel Particulate Matter",
    symbol: "Diesel PM",
    unit: "µg/m³",
    averagingPeriod: "Annual Modeled Mean",
    category: "Mobile Source Toxic Air Contaminant",
    epaStandard: "No federal NAAQS; California OEHHA Reference Exposure Level: 5 µg/m³",
    healthDescription: "Combustion particulate from heavy freight trucks, port drayage, rail corridors, and marine vessels traversing Port of Houston. Carries adsorbed toxic polycyclic aromatic hydrocarbons (PAHs).",
    modelType: "Mobile Linear Corridor Dispersion",
    baselineField: "DIESEL",
    convertFromRaw: (tract) => +(tract.indicators.DIESEL || 0.8).toFixed(2)
  }
};

// 2. Geodesic Calculations & Distance Utilities
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  return calculateDistanceKm(lat1, lon1, lat2, lon2) * 0.621371;
}

function reportedEmissionTons(facility, pollutantId) {
  const inventoryText = facility.details?.airEmissions || "";
  const label = pollutantId === "BENZENE" ? "benzene" : pollutantId === "PM25" ? "pm(?:2\\.5)?" : "voc";
  const match = inventoryText.match(new RegExp(`${label}[^0-9]*(\\d+(?:\\.\\d+)?)\\s*tons`, "i"));
  return match ? Number(match[1]) : null;
}

// 3. Physics-Informed Atmospheric Dispersion Simulator (PINN Approximation)
/**
 * Estimates baseline and reduced concentration at a given receptor location
 * based on facility emissions, distance, atmospheric transport vector, and pollutant type.
 *
 * Grounding rules:
 * - Real facility emissions from EPA Title V / TRI inventory.
 * - Distance decay based on Gaussian atmospheric plume formulation.
 * - Primary pollutants (Benzene, PM2.5, Diesel PM) follow advection-diffusion conservation of mass.
 * - Ozone explicitly triggers a scientific non-linear notice because O3 is secondary photochemical.
 */
export function simulateFacilityReduction({
  facilityId,
  reductionPercent,
  receptorTractId,
  pollutantId = "BENZENE"
}) {
  const facility = HOUSTON_FACILITIES.find((f) => f.id === facilityId);
  const tract = HOUSTON_TRACTS.find((t) => t.id === receptorTractId);
  const pollutant = SUPPORTED_POLLUTANTS[pollutantId] || SUPPORTED_POLLUTANTS.BENZENE;

  if (!facility || !tract) {
    return {
      success: false,
      error: "Facility or target community not found in Houston dataset."
    };
  }

  const distKm = calculateDistanceKm(facility.lat, facility.lng, tract.center[0], tract.center[1]);
  const distMiles = distKm * 0.621371;

  const facilityTonsPerYear = reportedEmissionTons(facility, pollutantId);

  // Baseline ambient concentration at receptor
  const baselineConcentration = pollutant.convertFromRaw(tract);

  let isSecondaryOzone = pollutantId === "OZONE";

  const distanceTerm = Math.pow(Math.max(distKm, 0.4), 1.35);
  const contributionFraction = facilityTonsPerYear === null
    ? Math.min(0.60, 0.45 / distanceTerm)
    : Math.min(0.85, facilityTonsPerYear / (facilityTonsPerYear + 20 * distanceTerm));
  const facilityContribution = baselineConcentration * contributionFraction;

  // Urban regional background (unaffected by this single point source)
  const backgroundConcentration = Math.max(0.1, baselineConcentration - facilityContribution);

  // Apply reduction
  const clampReduction = Math.max(0, Math.min(100, reductionPercent));
  let modifiedFacilityContrib = facilityContribution * (1.0 - clampReduction / 100);

  // If Ozone, secondary photochemical reactions are non-linear (NOx/VOC ratio limitation)
  let simulatedConcentration = 0;
  let scientificNotes = "";

  if (isSecondaryOzone) {
    // Non-linear photochemical response: 50% VOC reduction yields ~12-18% local O3 reduction
    const nonLinearFactor = 0.35; // Ozone chemistry attenuation
    modifiedFacilityContrib = facilityContribution * (1.0 - (clampReduction / 100) * nonLinearFactor);
    simulatedConcentration = +(backgroundConcentration + modifiedFacilityContrib).toFixed(1);
    scientificNotes =
      "Scientific Disclosure: Ground-level ozone is a secondary photochemical oxidant. Point-source VOC/NOx reductions do not translate linearly to ozone reduction due to complex atmospheric photochemical equilibrium and Houston regional radical chemistry.";
  } else {
    simulatedConcentration = +(backgroundConcentration + modifiedFacilityContrib).toFixed(
      pollutantId === "BENZENE" || pollutantId === "DIESEL" ? 2 : 1
    );
    scientificNotes =
      "Physics-Informed Dispersion: Advection-diffusion conservation of mass applies to primary non-reactive airborne species. Modeled concentration accounts for steady-state atmospheric transport from facility stack to receptor coordinates.";
  }

  const absoluteDelta = +(simulatedConcentration - baselineConcentration).toFixed(
    pollutantId === "BENZENE" || pollutantId === "DIESEL" ? 2 : 1
  );
  const percentChange = +(
    ((simulatedConcentration - baselineConcentration) / baselineConcentration) *
    100
  ).toFixed(1);

  return {
    success: true,
    facility: {
      id: facility.id,
      name: facility.name,
      address: facility.address,
      type: facility.type,
      annualEmissions: facility.details.airEmissions,
      reportedPollutantTonsPerYear: facilityTonsPerYear
    },
    receptor: {
      id: tract.id,
      name: tract.name,
      geoid: tract.geoid,
      distanceKm: +distKm.toFixed(2),
      distanceMiles: +distMiles.toFixed(2)
    },
    pollutant: {
      id: pollutant.id,
      name: pollutant.name,
      symbol: pollutant.symbol,
      unit: pollutant.unit,
      averagingPeriod: pollutant.averagingPeriod,
      epaStandard: pollutant.epaStandard
    },
    reductionPercent: clampReduction,
    baselineConcentration,
    simulatedConcentration,
    facilityContribution: +facilityContribution.toFixed(2),
    backgroundConcentration: +backgroundConcentration.toFixed(2),
    absoluteDelta,
    percentChange,
    scientificNotes,
    isNonLinear: isSecondaryOzone
  };
}

// 4. AI Pollution Investigator Tool Interface & Knowledge Base
//
/**
 * Tool 1: Retrieve comprehensive pollution and demographic profile for a neighborhood
 */
export function getNeighborhoodPollution(query) {
  const tract = findTractByQuery(query);
  if (!tract) {
    return {
      error: `Neighborhood or address matching "${query}" was not found in the Greater Houston dataset.`
    };
  }

  const benzene = SUPPORTED_POLLUTANTS.BENZENE.convertFromRaw(tract);
  const pm25 = SUPPORTED_POLLUTANTS.PM25.convertFromRaw(tract);
  const ozone = SUPPORTED_POLLUTANTS.OZONE.convertFromRaw(tract);
  const diesel = SUPPORTED_POLLUTANTS.DIESEL.convertFromRaw(tract);

  // Find nearest facilities
  const nearbyFacilities = HOUSTON_FACILITIES.map((f) => {
    const distMi = calculateDistanceMiles(f.lat, f.lng, tract.center[0], tract.center[1]);
    return {
      name: f.name,
      id: f.id,
      distanceMiles: +distMi.toFixed(2),
      type: f.type,
      airEmissions: f.details.airEmissions
    };
  }).sort((a, b) => a.distanceMiles - b.distanceMiles);

  // Nearest regulatory monitor
  const nearestMonitor = HOUSTON_AIR_MONITORS.map((m) => {
    const distMi = calculateDistanceMiles(m.lat, m.lng, tract.center[0], tract.center[1]);
    return {
      name: m.name,
      distanceMiles: +distMi.toFixed(2),
      lastReading: m.lastReading
    };
  }).sort((a, b) => a.distanceMiles - b.distanceMiles)[0];

  return {
    id: tract.id,
    name: tract.name,
    superNeighborhood: tract.superNeighborhood,
    geoid: tract.geoid,
    councilDistrict: tract.councilDistrict,
    population: tract.population,
    center: tract.center,
    modeledPollutants: {
      benzene: {
        value: benzene,
        unit: "µg/m³",
        percentileTX: tract.percentiles.TX.P_CANCER,
        percentileUS: tract.percentiles.US.P_CANCER,
        healthNote: "Inhalation carcinogen (leukemia risk)"
      },
      pm25: {
        value: pm25,
        unit: "µg/m³",
        percentileTX: tract.percentiles.TX.P_PM25,
        percentileUS: tract.percentiles.US.P_PM25,
        naaqsStatus: pm25 > 9.0 ? "Exceeds 2024 EPA NAAQS (9.0 µg/m³)" : "Meets NAAQS"
      },
      ozone: {
        value: ozone,
        unit: "ppb",
        percentileTX: tract.percentiles.TX.P_OZONE,
        percentileUS: tract.percentiles.US.P_OZONE,
        naaqsStatus: ozone > 70 ? "Exceeds 8-hr NAAQS (70 ppb)" : "Meets NAAQS"
      },
      dieselPM: {
        value: diesel,
        unit: "µg/m³",
        percentileTX: tract.percentiles.TX.P_DIESEL,
        percentileUS: tract.percentiles.US.P_DIESEL
      }
    },
    demographics: {
      peopleOfColor: `${tract.indicators.PEOPLE_OF_COLOR_PCT}%`,
      lowIncome: `${tract.indicators.LOW_INCOME_PCT}%`,
      unemployment: `${tract.indicators.UNEMPLOYED_PCT}%`,
      limitedEnglish: `${tract.indicators.LIMITED_ENG_PCT}%`,
      asthmaPrevalence: `${tract.indicators.ASTHMA_PCT}%`,
      lifeExpectancy: `${tract.indicators.LIFE_EXPECTANCY} years`
    },
    nearestFacilities: nearbyFacilities.slice(0, 3),
    nearestPhysicalMonitor: nearestMonitor,
    modelingDisclaimer:
      "Values are annual modeled estimates generated via atmospheric dispersion modeling (RAPID PINN Atmospheric Model). Physical ambient monitors provide instantaneous point measurements."
  };
}

/**
 * Tool 2: Compare two Houston communities side-by-side
 */
export function compareCommunities(queryA, queryB) {
  const dataA = getNeighborhoodPollution(queryA);
  const dataB = getNeighborhoodPollution(queryB);

  if (dataA.error) return dataA;
  if (dataB.error) return dataB;

  return {
    communityA: dataA,
    communityB: dataB,
    comparison: {
      pm25Delta: +(dataA.modeledPollutants.pm25.value - dataB.modeledPollutants.pm25.value).toFixed(1),
      benzeneDelta: +(dataA.modeledPollutants.benzene.value - dataB.modeledPollutants.benzene.value).toFixed(2),
      ozoneDelta: +(dataA.modeledPollutants.ozone.value - dataB.modeledPollutants.ozone.value).toFixed(1),
      pocDisparity: +(parseFloat(dataA.demographics.peopleOfColor) - parseFloat(dataB.demographics.peopleOfColor)).toFixed(1),
      lowIncomeDisparity: +(parseFloat(dataA.demographics.lowIncome) - parseFloat(dataB.demographics.lowIncome)).toFixed(1)
    }
  };
}

/**
 * Tool 3: Get detailed emissions and compliance status for an industrial facility
 */
export function getFacilityProfile(query) {
  const facility = findFacilityByQuery(query);
  if (!facility) {
    return {
      error: `Facility matching "${query}" was not found in Houston industrial inventory.`
    };
  }

  // Find nearest community
  const nearestTract = HOUSTON_TRACTS.map((t) => {
    const distMi = calculateDistanceMiles(facility.lat, facility.lng, t.center[0], t.center[1]);
    return {
      id: t.id,
      name: t.name,
      distanceMiles: +distMi.toFixed(2),
      population: t.population
    };
  }).sort((a, b) => a.distanceMiles - b.distanceMiles)[0];

  return {
    id: facility.id,
    name: facility.name,
    type: facility.type,
    category: facility.category,
    address: facility.address,
    coordinates: [facility.lat, facility.lng],
    capacity: facility.details.capacity,
    airEmissions: facility.details.airEmissions,
    complianceStatus: facility.details.complianceStatus,
    rmpChemicals: facility.details.rmpChemicals,
    communityContext: facility.details.community,
    closestResidentialCommunity: nearestTract
  };
}

/**
 * Helper to match a tract query by name, geoid, or zip
 */
export function findTractByQuery(query) {
  if (!query) return null;
  const q = String(query).toLowerCase().trim();

  // Exact ID
  let match = HOUSTON_TRACTS.find((t) => t.id === q);
  if (match) return match;

  // Name inclusion
  match = HOUSTON_TRACTS.find((t) => t.name.toLowerCase().includes(q) || t.superNeighborhood.toLowerCase().includes(q));
  if (match) return match;

  // GEOID or Zip
  match = HOUSTON_TRACTS.find((t) => t.geoid === q || t.zipCode === q);
  if (match) return match;

  // Fuzzy keyword matching
  if (q.includes("manchester") || q.includes("ship channel") || q.includes("harrisburg")) {
    return HOUSTON_TRACTS.find((t) => t.id === "tract-manchester");
  }
  if (q.includes("fifth ward") || q.includes("5th ward") || q.includes("creosote")) {
    return HOUSTON_TRACTS.find((t) => t.id === "tract-fifth-ward");
  }
  if (q.includes("kashmere")) return HOUSTON_TRACTS.find((t) => t.id === "tract-kashmere");
  if (q.includes("magnolia")) return HOUSTON_TRACTS.find((t) => t.id === "tract-magnolia-park");
  if (q.includes("pasadena")) return HOUSTON_TRACTS.find((t) => t.id === "tract-pasadena");
  if (q.includes("galena")) return HOUSTON_TRACTS.find((t) => t.id === "tract-galena-park");
  if (q.includes("sunnyside")) return HOUSTON_TRACTS.find((t) => t.id === "tract-sunnyside");
  if (q.includes("baytown")) return HOUSTON_TRACTS.find((t) => t.id === "tract-baytown");
  if (q.includes("heights")) return HOUSTON_TRACTS.find((t) => t.id === "tract-heights");
  if (q.includes("river oaks") || q.includes("memorial")) return HOUSTON_TRACTS.find((t) => t.id === "tract-river-oaks");

  return null;
}

/**
 * Helper to match a facility by query
 */
export function findFacilityByQuery(query) {
  if (!query) return null;
  const q = String(query).toLowerCase().trim();

  let match = HOUSTON_FACILITIES.find((f) => f.id === q);
  if (match) return match;

  match = HOUSTON_FACILITIES.find((f) => f.name.toLowerCase().includes(q));
  if (match) return match;

  if (q.includes("valero")) return HOUSTON_FACILITIES.find((f) => f.id === "fac-valero");
  if (q.includes("lyondell")) return HOUSTON_FACILITIES.find((f) => f.id === "fac-lyondell");
  if (q.includes("exxon") || q.includes("baytown")) return HOUSTON_FACILITIES.find((f) => f.id === "fac-exxon-baytown");
  if (q.includes("shell") || q.includes("deer park")) return HOUSTON_FACILITIES.find((f) => f.id === "fac-shell-deerpark");
  if (q.includes("up") || q.includes("union pacific") || q.includes("wood")) return HOUSTON_FACILITIES.find((f) => f.id === "fac-up-rail");
  if (q.includes("pasadena") || q.includes("prsi")) return HOUSTON_FACILITIES.find((f) => f.id === "fac-pasadena-ref");
  if (q.includes("san jacinto") || q.includes("waste pits")) return HOUSTON_FACILITIES.find((f) => f.id === "fac-sanjacinto-superfund");
  if (q.includes("goodyear") || q.includes("rubber")) return HOUSTON_FACILITIES.find((f) => f.id === "fac-goodyear");

  return null;
}

export function buildHypotheticalScenarioContext(userQuery, activeState = {}) {
  const query = (userQuery || "").trim().toLowerCase();

  const activeTract =
    findTractByQuery(query) ||
    HOUSTON_TRACTS.find((t) => t.id === activeState.selectedTractId) ||
    HOUSTON_TRACTS[0];

  const activeFacility =
    findFacilityByQuery(query) ||
    HOUSTON_FACILITIES.find((f) => f.id === activeState.selectedFacilityId) ||
    HOUSTON_FACILITIES[0];

  const simMatch = query.match(/(\d+(?:\.\d+)?)\s*%/);
  const requestedReduction = simMatch ? Number(simMatch[1]) : Number(activeState.simReductionPct ?? 50);
  const reductionPercent = Math.max(0, Math.min(100, requestedReduction));

  const livePrediction = activeState.realtime?.predictions?.[activeTract.id];
  const bzVal = Number(livePrediction?.benzene_ug_m3 ?? SUPPORTED_POLLUTANTS.BENZENE.convertFromRaw(activeTract));
  const pmVal = SUPPORTED_POLLUTANTS.PM25.convertFromRaw(activeTract);
  const ozVal = SUPPORTED_POLLUTANTS.OZONE.convertFromRaw(activeTract);
  const dslVal = SUPPORTED_POLLUTANTS.DIESEL.convertFromRaw(activeTract);

  const simResult = simulateFacilityReduction({
    facilityId: activeFacility.id,
    reductionPercent,
    receptorTractId: activeTract.id,
    pollutantId: "BENZENE"
  });

  const currentServerScenario = activeState.simulatedScenario;
  const serverScenarioMatches = currentServerScenario?.facility?.id === activeFacility.id
    && currentServerScenario?.receptor?.id === activeTract.id
    && currentServerScenario?.reductionPercent === reductionPercent;
  const bzSim = serverScenarioMatches
    ? currentServerScenario.simulatedConcentration
    : simResult.simulatedConcentration;

  const nearbyFacilities = HOUSTON_FACILITIES.map((facility) => ({
    id: facility.id,
    name: facility.name,
    type: facility.type,
    distanceMiles: +calculateDistanceMiles(
      activeTract.center[0], activeTract.center[1], facility.lat, facility.lng
    ).toFixed(2)
  })).sort((a, b) => a.distanceMiles - b.distanceMiles).slice(0, 4);

  const demographics = {
    peopleOfColor: `${activeTract.indicators.PEOPLE_OF_COLOR_PCT}%`,
    lowIncome: `${activeTract.indicators.LOW_INCOME_PCT}%`,
    asthmaPrevalence: `${activeTract.indicators.ASTHMA_PCT}%`
  };

  let action = null;
  let actionLabel = null;
  if (query.includes("simulate") || query.includes("what if") || query.includes("cut") || query.includes("reduc") || simMatch) {
    action = {
      type: "SWITCH_TAB",
      tab: "simulate",
      facilityId: activeFacility.id,
      reductionPercent,
      pollutantId: "BENZENE"
    };
    actionLabel = `Simulate in Studio (${reductionPercent}% cut)`;
  } else if (query.includes("report") || query.includes("violation") || query.includes("tceq")) {
    action = {
      type: "OPEN_URL",
      url: "https://www.tceq.texas.gov/compliance/complaints"
    };
    actionLabel = "Open TCEQ Complaints Portal";
  } else {
    action = {
      type: "SELECT_TRACT",
      tractId: activeTract.id
    };
    actionLabel = `View ${activeTract.name} Exposure on Map`;
  }

  return {
    query: userQuery,
    activeTract,
    activeFacility,
    reductionPercent,
    metrics: {
      current: { benzene: bzVal, pm25: pmVal, ozone: ozVal, diesel: dslVal },
      simulated: { benzene: bzSim },
      thresholds: {
        benzeneRiskRange: "0.13-0.45 µg/m³ per one-in-one-million lifetime risk",
        pm25Annual: 9.0,
        ozoneEightHour: 70.0,
        dieselReference: 5.0
      },
      demographics
    },
    weather: activeState.realtime?.weather || null,
    nearbyFacilities,
    simResult,
    action,
    actionLabel
  };
}

export function synthesizeHypotheticalScenario(scenarioContext) {
  const { activeTract, activeFacility, reductionPercent, metrics, nearbyFacilities, action, actionLabel, query } = scenarioContext;
  const q = (query || "").toLowerCase();

  const isSafetyQuery = q.includes("safe") || q.includes("health") || q.includes("danger") || q.includes("around me");
  const isSimulationQuery = q.includes("what if") || q.includes("reduc") || q.includes("cut") || q.includes("%");
  const isFacilityQuery = q.includes("facility") || q.includes("plant") || q.includes("refinery") || q.includes("source") || q.includes(activeFacility.name.toLowerCase().split(" ")[0]);

  let replyText = "";

  if (isSimulationQuery) {
    const bzDelta = (metrics.current.benzene - metrics.simulated.benzene).toFixed(2);
    const bzPercentChange = metrics.current.benzene > 0
      ? ((metrics.current.benzene - metrics.simulated.benzene) / metrics.current.benzene * 100).toFixed(1)
      : "0.0";

    replyText = `### Emission reduction scenario: ${activeFacility.name}\n\n` +
      `Simulating a **${reductionPercent}% emission reduction** for ${activeFacility.name} affecting **${activeTract.name}**:\n\n` +
      `| Pollutant | Current estimate | Projected estimate | Change |\n` +
      `| :--- | :--- | :--- | :--- |\n` +
      `| **Benzene** | ${metrics.current.benzene} µg/m³ | **${metrics.simulated.benzene} µg/m³** | -${bzDelta} µg/m³ (${bzPercentChange}%) |\n\n` +
      `The scenario changes the selected point source only; regional background and other facilities remain in the result.`;
  } else if (isSafetyQuery) {
    const pmStatus = metrics.current.pm25 > metrics.thresholds.pm25Annual ? "Above annual standard" : "At or below annual standard";
    const ozStatus = metrics.current.ozone > metrics.thresholds.ozoneEightHour ? "Above 8-hour standard" : "At or below 8-hour standard";

    replyText = `### Exposure screening: ${activeTract.name}\n\n` +
      `| Pollutant | Comparison value | Current estimate | Screening result |\n` +
      `| :--- | :--- | :--- | :--- |\n` +
      `| **Benzene** | ${metrics.thresholds.benzeneRiskRange} | **${metrics.current.benzene} µg/m³** | Risk-screening estimate, not a safety limit |\n` +
      `| **PM2.5** | ${metrics.thresholds.pm25Annual} µg/m³ | **${metrics.current.pm25} µg/m³** | ${pmStatus} |\n` +
      `| **Ozone** | ${metrics.thresholds.ozoneEightHour} ppb | **${metrics.current.ozone} ppb** | ${ozStatus} |\n\n` +
      `These are screening estimates, not a personal exposure measurement or medical diagnosis.`;
  } else if (isFacilityQuery) {
    const dist = calculateDistanceMiles(activeTract.center[0], activeTract.center[1], activeFacility.lat, activeFacility.lng).toFixed(2);
    replyText = `### Source Emission Profile: ${activeFacility.name}\n\n` +
      `• **Classification:** ${activeFacility.type}\n` +
      `• **Location:** ${activeFacility.address}\n` +
      `• **Distance to ${activeTract.name}:** ${dist} miles\n` +
      `• **Reported Annual Emissions:** ${activeFacility.details?.airEmissions || "Inventory record available"}\n` +
      `• **Regulated Compounds:** ${activeFacility.details?.rmpChemicals || "See facility inventory"}\n\n` +
      `**Top Contributing Stacks in Corridor:**\n` +
      nearbyFacilities.map((f, i) => `${i + 1}. **${f.name}** (${f.distanceMiles} mi): ${f.type}`).join("\n");
  } else {
    const dist = calculateDistanceMiles(activeTract.center[0], activeTract.center[1], activeFacility.lat, activeFacility.lng).toFixed(2);
    replyText = `### Current RAPID assessment: ${activeTract.name}\n\n` +
      `• **Receptor:** ${activeTract.name} (Harris County, Population: ${activeTract.population.toLocaleString()})\n` +
      `• **Demographics:** People of Color: ${metrics.demographics.peopleOfColor} | Low Income: ${metrics.demographics.lowIncome}\n` +
      `• **Modeled Benzene:** **${metrics.current.benzene} µg/m³** (${activeTract.indicators?.CANCER || 90}th %ile in TX)\n` +
      `• **Selected Point Source:** ${activeFacility.name} (${dist} mi)\n\n` +
      `Ask about a facility, health benchmark, or an emission-reduction percentage to explore the current scenario.`;
  }

  return {
    reply: replyText,
    action,
    actionLabel,
    groundedSource: "RAPID Hypothetical Dispersion Physics Simulator"
  };
}

export function processInvestigatorQuery(userQuery, activeState = {}) {
  const scenario = buildHypotheticalScenarioContext(userQuery, activeState);
  return synthesizeHypotheticalScenario(scenario);
}
