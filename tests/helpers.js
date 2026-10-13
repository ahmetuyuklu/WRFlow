const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ console });
for (const name of ['utils', 'projection', 'domain', 'datetime', 'physics', 'config',
  'namelist-wps', 'namelist-input', 'download-scripts', 'run-script']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
}
const modules = vm.runInContext('({ WRFUtils, WRFProjection, WRFDomain, WRFDateTime, WRFPhysics, WRFConfig, WRFNamelistWPS, WRFNamelistInput, WRFDownloadScripts, WRFRunScript })', context);

function root(extra = {}) {
  return { id: 1, parent_id: 1, parent_grid_ratio: 1, i_parent_start: 1, j_parent_start: 1,
    e_we: 301, e_sn: 301, dx: 9000, dy: 9000, ref_lat: 39, ref_lon: 35, bounds: {}, ...extra };
}

function makeState(extra = {}) {
  const state = { schemaVersion: 2, currentStep: 1, mapProj: 'lambert', truelat1: 30, truelat2: 60, standLon: 35,
    projectionAuto: { truelat1: true, truelat2: true, standLon: true }, domains: [root()],
    dataSource: 'GFS', gfsInterval: 3, startDateStr: '2025-01-01', startHour: 0, durationHours: 24,
    startForecastHour: 0, intervalSeconds: 10800, intervalSecondsOverride: null,
    eVert: 45, pTop: 5000, etaLevels: '', numMetgridLevels: null, mynnClosure: 2.5, mynnEdmf: 1,
    physics: modules.WRFPhysics.getDefaults(), sstUpdate: 0, sfUrbanPhysics: 0, sfLakePhysics: 0, shcuPhysics: 0,
    feedback: 1, wDamping: 1, dampOpt: 3, dampCoef: 0.2, diffOpt: 1, kmOpt: 4, diff6thOpt: 0, zdamp: 5000,
    restartInterval: 1440, framesPerOutfile: 1000, debugLevel: 0, historyInterval: null,
    wpsDir: '/path/to/WPS', wrfDir: '/path/to/WRF', geogDataPath: '/path/to/WPS_GEOG',
    downloadDataDir: './wrf_data', outputDir: './wrf_output', scheduler: 'local', numProcs: 4,
    slurmPartition: 'compute', slurmNodes: 1, slurmNtasksPerNode: 32, slurmWalltime: '24:00:00', slurmAccount: '', ...extra };
  try {
    const geometry = modules.WRFDomain.buildGeometries(state.domains, state);
    state.domains.forEach(d => { if (geometry[d.id]) d.bounds = geometry[d.id].bounds; });
    const time = modules.WRFDateTime.getTimeline(state);
    state.startDate = time.start; state.endDate = time.end;
  } catch { /* Invalid-state fixtures are intentionally retained for validation tests. */ }
  return state;
}

module.exports = { ...modules, root, makeState };
