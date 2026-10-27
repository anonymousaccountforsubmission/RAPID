/**
 * RAPID Houston Indicators & Schema Definition
 * Demographic and Environmental Justice Indicator Architecture
 */

export const INDICATOR_CATEGORIES = {
  primary_ej: {
    id: "primary_ej",
    title: "EJ Indexes",
    subtitle: "Combination of environmental indicator with Demographic Index (US/TX Percentile)",
    badge: "13 Indexes",
    color: "#005ea2",
    items: [
      {
        id: "P_PM25",
        name: "Particulate Matter 2.5",
        shortName: "PM2.5 EJ Index",
        unit: "Percentile",
        rawField: "PM25",
        rawUnit: "µg/m³",
        desc: "Annual average concentration of fine particles (PM2.5) in air, combined with Demographic Index.",
        healthImpact: "Fine particles penetrate deep into lung tissue and enter the bloodstream, causing asthma exacerbation, heart attacks, chronic bronchitis, and premature death.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_OZONE",
        name: "Ozone",
        shortName: "Ozone EJ Index",
        unit: "Percentile",
        rawField: "OZONE",
        rawUnit: "ppb",
        desc: "Average of daily maximum 8-hour ozone concentrations over warm season, combined with Demographic Index.",
        healthImpact: "Ground-level ozone triggers asthma attacks, inflamed respiratory airways, and reduced lung capacity, especially acute in Houston's petrochemical corridor.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_DIESEL",
        name: "Diesel Particulate Matter",
        shortName: "Diesel PM EJ Index",
        unit: "Percentile",
        rawField: "DIESEL",
        rawUnit: "µg/m³",
        desc: "Airborne diesel PM emissions from freight corridors, Port of Houston ship traffic, rail yards, and heavy trucks.",
        healthImpact: "Classified as a known human carcinogen and potent respiratory irritant contributing to cardiovascular stress.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_CANCER",
        name: "Air Toxics Cancer Risk",
        shortName: "Cancer Risk EJ Index",
        unit: "Percentile",
        rawField: "CANCER",
        rawUnit: "per 1M",
        desc: "Lifetime cancer risk from inhalation of EPA hazardous air pollutants (benzene, butadiene, ethylene oxide, etc.).",
        healthImpact: "Long-term toxic exposures significantly elevate incidence of leukemia, lymphoma, and multiple myeloma in Houston fence-line communities.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_RESP",
        name: "Air Toxics Respiratory Hazard",
        shortName: "Respiratory Index",
        unit: "Percentile",
        rawField: "RESP",
        rawUnit: "Hazard Index",
        desc: "Ratio of non-cancer inhalation concentrations to chronic reference concentrations for respiratory irritants.",
        healthImpact: "Values exceeding 1.0 indicate heightened risk of pulmonary inflammation, chronic obstructive pulmonary disease (COPD), and bronchitis.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_RSEI_AIR",
        name: "Toxic Releases to Air",
        shortName: "RSEI Air EJ Index",
        unit: "Percentile",
        rawField: "RSEI_AIR",
        rawUnit: "Toxics Score",
        desc: "Risk-Screening Environmental Indicators (RSEI) modeling toxic chemical emissions reported to the Toxics Release Inventory (TRI).",
        healthImpact: "Captures both volume and chemical toxicity of airborne refinery and industrial stack releases along the Houston Ship Channel.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_LEAD",
        name: "Lead Paint Indicator",
        shortName: "Lead Paint Index",
        unit: "Percentile",
        rawField: "LEAD",
        rawUnit: "% Pre-1960 Housing",
        desc: "Percentage of housing units built before 1960 as a proxy for potential childhood lead exposure.",
        healthImpact: "Lead exposure causes irreversible neurodevelopmental damage, IQ reduction, behavioral issues, and kidney damage in children.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_RMP",
        name: "Risk Management Plan (RMP) Proximity",
        shortName: "RMP Chemical Index",
        unit: "Percentile",
        rawField: "RMP",
        rawUnit: "Facilities / km",
        desc: "Count of potential catastrophic chemical release facilities within 5 km, inversely weighted by distance.",
        healthImpact: "Elevated risk of major toxic gas releases, explosions, and industrial chemical fires requiring emergency shelter-in-place.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_TSDF",
        name: "Hazardous Waste (TSDF) Proximity",
        shortName: "Hazardous Waste Index",
        unit: "Percentile",
        rawField: "TSDF",
        rawUnit: "Facilities / km",
        desc: "Count of Treatment, Storage, and Disposal Facilities within 5 km, inversely weighted by distance.",
        healthImpact: "Risk of chemical spills, soil contamination, VOC emissions, and industrial freight transit through residential neighborhoods.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_NPL",
        name: "Superfund (NPL) Proximity",
        shortName: "Superfund Proximity",
        unit: "Percentile",
        rawField: "NPL",
        rawUnit: "Sites / km",
        desc: "Proximity to National Priorities List (NPL) abandoned contaminated industrial sites (e.g., Patrick Bayou, San Jacinto Waste Pits).",
        healthImpact: "Legacy chemical saturation in groundwater, wetlands, and topsoil posing persistent exposure risks.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_UST",
        name: "Underground Storage Tanks (UST)",
        shortName: "UST Tank Index",
        unit: "Percentile",
        rawField: "UST",
        rawUnit: "Tanks / km",
        desc: "Weighted count of commercial underground fuel storage tanks and leaking UST cleanups.",
        healthImpact: "Subsurface leaks of gasoline and hydrocarbons threatening local municipal groundwater and basements.",
        epaWeight: "Census tract percentile relative to State or US."
      },
      {
        id: "P_PWDIS",
        name: "Wastewater Discharge",
        shortName: "Wastewater Discharge",
        unit: "Percentile",
        rawField: "PWDIS",
        rawUnit: "Stream Toxicity",
        desc: "Stream reach toxic pollutant concentration from permitted point-source NPDES effluent discharges.",
        healthImpact: "Contamination of Houston waterways, bayous (Buffalo Bayou, Houston Ship Channel, Galveston Bay) and recreational water contact.",
        epaWeight: "Census tract percentile relative to State or US."
      }
    ]
  },

  supplemental_ej: {
    id: "supplemental_ej",
    title: "Supplemental EJ Indexes",
    subtitle: "Environmental indicators combined with Supplemental Demographic Index (5 socioeconomic factors)",
    badge: "5 Factors",
    color: "#28a745",
    items: [
      {
        id: "S_PM25",
        name: "Supplemental PM2.5 Index",
        shortName: "Supp. PM2.5",
        unit: "Percentile",
        rawField: "PM25",
        desc: "Combines PM2.5 exposure with low income, unemployment, limited English, education, and low life expectancy.",
        healthImpact: "Highlights communities experiencing compounded socioeconomic barriers alongside fine particulate air burdens."
      },
      {
        id: "S_CANCER",
        name: "Supplemental Cancer Risk Index",
        shortName: "Supp. Cancer Risk",
        unit: "Percentile",
        rawField: "CANCER",
        desc: "Combines Air Toxics Cancer Risk with multi-dimensional community socioeconomic vulnerability.",
        healthImpact: "Pinpoints high-risk Houston cancer clusters lacking equitable access to advanced oncological and preventative care."
      },
      {
        id: "S_RSEI_AIR",
        name: "Supplemental Toxic Air Releases",
        shortName: "Supp. Toxic Releases",
        unit: "Percentile",
        rawField: "RSEI_AIR",
        desc: "Combines RSEI modeled toxic emissions with the Supplemental Demographic Index.",
        healthImpact: "Reveals industrial burdens disproportionately concentrated in economically constrained Houston zip codes."
      },
      {
        id: "S_RMP",
        name: "Supplemental Chemical Facility Proximity",
        shortName: "Supp. RMP",
        unit: "Percentile",
        rawField: "RMP",
        desc: "Combines chemical disaster threat zones with communities having limited evacuation or emergency resources.",
        healthImpact: "Essential for disaster preparedness and equitable municipal storm shelter allocation."
      }
    ]
  },

  environmental: {
    id: "environmental",
    title: "Environmental Indicators",
    subtitle: "Raw environmental burdens and monitored air/water measurements",
    badge: "Raw Physical Data",
    color: "#e66101",
    items: [
      {
        id: "RAW_PM25",
        name: "Particulate Matter 2.5 Raw Level",
        shortName: "PM2.5 (µg/m³)",
        unit: "µg/m³",
        rawField: "PM25",
        desc: "Annual average fine particulate matter concentration.",
        healthImpact: "EPA National Ambient Air Quality Standard (NAAQS) threshold is 9.0 µg/m³ annual mean."
      },
      {
        id: "RAW_OZONE",
        name: "Ozone Raw Level",
        shortName: "Ozone (ppb)",
        unit: "ppb",
        rawField: "OZONE",
        desc: "Warm-season average daily maximum 8-hour ozone.",
        healthImpact: "NAAQS 8-hour threshold is 70 ppb. High summertime heat in Houston intensifies photochemical smog production."
      },
      {
        id: "RAW_CANCER",
        name: "Air Toxics Lifetime Cancer Risk",
        shortName: "Cancer Risk (per 1M)",
        unit: "per million",
        rawField: "CANCER",
        desc: "Predicted additional cancer cases per 1,000,000 residents from ambient toxic air pollutants.",
        healthImpact: "Values exceeding 50 in 1 million warrant immediate environmental protection review."
      },
      {
        id: "RAW_RSEI",
        name: "Toxics Release Inventory Score",
        shortName: "RSEI Score",
        unit: "Toxicity Score",
        rawField: "RSEI_AIR",
        desc: "Relative toxicity and population exposure modeled score from TRI industrial reporting.",
        healthImpact: "Major refineries, chemical producers, and resin facilities report significant pounds released."
      }
    ]
  },

  socioeconomic: {
    id: "socioeconomic",
    title: "Socioeconomic Indicators",
    subtitle: "Demographic factors from the U.S. Census Bureau ACS (American Community Survey)",
    badge: "Census ACS",
    color: "#5e3c99",
    items: [
      {
        id: "DEMOGIDX",
        name: "Demographic Index",
        shortName: "Demographic Index",
        unit: "%",
        rawField: "DEMOGIDX",
        desc: "Average of Percent People of Color and Percent Low-Income.",
        healthImpact: "Core composite index used by EPA to identify historically overburdened environmental justice communities."
      },
      {
        id: "PEOPLE_OF_COLOR",
        name: "People of Color Percentage",
        shortName: "People of Color %",
        unit: "%",
        rawField: "PEOPLE_OF_COLOR_PCT",
        desc: "Total population minus individuals non-Hispanic white alone.",
        healthImpact: "Over 75% in many East Houston and South Houston fence-line communities."
      },
      {
        id: "LOW_INCOME",
        name: "Low-Income Percentage",
        shortName: "Low Income %",
        unit: "%",
        rawField: "LOW_INCOME_PCT",
        desc: "Individuals in households with income below 200% of the federal poverty level.",
        healthImpact: "Restricts access to air filtration, healthcare, legal advocacy, and rapid disaster recovery."
      },
      {
        id: "LIMITED_ENG",
        name: "Limited English Speaking Households",
        shortName: "Limited English %",
        unit: "%",
        rawField: "LIMITED_ENG_PCT",
        desc: "Percentage of households where no one age 14 and over speaks English 'very well'.",
        healthImpact: "Creates severe communication barriers during toxic shelter-in-place alerts and boil-water notices."
      },
      {
        id: "LESS_THAN_HS",
        name: "Less than High School Education",
        shortName: "No HS Diploma %",
        unit: "%",
        rawField: "LESS_THAN_HS_PCT",
        desc: "Adults age 25 and older without a high school diploma or equivalent.",
        healthImpact: "Correlated with lower economic mobility and higher employment in hazardous industrial occupations."
      }
    ]
  },

  health_climate: {
    id: "health_climate",
    title: "Health & Climate Vulnerabilities",
    subtitle: "Chronic disease burdens and Houston extreme weather / flood risk factors",
    badge: "CDC & HCFCD",
    color: "#d95f02",
    items: [
      {
        id: "ASTHMA",
        name: "Adult Asthma Prevalence",
        shortName: "Asthma %",
        unit: "%",
        rawField: "ASTHMA_PCT",
        desc: "CDC PLACES estimated adult asthma diagnosed prevalence.",
        healthImpact: "Acute in Houston Ship Channel neighborhoods with frequent particulate matter and ozone spikes."
      },
      {
        id: "HEART_DISEASE",
        name: "Coronary Heart Disease Prevalence",
        shortName: "Heart Disease %",
        unit: "%",
        rawField: "HEART_DISEASE_PCT",
        desc: "Diagnosed coronary heart disease prevalence from CDC PLACES.",
        healthImpact: "Exacerbated by long-term cardiovascular inflammation from fine diesel particulate exposures."
      },
      {
        id: "FLOOD_RISK",
        name: "100-Year Flood Zone Coverage",
        shortName: "Flood Risk %",
        unit: "%",
        rawField: "FLOOD_RISK_PCT",
        desc: "Percentage of tract area within FEMA / Harris County Flood Control District 100-year floodplain.",
        healthImpact: "Houston bayous frequently overflow during tropical storms (Harvey, Imelda), mobilizing toxic industrial runoff into residential homes."
      },
      {
        id: "LIFE_EXP",
        name: "Life Expectancy at Birth",
        shortName: "Life Expectancy",
        unit: "Years",
        rawField: "LIFE_EXPECTANCY",
        desc: "Average life expectancy from CDC National Center for Health Statistics.",
        healthImpact: "Disparities of over 15 to 20 years exist between River Oaks (~85 years) and Fifth Ward / Sunnyside (~67-69 years)."
      }
    ]
  }
};

/**
 * Percentile Color Ramp
 */
export const EJ_COLOR_RAMP = [
  { min: 0, max: 50, color: "#e0f3f8", label: "< 50th Percentile", desc: "Low Burden", textDark: true },
  { min: 50, max: 70, color: "#fee090", label: "50th - 70th Percentile", desc: "Moderate", textDark: true },
  { min: 70, max: 80, color: "#fdae61", label: "70th - 80th Percentile", desc: "Elevated", textDark: true },
  { min: 80, max: 90, color: "#f46d43", label: "80th - 90th Percentile", desc: "High EJ Concern", textDark: false },
  { min: 90, max: 95, color: "#d73027", label: "90th - 95th Percentile", desc: "Very High EJ Concern", textDark: false },
  { min: 95, max: 100, color: "#a50026", label: "95th - 100th Percentile", desc: "Critical EJ Action Priority", textDark: false }
];

export function getColorForPercentile(percentile) {
  if (percentile === null || percentile === undefined || isNaN(percentile)) return "#cccccc";
  for (const step of EJ_COLOR_RAMP) {
    if (percentile >= step.min && percentile <= step.max) {
      return step.color;
    }
  }
  return "#a50026";
}
