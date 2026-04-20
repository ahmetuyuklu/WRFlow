/**
 * WRFlow — namelist.input Generator
 * Builds the complete namelist.input file from wizard state.
 */
const WRFNamelistInput = (() => {

  function generate(state) {
    const d = state.domains;
    const n = d.length;
    const K = WRFUtils.nlKey;
    const J = WRFUtils.nlJoin;
    const R = WRFUtils.repeatVal;
    const dur = WRFDateTime.splitDuration(state.durationHours);
    const dc = WRFDateTime.getDateComponents(
      state.startDateStr, state.startHour, state.durationHours, n
    );

    // Time step: ~6 * dx(km) seconds, rounded to integer
    const timeStep = Math.max(1, Math.round(6 * d[0].dx / 1000));
    const historyInterval = state.historyInterval
      ? d.map(() => state.historyInterval)
      : d.map(dom => {
          const dxKm = dom.dx / 1000;
          return dxKm >= 9 ? 180 : dxKm >= 3 ? 60 : 15;
        });

    const eVert = state.eVert || 45;
    const pTop = state.pTop || 5000;
    // num_metgrid_levels must match met_em vertical dimension.
    // GFS 0.25° full column = 34 levels; ERA5 = 38.
    const numMetgridLevels = state.dataSource === 'ERA5' ? 38 : 34;
    const numSoilLayers = WRFPhysics.getSoilLayers(state.physics.sf_surface_physics);
    const feedback = state.feedback !== undefined ? state.feedback : 1;
    const wDamping = state.wDamping !== undefined ? state.wDamping : 1;
    const dampOpt = state.dampOpt !== undefined ? state.dampOpt : 3;
    const dampCoef = state.dampCoef !== undefined ? state.dampCoef.toFixed(2) : '0.20';
    const diffOpt = state.diffOpt !== undefined ? state.diffOpt : 1;
    const restartInterval = state.restartInterval || 1440;

    let out = '';

    // &time_control
    out += '&time_control\n';
    out += K('run_days') + `= ${dur.run_days},\n`;
    out += K('run_hours') + `= ${dur.run_hours},\n`;
    out += K('run_minutes') + '= 0,\n';
    out += K('run_seconds') + '= 0,\n';
    out += K('start_year') + `= ${J(dc.start_year)},\n`;
    out += K('start_month') + `= ${J(dc.start_month.map(v => WRFUtils.pad(v, 2)))},\n`;
    out += K('start_day') + `= ${J(dc.start_day.map(v => WRFUtils.pad(v, 2)))},\n`;
    out += K('start_hour') + `= ${J(dc.start_hour.map(v => WRFUtils.pad(v, 2)))},\n`;
    out += K('start_minute') + `= ${R('00', n)},\n`;
    out += K('start_second') + `= ${R('00', n)},\n`;
    out += K('end_year') + `= ${J(dc.end_year)},\n`;
    out += K('end_month') + `= ${J(dc.end_month.map(v => WRFUtils.pad(v, 2)))},\n`;
    out += K('end_day') + `= ${J(dc.end_day.map(v => WRFUtils.pad(v, 2)))},\n`;
    out += K('end_hour') + `= ${J(dc.end_hour.map(v => WRFUtils.pad(v, 2)))},\n`;
    out += K('end_minute') + `= ${R('00', n)},\n`;
    out += K('end_second') + `= ${R('00', n)},\n`;
    out += K('interval_seconds') + `= ${state.intervalSeconds},\n`;
    out += K('input_from_file') + `= ${R('.true.', n)},\n`;
    out += K('history_interval') + `= ${J(historyInterval)},\n`;
    out += K('frames_per_outfile') + `= ${R(1000, n)},\n`;
    out += K('restart') + '= .false.,\n';
    out += K('restart_interval') + `= ${restartInterval},\n`;
    out += K('io_form_history') + '= 2,\n';
    out += K('io_form_restart') + '= 2,\n';
    out += K('io_form_input') + '= 2,\n';
    out += K('io_form_boundary') + '= 2,\n';
    out += '/\n\n';

    // &domains
    out += '&domains\n';
    out += K('time_step') + `= ${timeStep},\n`;
    out += K('max_dom') + `= ${n},\n`;
    out += K('e_we') + `= ${J(d.map(dom => dom.e_we))},\n`;
    out += K('e_sn') + `= ${J(d.map(dom => dom.e_sn))},\n`;
    out += K('e_vert') + `= ${R(eVert, n)},\n`;
    out += K('p_top_requested') + `= ${pTop},\n`;
    out += K('num_metgrid_levels') + `= ${numMetgridLevels},\n`;
    out += K('dx') + `= ${J(d.map(dom => dom.dx.toFixed(1)))},\n`;
    out += K('dy') + `= ${J(d.map(dom => dom.dy.toFixed(1)))},\n`;
    out += K('grid_id') + `= ${J(d.map((_, i) => i + 1))},\n`;
    out += K('parent_id') + `= ${J(d.map(dom => dom.parent_id))},\n`;
    out += K('i_parent_start') + `= ${J(d.map(dom => dom.i_parent_start))},\n`;
    out += K('j_parent_start') + `= ${J(d.map(dom => dom.j_parent_start))},\n`;
    out += K('parent_grid_ratio') + `= ${J(d.map(dom => dom.parent_grid_ratio))},\n`;
    out += K('parent_time_step_ratio') + `= ${J(d.map(dom => dom.parent_grid_ratio))},\n`;
    out += K('feedback') + `= ${feedback},\n`;
    out += K('smooth_option') + '= 0,\n';
    out += '/\n\n';

    // &physics
    const ph = state.physics;
    const radtMin = Math.max(1, Math.round(d[0].dx / 1000));
    out += '&physics\n';
    out += K('mp_physics') + `= ${R(ph.mp_physics, n)},\n`;
    out += K('ra_lw_physics') + `= ${R(ph.ra_lw_physics, n)},\n`;
    out += K('ra_sw_physics') + `= ${R(ph.ra_sw_physics, n)},\n`;
    out += K('radt') + `= ${R(radtMin, n)},\n`;
    out += K('sf_sfclay_physics') + `= ${R(ph.sf_sfclay_physics, n)},\n`;
    out += K('sf_surface_physics') + `= ${R(ph.sf_surface_physics, n)},\n`;
    out += K('bl_pbl_physics') + `= ${R(ph.bl_pbl_physics, n)},\n`;
    out += K('bldt') + `= ${R(0, n)},\n`;
    out += K('cu_physics') + `= ${J(d.map(dom => {
      // Disable cumulus for fine-resolution domains
      return (dom.dx / 1000 < 4) ? 0 : ph.cu_physics;
    }))},\n`;
    out += K('cudt') + `= ${R(0, n)},\n`;
    out += K('isfflx') + '= 1,\n';
    out += K('ifsnow') + '= 1,\n';
    out += K('icloud') + '= 1,\n';
    out += K('surface_input_source') + '= 3,\n';
    out += K('num_land_cat') + '= 21,\n';
    out += K('num_soil_layers') + `= ${numSoilLayers},\n`;
    out += K('sf_urban_physics') + `= ${R(0, n)},\n`;
    out += '/\n\n';

    // &dynamics
    out += '&dynamics\n';
    out += K('w_damping') + `= ${wDamping},\n`;
    out += K('diff_opt') + `= ${R(diffOpt, n)},\n`;
    out += K('km_opt') + `= ${R(4, n)},\n`;
    out += K('diff_6th_opt') + `= ${R(0, n)},\n`;
    out += K('diff_6th_factor') + `= ${R('0.12', n)},\n`;
    out += K('base_temp') + '= 290.,\n';
    out += K('damp_opt') + `= ${dampOpt},\n`;
    out += K('zdamp') + `= ${R('5000.', n)},\n`;
    out += K('dampcoef') + `= ${R(dampCoef, n)},\n`;
    out += K('khdif') + `= ${R(0, n)},\n`;
    out += K('kvdif') + `= ${R(0, n)},\n`;
    out += K('non_hydrostatic') + `= ${R('.true.', n)},\n`;
    out += K('moist_adv_opt') + `= ${R(1, n)},\n`;
    out += K('scalar_adv_opt') + `= ${R(1, n)},\n`;
    out += '/\n\n';

    // &bdy_control
    out += '&bdy_control\n';
    out += K('spec_bdy_width') + '= 5,\n';
    out += K('spec_zone') + '= 1,\n';
    out += K('relax_zone') + '= 4,\n';

    const specifiedVals = ['.true.'].concat(new Array(Math.max(0, n - 1)).fill('.false.'));
    const nestedVals = ['.false.'].concat(new Array(Math.max(0, n - 1)).fill('.true.'));
    out += K('specified') + `= ${specifiedVals.join(', ')},\n`;
    out += K('nested') + `= ${nestedVals.join(', ')},\n`;
    out += '/\n\n';

    // &namelist_quilt
    out += '&namelist_quilt\n';
    out += K('nio_tasks_per_group') + '= 0,\n';
    out += K('nio_groups') + '= 1,\n';
    out += '/\n';

    return out;
  }

  return { generate };
})();
