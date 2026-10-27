/** RAPID mobile application controller. */

import { HOUSTON_TRACTS, HOUSTON_FACILITIES, HOUSTON_AIR_MONITORS } from './houston-data.js';
import { HOUSTON_OSM_BOUNDARY } from './houston-osm-boundary.js';
import { SUPPORTED_POLLUTANTS } from './rapid-engine.js';
import {
  executeDispersionModel,
  checkModelServerHealth,
  onModelStatusChange,
  fetchRealtimePipeline
} from './model-bridge.js';
import {
  getAiStatus,
  executeInvestigatorQuery
} from './ai-service.js';

// 1. Shared Application State (Exclusively Benzene)
const state = {
  activeTab: 'tabExplore', // 'tabExplore', 'tabAsk', 'tabSimulate'
  selectedPollutant: 'BENZENE',
  selectedTractId: 'tract-manchester',
  selectedFacilityId: 'fac-valero',
  simReductionPct: 50,
  simulatedScenario: null,
  realtime: null,

  // Map configuration (Light, Airy Cartography)
  houstonCenter: [29.7450, -95.1800],
  houstonZoom: 11
};

// Map References
let map = null;
let currentTileLayer = null;
let dispersionLayerGroup = null;
let tractsGeoLayer = null;
let facilitiesLayerGroup = null;
let monitorsLayerGroup = null;
let boundaryLayerGroup = null;

// 2. Lifecycle Initialization
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initBottomNav();
  initBottomSheet();
  initSearch();
  initAskRAPID();
  initSimulateStudio();

  // Initial selection
  selectTract(state.selectedTractId, false);
  runSimulation();

  // Model Server & Bridge Health Check
  checkModelServerHealth();
  onModelStatusChange((status) => {
    const badge = document.getElementById('simModelBadge');
    if (badge) {
      badge.textContent = status.modelName;
      badge.classList.toggle('custom-active', status.connected);
    }
  });

  refreshLiveData();
  window.setInterval(refreshLiveData, 300000);
});

async function refreshLiveData() {
  const realtime = await fetchRealtimePipeline();
  if (!realtime?.weather || !realtime?.predictions) return;

  state.realtime = realtime;
  const source = document.getElementById('liveDataSource');
  const weather = realtime.weather;
  if (source) {
    source.textContent = `${weather.station} · ${weather.wind_speed_ms} m/s · ${Math.round(weather.wind_dir_deg)}°`;
    source.title = `NOAA observation ${weather.timestamp}`;
  }

  const tract = HOUSTON_TRACTS.find((item) => item.id === state.selectedTractId);
  if (tract) updateBottomSheet(tract);
  runSimulation();
}

function initMap() {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  map = L.map('map', {
    center: state.houstonCenter,
    zoom: state.houstonZoom,
    zoomControl: false,
    attributionControl: false
  });

  currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom'
  }).addTo(map);

  currentTileLayer.on('tileerror', function(error, tile) {
    if (tile && tile.src && !tile.src.includes('openstreetmap.de')) {
      const match = tile.src.match(/\/(\d+)\/(\d+)\/(\d+)/);
      if (match) {
        tile.src = `https://tile.openstreetmap.de/${match[1]}/${match[2]}/${match[3]}.png`;
      }
    }
  });

  // Invalidate map size across multiple layout passes
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 100);

  // Layer Groups
  dispersionLayerGroup = L.layerGroup().addTo(map);
  tractsGeoLayer = L.layerGroup().addTo(map);
  facilitiesLayerGroup = L.layerGroup().addTo(map);
  monitorsLayerGroup = L.layerGroup().addTo(map);
  boundaryLayerGroup = L.layerGroup().addTo(map);

  // Map Reset Button (Circular Arrow in Top Right)
  document.getElementById('mapResetBtn')?.addEventListener('click', () => {
    if (map) {
      map.flyTo(state.houstonCenter, state.houstonZoom, { duration: 0.8 });
    }
    selectTract('tract-manchester', false);
    renderSmoothDispersionField(state.selectedPollutant);
    showToast('Reset');
  });

  // Render Overlays
  renderSmoothDispersionField(state.selectedPollutant);
  renderTractHitAreas();
  renderFacilities();
  renderMonitors();
  setTimeout(() => renderOsmBoundary(), 250);
}

// 4. Pollutant-Specific Atmospheric Dispersion Profiles (PINN Physics & EPA Empirical Signatures)
const POLLUTANT_DISPERSION_PROFILES = {
  BENZENE: {
    name: 'Benzene',
    pctKey: 'P_CANCER',
    thresholdPct: 85,
    severePct: 95,
    legendGradient: 'linear-gradient(to right, #bae6fd, #38bdf8, #f59e0b, #ef4444)',
    stackSources: [
      { lat: 29.7212, lng: -95.2618, emissionWeight: 1.25 }, // Valero Manchester
      { lat: 29.7280, lng: -95.2420, emissionWeight: 1.05 }, // LyondellBasell
      { lat: 29.7313, lng: -95.1566, emissionWeight: 0.95 }, // Pasadena Refining
      { lat: 29.7390, lng: -95.0930, emissionWeight: 1.15 }, // Deer Park
      { lat: 29.7420, lng: -95.0179, emissionWeight: 1.30 }, // Exxon Baytown
      { lat: 29.7270, lng: -95.2320, emissionWeight: 0.95 }, // Galena Park
      { lat: 29.8177, lng: -95.1098, emissionWeight: 0.85 }  // Channelview
    ],
    layers: [
      { radius: 1300, color: '#ef4444', opacity: 0.38 },
      { radius: 2800, color: '#f59e0b', opacity: 0.28 },
      { radius: 5200, color: '#06b6d4', opacity: 0.18 },
      { radius: 7800, color: '#bae6fd', opacity: 0.11 }
    ],
    communityRadius: 2400,
    communityColors: { high: '#ef4444', mid: '#f59e0b' }
  },

  PM25: {
    name: 'Fine Particulate Matter',
    pctKey: 'P_PM25',
    thresholdPct: 80,
    severePct: 92,
    legendGradient: 'linear-gradient(to right, #bfdbfe, #60a5fa, #f59e0b, #ea580c)',
    stackSources: [
      { lat: 29.7780, lng: -95.3200, emissionWeight: 1.35 }, // Englewood Rail Corridor / Fifth Ward
      { lat: 29.7250, lng: -95.2650, emissionWeight: 1.20 }, // Manchester / Ship Channel Freight
      { lat: 29.7400, lng: -95.2320, emissionWeight: 1.15 }, // Galena Park Industrial Corridor
      { lat: 29.8050, lng: -95.3350, emissionWeight: 1.10 }, // I-610 North Industrial / Kashmere
      { lat: 29.7750, lng: -95.2250, emissionWeight: 1.05 }, // I-10 East Freeway Corridor
      { lat: 29.8177, lng: -95.1098, emissionWeight: 1.00 }, // Channelview Complex
      { lat: 29.7550, lng: -95.0140, emissionWeight: 0.95 }  // Baytown Industrial
    ],
    layers: [
      { radius: 1800, color: '#ea580c', opacity: 0.35 },
      { radius: 4200, color: '#f97316', opacity: 0.26 },
      { radius: 7600, color: '#f59e0b', opacity: 0.18 },
      { radius: 12000, color: '#38bdf8', opacity: 0.10 }
    ],
    communityRadius: 2800,
    communityColors: { high: '#ea580c', mid: '#f59e0b' }
  },

  OZONE: {
    name: 'Ozone',
    pctKey: 'P_OZONE',
    thresholdPct: 84,
    severePct: 92,
    legendGradient: 'linear-gradient(to right, #c7d2fe, #818cf8, #f59e0b, #e11d48)',
    stackSources: [
      { lat: 29.8290, lng: -95.1200, emissionWeight: 1.40 }, // Channelview Photochemical Corridor
      { lat: 29.7800, lng: -95.0300, emissionWeight: 1.35 }, // Highlands / San Jacinto Convergence
      { lat: 29.7550, lng: -95.0140, emissionWeight: 1.30 }, // Baytown Downwind Basin
      { lat: 29.8283, lng: -94.9185, emissionWeight: 1.20 }, // Cedar Bayou Convergence
      { lat: 29.7750, lng: -95.1600, emissionWeight: 1.15 }, // East Freeway Downwind Swath
      { lat: 29.7420, lng: -95.0800, emissionWeight: 1.05 }  // Deer Park Plume
    ],
    layers: [
      { radius: 2400, color: '#e11d48', opacity: 0.34 },
      { radius: 5200, color: '#f43f5e', opacity: 0.25 },
      { radius: 9500, color: '#f59e0b', opacity: 0.18 },
      { radius: 14500, color: '#818cf8', opacity: 0.10 }
    ],
    communityRadius: 3400,
    communityColors: { high: '#e11d48', mid: '#f59e0b' }
  },

  DIESEL: {
    name: 'Diesel PM',
    pctKey: 'P_DIESEL',
    thresholdPct: 85,
    severePct: 94,
    legendGradient: 'linear-gradient(to right, #93c5fd, #0284c7, #d97706, #991b1b)',
    stackSources: [
      { lat: 29.7420, lng: -95.2750, emissionWeight: 1.45 }, // Port of Houston Turning Basin
      { lat: 29.7780, lng: -95.3180, emissionWeight: 1.40 }, // Englewood Yard & I-610 Interchange
      { lat: 29.7400, lng: -95.2320, emissionWeight: 1.25 }, // Galena Park Marine Terminal
      { lat: 29.7250, lng: -95.1800, emissionWeight: 1.10 }, // Pasadena Highway 225 Heavy Freight
      { lat: 29.7500, lng: -95.2600, emissionWeight: 1.15 }, // Loop 610 East Freight Bridge
      { lat: 29.7390, lng: -95.0930, emissionWeight: 0.95 }  // Deer Park Terminal Artery
    ],
    layers: [
      { radius: 1100, color: '#991b1b', opacity: 0.40 },
      { radius: 2500, color: '#c2410c', opacity: 0.28 },
      { radius: 4600, color: '#d97706', opacity: 0.18 },
      { radius: 7200, color: '#0284c7', opacity: 0.11 }
    ],
    communityRadius: 2100,
    communityColors: { high: '#991b1b', mid: '#c2410c' }
  }
};

function renderSmoothDispersionField(polKey = 'BENZENE') {
  if (!dispersionLayerGroup) return;
  dispersionLayerGroup.clearLayers();

  const profile = POLLUTANT_DISPERSION_PROFILES[polKey] || POLLUTANT_DISPERSION_PROFILES.BENZENE;

  // Update top-left gradient strip to match the active pollutant
  const legendBar = document.querySelector('.leg-ramp-bar');
  if (legendBar && profile.legendGradient) {
    legendBar.style.background = profile.legendGradient;
  }

  const liveContributions = state.realtime?.predictions?.[state.selectedTractId]?.contributions || {};
  const contributionValues = Object.values(liveContributions).filter(Number.isFinite);
  const maxContribution = Math.max(...contributionValues, 0.0001);
  const sources = polKey === 'BENZENE'
    ? HOUSTON_FACILITIES
      .filter((facility) => facility.lat > 29.25 && facility.lat < 30.05 && facility.lng > -95.8 && facility.lng < -94.75)
      .map((facility) => ({
        lat: facility.lat,
        lng: facility.lng,
        emissionWeight: 0.65 + 0.85 * Math.sqrt((liveContributions[facility.id] || 0) / maxContribution)
      }))
    : profile.stackSources;

  sources.forEach((src) => {
    profile.layers.forEach((layerSpec) => {
      dispersionLayerGroup.addLayer(
        L.circle([src.lat, src.lng], {
          radius: layerSpec.radius * src.emissionWeight,
          fillColor: layerSpec.color,
          fillOpacity: layerSpec.opacity,
          stroke: false
        })
      );
    });
  });

  // Ambient community gradient nodes evaluated for active pollutant's percentile distribution
  HOUSTON_TRACTS.forEach((t) => {
    const pct = t.percentiles?.TX?.[profile.pctKey] || 75;
    if (pct >= profile.thresholdPct) {
      dispersionLayerGroup.addLayer(
        L.circle(t.center, {
          radius: profile.communityRadius,
          fillColor: pct >= profile.severePct ? profile.communityColors.high : profile.communityColors.mid,
          fillOpacity: 0.18,
          stroke: false
        })
      );
    }
  });
}

function renderTractHitAreas() {
  tractsGeoLayer.clearLayers();

  const features = HOUSTON_TRACTS.map((t) => ({
    type: 'Feature',
    properties: {
      id: t.id,
      name: t.name,
      geoid: t.geoid
    },
    geometry: {
      type: 'Polygon',
      coordinates: [t.coordinates.map((coord) => [coord[1], coord[0]])]
    }
  }));

  const geoLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: (feat) => {
      const isSelected = feat.properties.id === state.selectedTractId;
      return {
        fillOpacity: isSelected ? 0.08 : 0.0,
        fillColor: '#0284c7',
        stroke: isSelected,
        color: '#0284c7',
        weight: isSelected ? 2.5 : 0
      };
    },
    onEachFeature: (feat, layer) => {
      layer.on({
        click: () => {
          selectTract(feat.properties.id, true);
        }
      });
    }
  });

  tractsGeoLayer.addLayer(geoLayer);
}

function renderFacilities() {
  facilitiesLayerGroup.clearLayers();

  HOUSTON_FACILITIES.forEach((fac) => {
    const icon = L.divIcon({
      className: 'map-simple-dot-wrap',
      html: `<div class="map-simple-dot"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    const marker = L.marker([fac.lat, fac.lng], { icon });

    marker.bindPopup(`
      <div class="popup-title">${fac.name}</div>
      <div class="popup-sub">${fac.details.airEmissions}</div>
      <button class="popup-btn" data-fac-id="${fac.id}">Simulate Cut</button>
    `);

    marker.on('popupopen', () => {
      const btn = document.querySelector(`.popup-btn[data-fac-id="${fac.id}"]`);
      if (btn) {
        btn.onclick = () => {
          state.selectedFacilityId = fac.id;
          document.querySelectorAll('#simFacilityChips .in-ui-chip').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-val') === fac.id);
          });
          switchTab('tabSimulate');
          runSimulation();
        };
      }
    });

    facilitiesLayerGroup.addLayer(marker);
  });
}

function renderMonitors() {
  monitorsLayerGroup.clearLayers();

  HOUSTON_AIR_MONITORS.forEach((mon) => {
    const icon = L.divIcon({
      className: 'map-simple-dot-wrap',
      html: `<div class="map-simple-dot"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    const marker = L.marker([mon.lat, mon.lng], { icon });
    marker.bindPopup(`
      <div class="popup-title">${mon.name}</div>
      <div class="popup-sub">${mon.lastReading}</div>
    `);
    monitorsLayerGroup.addLayer(marker);
  });
}

// Render City Boundary
function renderOsmBoundary() {
  boundaryLayerGroup.clearLayers();
  if (!HOUSTON_OSM_BOUNDARY) return;

  try {
    const boundaryLayer = L.geoJSON(HOUSTON_OSM_BOUNDARY, {
      style: {
        color: '#0284c7',
        weight: 1.5,
        dashArray: '4, 4',
        fillOpacity: 0.0,
        opacity: 0.35
      }
    });
    boundaryLayerGroup.addLayer(boundaryLayer);
  } catch (err) {}
}

// 4. Shared State Selectors
export function selectTract(tractId, zoomTo = false) {
  const tract = HOUSTON_TRACTS.find((t) => t.id === tractId);
  if (!tract) return;

  state.selectedTractId = tractId;

  // Refresh tract selection outline
  renderTractHitAreas();

  if (zoomTo && map) {
    map.flyTo(tract.center, 13, { duration: 0.8 });
  }

  // Update Bottom Sheet
  updateBottomSheet(tract);

  // Update Ask RAPID Context
  const askLoc = document.getElementById('askCurrentLocation');
  if (askLoc) {
    askLoc.textContent = tract.name.split('/')[0].trim();
  }

  document.querySelectorAll('#simReceptorChips .in-ui-chip').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-val') === tractId);
  });

  runSimulation();
}

function updateBottomSheet(tract) {
  const sheet = document.getElementById('exploreBottomSheet');
  if (!sheet) return;

  sheet.classList.remove('hidden');

  document.getElementById('sheetTractName').textContent = tract.name.split('/')[0].trim();

  // Selected Pollutant (Benzene, PM2.5, Ozone, Diesel PM)
  const polKey = state.selectedPollutant || 'BENZENE';
  const pol = SUPPORTED_POLLUTANTS[polKey] || SUPPORTED_POLLUTANTS.BENZENE;
  const liveBenzene = state.realtime?.predictions?.[tract.id]?.benzene_ug_m3;
  const val = polKey === 'BENZENE' && Number.isFinite(liveBenzene)
    ? liveBenzene
    : pol.convertFromRaw(tract);

  const valEl = document.getElementById('heroPollutantVal');
  if (valEl) valEl.textContent = val;

  const unitEl = document.getElementById('heroPollutantUnit');
  if (unitEl) unitEl.textContent = pol.unit;

  const polLabelEl = document.getElementById('selectedPollutantLabel');
  if (polLabelEl) {
    const labelMap = { BENZENE: 'Benzene', PM25: 'PM2.5', OZONE: 'Ozone', DIESEL: 'Diesel PM' };
    polLabelEl.textContent = labelMap[polKey] || pol.name;
  }

  // Update active state on custom dropdown items
  document.querySelectorAll('#pollutantDropdownMenu .custom-dropdown-item').forEach((item) => {
    const isCur = item.getAttribute('data-value') === polKey;
    item.classList.toggle('active', isCur);
    item.setAttribute('aria-selected', isCur ? 'true' : 'false');
  });

  updateConcentrationSparkline(val, polKey);

  // Keep map concentration field synchronized with active pollutant
  renderSmoothDispersionField(polKey);
}

function updateConcentrationSparkline(baseVal, polKey = 'BENZENE') {
  const lineEl = document.getElementById('sparklineLine');
  const dotEl = document.getElementById('sparklineDot');
  if (!lineEl) return;

  const numVal = parseFloat(baseVal) || 2.5;

  let maxY = 3.0;
  let seasonalFactors = [1.16, 1.12, 1.05, 0.96, 0.88, 0.83, 0.81, 0.86, 0.94, 1.02, 1.10, 1.18];
  let ticks = ['3.0', '2.0', '1.0', '0.0'];

  if (polKey === 'PM25') {
    maxY = 15.0;
    ticks = ['15.0', '10.0', '5.0', '0.0'];
    seasonalFactors = [1.08, 1.05, 1.02, 0.96, 0.92, 0.95, 0.98, 1.01, 0.99, 1.02, 1.06, 1.10];
  } else if (polKey === 'OZONE') {
    maxY = 90.0;
    ticks = ['90', '60', '30', '0'];
    seasonalFactors = [0.72, 0.78, 0.88, 0.98, 1.12, 1.22, 1.25, 1.20, 1.08, 0.94, 0.80, 0.70];
  } else if (polKey === 'DIESEL') {
    maxY = 2.0;
    ticks = ['2.0', '1.3', '0.7', '0.0'];
    seasonalFactors = [1.14, 1.10, 1.04, 0.97, 0.90, 0.85, 0.82, 0.88, 0.95, 1.03, 1.11, 1.16];
  }

  // Update Y-Axis Ticks in SVG
  const t3 = document.getElementById('yTick3');
  const t2 = document.getElementById('yTick2');
  const t1 = document.getElementById('yTick1');
  const t0 = document.getElementById('yTick0');
  if (t3) t3.textContent = ticks[0];
  if (t2) t2.textContent = ticks[1];
  if (t1) t1.textContent = ticks[2];
  if (t0) t0.textContent = ticks[3];

  const points = seasonalFactors.map((factor, i) => {
    const x = 22 + i * 26.5;
    const conc = numVal * (factor / 1.0);
    // Maps to Y-axis ticks (top=20, bottom=110)
    let y = 110 - (conc / maxY) * 90;
    y = Math.max(16, Math.min(108, y)); // keep within bounds above black x-axis
    return { x: +x.toFixed(1), y: +y.toFixed(1) };
  });

  let pathD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }

  lineEl.setAttribute('d', pathD);

  if (dotEl) {
    const lastPt = points[points.length - 1];
    dotEl.setAttribute('cx', lastPt.x);
    dotEl.setAttribute('cy', lastPt.y);
  }
}

// 5. Bottom Navigation
function initBottomNav() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  document.getElementById('actionAskAiBtn')?.addEventListener('click', () => {
    const tract = HOUSTON_TRACTS.find((t) => t.id === state.selectedTractId);
    switchTab('tabAsk');
    if (tract) {
      sendChatMessage(`Modeled benzene exposure in ${tract.name}?`);
    }
  });

  document.getElementById('actionSimulateBtn')?.addEventListener('click', () => {
    switchTab('tabSimulate');
    runSimulation();
  });
}

export function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    const isActive = btn.getAttribute('data-tab') === tabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('.app-tab-view').forEach((view) => {
    view.classList.toggle('active', view.id === tabId);
  });

  if (tabId === 'tabExplore' && map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 150);
  }
}

// 6. Mobile Bottom Sheet
function initBottomSheet() {
  const sheet = document.getElementById('exploreBottomSheet');
  const handle = document.getElementById('sheetDragHandle');
  handle?.addEventListener('click', () => {
    sheet?.classList.toggle('collapsed');
  });

  initPollutantDropdown();
}

function initPollutantDropdown() {
  const trigger = document.getElementById('pollutantDropdownTrigger');
  const menu = document.getElementById('pollutantDropdownMenu');
  if (!trigger || !menu) return;

  const toggleMenu = (forceState) => {
    const isCurrentlyOpen = menu.style.display !== 'none';
    const shouldOpen = forceState !== undefined ? forceState : !isCurrentlyOpen;
    menu.style.display = shouldOpen ? 'flex' : 'none';
    trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Handle in-UI option click
  menu.querySelectorAll('.custom-dropdown-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = item.getAttribute('data-value');
      if (val && SUPPORTED_POLLUTANTS[val]) {
        state.selectedPollutant = val;
        toggleMenu(false);
        const tract = HOUSTON_TRACTS.find(t => t.id === state.selectedTractId) || HOUSTON_TRACTS[0];
        updateBottomSheet(tract);
        renderSmoothDispersionField(val);
      }
    });
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!document.getElementById('pollutantDropdownWrap')?.contains(e.target)) {
      toggleMenu(false);
    }
  });
}

// 7. Global Search
function initSearch() {
  const input = document.getElementById('globalSearchInput');
  const dropdown = document.getElementById('searchResultsDropdown');
  if (!input || !dropdown) return;

  let debounceTimer = null;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clearTimeout(debounceTimer);
    if (!q) {
      dropdown.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(() => {
      const results = [];
      HOUSTON_TRACTS.forEach((t) => {
        if (t.name.toLowerCase().includes(q) || t.superNeighborhood.toLowerCase().includes(q)) {
          results.push({ type: 'tract', id: t.id, title: t.name });
        }
      });
      HOUSTON_FACILITIES.forEach((f) => {
        if (f.name.toLowerCase().includes(q)) {
          results.push({ type: 'facility', id: f.id, title: f.name });
        }
      });

      if (results.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      dropdown.innerHTML = results.slice(0, 5).map(r => `
        <div class="search-result-item" data-type="${r.type}" data-id="${r.id}">
          <span>${r.title}</span>
        </div>
      `).join('');
      dropdown.style.display = 'block';

      dropdown.querySelectorAll('.search-result-item').forEach(el => {
        el.onclick = () => {
          const type = el.getAttribute('data-type');
          const id = el.getAttribute('data-id');
          dropdown.style.display = 'none';
          input.value = '';
          if (type === 'tract') {
            selectTract(id, true);
            switchTab('tabExplore');
          } else {
            const fac = HOUSTON_FACILITIES.find(f => f.id === id);
            if (fac && map) {
              switchTab('tabExplore');
              map.flyTo([fac.lat, fac.lng], 14, { duration: 0.8 });
            }
          }
        };
      });
    }, 200);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

// 8. Ask RAPID
let conversationHistory = [];
let simulationRequestId = 0;

async function updateAiStatusUI() {
  const dot = document.getElementById('apiKeyBtnDot');
  const txt = document.getElementById('apiKeyBtnText');
  const status = await getAiStatus();
  if (status.available) {
    if (dot) dot.style.background = '#10b981';
    if (txt) txt.textContent = 'Gemini Live';
  } else {
    if (dot) dot.style.background = '#f59e0b';
    if (txt) txt.textContent = 'Local AI';
  }
}

function initAskRAPID() {
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  updateAiStatusUI();

  // Prompt Chips
  document.querySelectorAll('.clean-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      sendChatMessage(prompt);
    });
  });

  // Form Submit
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    sendChatMessage(q);
  });
}

export async function sendChatMessage(queryText) {
  const thread = document.getElementById('chatThread');
  if (!thread) return;

  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'chat-msg user';
  userMsgEl.innerHTML = `
    <div class="msg-bubble"><p>${escapeHtml(queryText)}</p></div>
  `;
  thread.appendChild(userMsgEl);
  thread.scrollTop = thread.scrollHeight;

  // Add to conversational history
  conversationHistory.push({ role: 'user', text: queryText });

  const typingEl = document.createElement('div');
  typingEl.className = 'chat-msg assistant';
  typingEl.innerHTML = `
    <div class="msg-bubble" style="color:var(--text-muted);"><p>Analyzing dispersion...</p></div>
  `;
  thread.appendChild(typingEl);
  thread.scrollTop = thread.scrollHeight;

  try {
    const result = await executeInvestigatorQuery(queryText, state, conversationHistory.slice(0, -1));

    if (typingEl.parentNode) {
      thread.removeChild(typingEl);
    }

    // Save assistant reply to conversation history
    conversationHistory.push({ role: 'assistant', text: result.reply });

    const aiMsgEl = document.createElement('div');
    aiMsgEl.className = 'chat-msg assistant';

    let actionBtnHtml = '';
    if (result.action && result.actionLabel) {
      actionBtnHtml = `
        <button class="msg-action-btn" data-action='${JSON.stringify(result.action)}'>
          ${result.actionLabel}
        </button>
      `;
    }

    aiMsgEl.innerHTML = `
      <div class="msg-bubble">
        <div class="msg-text">${formatMarkdown(result.reply)}</div>
        ${actionBtnHtml ? `<div class="msg-actions-wrap">${actionBtnHtml}</div>` : ''}
      </div>
    `;

    const actionBtn = aiMsgEl.querySelector('.msg-action-btn');
    if (actionBtn) {
      actionBtn.onclick = () => {
        const action = JSON.parse(actionBtn.getAttribute('data-action'));
        handleAiAction(action);
      };
    }

    thread.appendChild(aiMsgEl);
    thread.scrollTop = thread.scrollHeight;
  } catch (err) {
    if (typingEl.parentNode) {
      thread.removeChild(typingEl);
    }
    console.error('Chat error:', err);
    const errorEl = document.createElement('div');
    errorEl.className = 'chat-msg assistant';
    errorEl.innerHTML = '<div class="msg-bubble"><p>I could not complete that request. Please try again.</p></div>';
    thread.appendChild(errorEl);
  }
}

function handleAiAction(action) {
  if (action.type === 'SELECT_TRACT') {
    selectTract(action.tractId, true);
    switchTab('tabExplore');
  } else if (action.type === 'SWITCH_TAB') {
    if (action.facilityId) {
      state.selectedFacilityId = action.facilityId;
      document.querySelectorAll('#simFacilityChips .in-ui-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-val') === action.facilityId);
      });
    }
    if (action.reductionPercent) {
      state.simReductionPct = action.reductionPercent;
      const slider = document.getElementById('simReductionSlider');
      if (slider) slider.value = action.reductionPercent;
    }
    switchTab(action.tab === 'simulate' ? 'tabSimulate' : 'tabExplore');
    if (action.tab === 'simulate') runSimulation();
  } else if (action.type === 'OPEN_URL' && action.url) {
    window.open(action.url, '_blank');
  }
}

function formatMarkdown(text) {
  if (!text) return '';
  text = escapeHtml(text);

  // Process markdown tables (lines starting and ending with |)
  const rawLines = text.split('\n');
  const processed = [];
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const line = rawLine.trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      // Skip markdown separator row like |---|---|
      if (/^\|[\s\-:|]+\|$/.test(line)) {
        continue;
      }
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      if (!inTable) {
        inTable = true;
        tableRows.push('<thead><tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>');
      } else {
        tableRows.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
      }
    } else {
      if (inTable) {
        inTable = false;
        processed.push('<table class="chat-md-table">' + tableRows.join('') + '</tbody></table>');
        tableRows = [];
      }
      processed.push(rawLine);
    }
  }
  if (inTable) {
    processed.push('<table class="chat-md-table">' + tableRows.join('') + '</tbody></table>');
  }

  let formatted = processed.join('\n');

  // Convert raw URLs into clickable links (safely handling trailing punctuation like commas/periods)
  formatted = formatted.replace(
    /(https?:\/\/[^\s<]+?)([.,;)]?)(\s|$)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>$2$3'
  );

  return formatted
    .replace(/^### (.*$)/gim, '<h3 style="font-size:0.92rem;margin-bottom:6px;font-weight:600;color:var(--text-main);">$1</h3>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/\n\n/gim, '</p><p style="margin-top:8px;">')
    .replace(/• (.*$)/gim, '<li style="margin-left:14px;margin-top:2px;">$1</li>');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function initSimulateStudio() {
  const slider = document.getElementById('simReductionSlider');
  const displayVal = document.getElementById('simReductionDisplay');

  document.querySelectorAll('#simFacilityChips .in-ui-chip').forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll('#simFacilityChips .in-ui-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.selectedFacilityId = chip.getAttribute('data-val');
      runSimulation();
    };
  });

  document.querySelectorAll('#simReceptorChips .in-ui-chip').forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll('#simReceptorChips .in-ui-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.selectedTractId = chip.getAttribute('data-val');
      selectTract(state.selectedTractId, false);
      runSimulation();
    };
  });

  slider?.addEventListener('input', () => {
    state.simReductionPct = parseInt(slider.value, 10);
    if (displayVal) displayVal.textContent = `-${state.simReductionPct}%`;
    runSimulation();
  });

  const viewMapBtn = document.getElementById('simViewOnMapBtn');
  const askAiBtn = document.getElementById('simAskAiBtn');
  const resetBtn = document.getElementById('simResetBtn');

  // Button 1: View on Map (Primary)
  viewMapBtn?.addEventListener('click', () => {
    const sim = state.simulatedScenario;
    if (!sim) return;
    switchTab('tabExplore');
    selectTract(sim.receptor.id, true);
    showToast(`-${sim.reductionPercent}%`);
  });

  // Button 2: Ask AI (Secondary)
  askAiBtn?.addEventListener('click', () => {
    const sim = state.simulatedScenario;
    if (!sim) return;
    switchTab('tabAsk');
    sendChatMessage(`What happens to benzene levels if ${sim.facility.name} cuts emissions by ${sim.reductionPercent}%?`);
  });

  // Button 3: Reset (Secondary)
  resetBtn?.addEventListener('click', () => {
    state.simReductionPct = 0;
    if (slider) slider.value = 0;
    if (displayVal) displayVal.textContent = `0%`;
    runSimulation();
    showToast('0%');
  });
}

async function runSimulation() {
  const requestId = ++simulationRequestId;
  const result = await executeDispersionModel({
    facilityId: state.selectedFacilityId,
    reductionPercent: state.simReductionPct,
    receptorTractId: state.selectedTractId,
    pollutantId: 'BENZENE'
  });

  if (requestId !== simulationRequestId) return;
  state.simulatedScenario = result;
  if (!result.success) return;

  const baseVal = document.getElementById('simBaselineVal');
  if (baseVal) baseVal.textContent = result.baselineConcentration;

  const projVal = document.getElementById('simProjectedVal');
  if (projVal) projVal.textContent = result.simulatedConcentration;

  const deltaBadge = document.getElementById('simDeltaPctBadge');
  if (deltaBadge) deltaBadge.textContent = `${result.percentChange}%`;

  const modelBadge = document.getElementById('simModelBadge');
  if (modelBadge && result.modelSource) {
    modelBadge.textContent = result.modelSource;
  }
}

// 10. Toast Utility
let toastTimer = null;
export function showToast(msg) {
  const toast = document.getElementById('appToast');
  if (!toast) return;

  toast.textContent = msg;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}
