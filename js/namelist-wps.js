/**
 * WRFlow — namelist.wps Generator
 * Builds the complete namelist.wps file from wizard state.
 */
const WRFNamelistWPS = (() => {

  function generate(state) {
    const d = state.domains;
    const n = d.length;
    const K = WRFUtils.nlKey;
    const J = WRFUtils.nlJoin;

    const startDates = d.map(() => `'${WRFUtils.toWRFDate(state.startDate)}'`);
    const endDates = d.map(() => `'${WRFUtils.toWRFDate(state.endDate)}'`);

    let out = '';

    // &share
    out += '&share\n';
    out += K('wrf_core') + "= 'ARW',\n";
    out += K('max_dom') + `= ${n},\n`;
    out += K('start_date') + `= ${J(startDates)},\n`;
    out += K('end_date') + `= ${J(endDates)},\n`;
    out += K('interval_seconds') + `= ${state.intervalSeconds},\n`;
    out += K('io_form_geogrid') + '= 2,\n';
    out += '/\n\n';

    // &geogrid
    out += '&geogrid\n';
    out += K('parent_id') + `= ${J(d.map(dom => dom.parent_id))},\n`;
    out += K('parent_grid_ratio') + `= ${J(d.map(dom => dom.parent_grid_ratio))},\n`;
    out += K('i_parent_start') + `= ${J(d.map(dom => dom.i_parent_start))},\n`;
    out += K('j_parent_start') + `= ${J(d.map(dom => dom.j_parent_start))},\n`;
    out += K('e_we') + `= ${J(d.map(dom => dom.e_we))},\n`;
    out += K('e_sn') + `= ${J(d.map(dom => dom.e_sn))},\n`;
    out += K('geog_data_res') + `= ${J(d.map(() => "'default'"))},\n`;
    out += K('dx') + `= ${d[0].dx},\n`;
    out += K('dy') + `= ${d[0].dy},\n`;
    out += K('map_proj') + `= '${state.mapProj}',\n`;
    out += K('ref_lat') + `= ${d[0].ref_lat},\n`;
    out += K('ref_lon') + `= ${d[0].ref_lon},\n`;
    out += K('truelat1') + `= ${state.truelat1},\n`;
    out += K('truelat2') + `= ${state.truelat2},\n`;
    out += K('stand_lon') + `= ${state.standLon},\n`;
    out += K('geog_data_path') + `= '${state.geogDataPath || '/path/to/WPS_GEOG/'}',\n`;
    out += '/\n\n';

    // &ungrib
    out += '&ungrib\n';
    out += K('out_format') + "= 'WPS',\n";
    out += K('prefix') + "= 'FILE',\n";
    out += '/\n\n';

    // &metgrid
    out += '&metgrid\n';
    out += K('fg_name') + "= 'FILE',\n";
    out += K('io_form_metgrid') + '= 2,\n';
    out += '/\n';

    return out;
  }

  return { generate };
})();
