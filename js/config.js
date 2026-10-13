/** WRFlow — Shared configuration validation and generation snapshot. */
const WRFConfig = (() => {
  const SCHEMA_VERSION = 2;

  function validate(state, { draft = false } = {}) {
    const errors = [];
    if (!['GFS', 'ERA5'].includes(state.dataSource)) errors.push('Choose GFS or ERA5.');
    if (![1, 3].includes(state.gfsInterval)) errors.push('Select a 1h or 3h GFS data interval.');
    const domains = state.domains;
    if (!Array.isArray(domains) || domains.length < 1 || domains.length > 4) return ['Configure between one and four domains.'];
    try {
      WRFDomain.renumberDomains(domains);
      WRFProjection.create(state, domains[0].ref_lon);
      WRFDomain.buildGeometries(domains, state);
    } catch (error) { errors.push(error.message); }
    domains.forEach(dom => {
      const name = `d${WRFUtils.pad(dom.id, 2)}`;
      if (!draft && !dom.bounds) errors.push(`Draw ${name} before generating files.`);
      if (!Number.isInteger(dom.e_we) || !Number.isInteger(dom.e_sn) || dom.e_we < 10 || dom.e_sn < 10 ||
          !Number.isFinite(dom.dx) || !Number.isFinite(dom.dy) || dom.dx <= 0 || dom.dy <= 0) errors.push(`${name}: invalid dimensions or spacing.`);
      if (!Number.isFinite(dom.ref_lat) || !Number.isFinite(dom.ref_lon) || Math.abs(dom.ref_lat) > 90) errors.push(`${name}: invalid reference coordinates.`);
      if (dom.id === 1 && (dom.parent_id !== 1 || dom.parent_grid_ratio !== 1 || dom.i_parent_start !== 1 || dom.j_parent_start !== 1)) errors.push('d01 must reference itself with ratio and starts equal to 1.');
      if (state.mapProj !== 'lat-lon' && dom.dx !== dom.dy) errors.push(`${name}: projected WRF grids require DX = DY.`);
      if (dom.id > 1) {
        const parent = domains.find(d => d.id === dom.parent_id);
        if (!Number.isInteger(dom.parent_grid_ratio) || dom.parent_grid_ratio < 3 || dom.parent_grid_ratio % 2 === 0) {
          errors.push(`${name}: use an odd nesting ratio of at least 3.`);
        } else if (parent && dom.bounds && !draft) {
          errors.push(...WRFDomain.validateNest(parent, dom).map(e => `${name}: ${e}`));
        }
        if (!Number.isInteger(dom.i_parent_start) || !Number.isInteger(dom.j_parent_start)) errors.push(`${name}: parent-grid starts must be integers.`);
      }
    });
    if (!draft || state.startDateStr || state.startDate) {
      try {
        const time = WRFDateTime.getTimeline(state);
        if (!draft && state.dataSource === 'GFS' && time.cycle > new Date()) errors.push('The selected GFS cycle is in the future.');
      } catch (error) { errors.push(error.message); }
    }
    errors.push(...WRFPhysics.configurationErrors(state));
    if (!Number.isInteger(state.eVert) || state.eVert < 28 || state.eVert > 100) errors.push('Use 28–100 vertical levels.');
    if (!Number.isFinite(state.pTop) || state.pTop <= 0) errors.push('Model top pressure must be positive.');
    if (!Number.isFinite(state.dampCoef) || state.dampCoef < 0) errors.push('Damping coefficient must be finite and nonnegative.');
    if (!Number.isFinite(state.zdamp) || state.zdamp < 0 || (state.dampOpt > 0 && state.zdamp === 0)) errors.push('Use a positive damping depth when damping is enabled.');
    if (!Number.isInteger(state.debugLevel) || state.debugLevel < 0) errors.push('Debug level must be a nonnegative integer.');
    if (state.numMetgridLevels != null && (!Number.isInteger(state.numMetgridLevels) || state.numMetgridLevels < 2)) errors.push('Metgrid levels must be an integer of at least 2.');
    const eta = (state.etaLevels || '').trim();
    if (eta) {
      const entries = eta.replace(/,\s*$/, '').split(',').map(s => s.trim());
      const levels = entries.map(Number);
      if (levels.length !== state.eVert || levels[0] !== 1 || levels.at(-1) !== 0 ||
          entries.some(v => !v) || levels.some((v, i) => !Number.isFinite(v) || v < 0 || v > 1 || (i > 0 && v >= levels[i - 1]))) {
        errors.push('Eta levels must match e_vert and decrease strictly from 1 to 0.');
      }
    }
    for (const [key, options] of Object.entries({ feedback: [0, 1], wDamping: [0, 1], dampOpt: [0, 1, 2, 3],
      diffOpt: [0, 1, 2], kmOpt: [1, 2, 3, 4], diff6thOpt: [0, 1, 2], shcuPhysics: [0, 2, 3, 5],
      sfUrbanPhysics: [0, 1, 2, 3], sfLakePhysics: [0, 1], sstUpdate: [0, 1], mynnEdmf: [0, 1] })) {
      if (state[key] != null && !options.includes(state[key])) errors.push(`Choose a supported ${key} option.`);
    }
    for (const key of ['historyInterval', 'restartInterval', 'framesPerOutfile', 'numProcs', 'slurmNodes', 'slurmNtasksPerNode']) {
      if (state[key] != null && (!Number.isInteger(state[key]) || state[key] < 1)) errors.push(`${key} must be a positive integer.`);
    }
    for (const key of ['wpsDir', 'wrfDir', 'geogDataPath', 'downloadDataDir', 'outputDir']) {
      if (typeof state[key] !== 'string' || !state[key].trim() || /[\r\n\0]/.test(state[key])) errors.push(`${key}: enter a valid path.`);
    }
    if (!['local', 'mpi', 'slurm'].includes(state.scheduler)) errors.push('Choose a supported execution mode.');
    if (state.scheduler === 'slurm') {
      if (!/^(?:\d+-)?\d+:[0-5]\d(?::[0-5]\d)?$/.test(state.slurmWalltime || '')) errors.push('Enter a valid Slurm walltime.');
      if (!/^[\w.-]+$/.test(state.slurmPartition || '') || (state.slurmAccount && !/^[\w.-]+$/.test(state.slurmAccount))) errors.push('Enter valid Slurm partition/account names.');
    }
    return [...new Set(errors)];
  }

  function prepare(state) {
    const errors = validate(state);
    if (errors.length) throw new Error(errors.join('\n'));
    const domains = WRFDomain.renumberDomains(state.domains).domains;
    const geometry = WRFDomain.buildGeometries(domains, state);
    domains.forEach(d => Object.assign(d, { bounds: geometry[d.id].bounds, dx: geometry[d.id].dx, dy: geometry[d.id].dy }));
    const timeline = WRFDateTime.getTimeline(state);
    return { ...state, domains, timeline, etaLevels: (state.etaLevels || '').replace(/,\s*$/, ''), cycleDate: timeline.cycle, startDate: timeline.start,
      endDate: timeline.end, intervalSeconds: timeline.interval };
  }

  function importState(raw, defaults) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Import a configuration object.');
    if (raw.schemaVersion > SCHEMA_VERSION) throw new Error('This configuration requires a newer WRFlow version.');
    const candidate = { ...defaults };
    Object.keys(defaults).forEach(key => { if (Object.hasOwn(raw, key)) candidate[key] = raw[key]; });
    candidate.physics = { ...defaults.physics, ...raw.physics };
    candidate.projectionAuto = { truelat1: false, truelat2: false, standLon: false, ...raw.projectionAuto };
    if (!Object.hasOwn(raw, 'startDateStr') && (raw.cycleDate || raw.startDate)) {
      const cycle = new Date(raw.cycleDate || raw.startDate);
      if (!Number.isFinite(cycle.getTime())) throw new Error('Invalid imported date.');
      candidate.startDateStr = cycle.toISOString().slice(0, 10);
      candidate.startHour = raw.startHour ?? cycle.getUTCHours();
    }
    if ((raw.schemaVersion || 1) < 2) {
      if (candidate.physics.bl_pbl_physics === 4) { candidate.physics.bl_pbl_physics = 5; candidate.mynnClosure = 2.5; }
      else if (candidate.physics.bl_pbl_physics === 5) candidate.mynnClosure = 3;
      // Former Local/Auto launched MPI based solely on PATH; Local is now serial.
    }
    candidate.schemaVersion = SCHEMA_VERSION;
    if (!Number.isInteger(candidate.currentStep) || candidate.currentStep < 0 || candidate.currentStep > 5) throw new Error('Invalid wizard step.');
    candidate.domains = WRFDomain.renumberDomains(candidate.domains).domains;
    if (candidate.mapProj !== 'lat-lon') candidate.domains[0].dy = candidate.domains[0].dx;
    candidate.domains.slice(1).forEach(d => {
      const parent = candidate.domains.find(p => p.id === d.parent_id);
      d.dx = parent.dx / d.parent_grid_ratio;
      d.dy = parent.dy / d.parent_grid_ratio;
    });
    const errors = validate(candidate, { draft: true });
    if (errors.length) throw new Error(errors.join('\n'));
    if (candidate.startDateStr || candidate.startDate) {
      const time = WRFDateTime.getTimeline(candidate);
      candidate.startDate = time.start; candidate.endDate = time.end; candidate.intervalSeconds = time.interval;
    }
    return candidate;
  }

  function dataKey(state) {
    const time = WRFDateTime.getTimeline(state);
    const { south, north, west, east } = state.domains[0].bounds;
    const box = WRFUtils.bufferedBBox(south, north, west, east, 5);
    const area = [box.south, box.north, box.west, box.east].map(v => v.toFixed(2).replace('-', 'm').replace('.', 'p')).join('_');
    const stamp = date => date.toISOString().slice(0, 13).replace(/[-T:]/g, '');
    return state.dataSource === 'GFS' ? `gfs_${stamp(time.cycle)}_${area}`
      : `era5_${stamp(time.start)}_${stamp(time.dataEnd)}_${time.interval}_${area}`;
  }

  return { SCHEMA_VERSION, validate, prepare, importState, dataKey };
})();
