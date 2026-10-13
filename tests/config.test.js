const assert = require('node:assert/strict');
const { test } = require('node:test');
const { WRFConfig: Config, WRFDateTime: Time, WRFPhysics: Physics, WRFDomain: Domain,
  WRFNamelistWPS: WPS, WRFNamelistInput: Input, WRFDownloadScripts: Download, WRFRunScript: Run, makeState, root } = require('./helpers');
const plain = value => JSON.parse(JSON.stringify(value));

test('nonzero GFS forecast offset shifts both namelists and downloads consistently', () => {
  const state = makeState({ startForecastHour: 24, durationHours: 25 });
  const time = Time.getTimeline(state);
  assert.equal(time.start.toISOString(), '2025-01-02T00:00:00.000Z');
  assert.equal(time.end.toISOString(), '2025-01-03T01:00:00.000Z');
  assert.equal(time.dataEnd.toISOString(), '2025-01-03T03:00:00.000Z');
  assert.match(WPS.generate(state), /start_date\s*= '2025-01-02_00:00:00'/);
  assert.match(WPS.generate(state), /end_date\s*= '2025-01-03_03:00:00'/);
  assert.match(Input.generate(state), /run_days\s*= 1,/);
  assert.match(Input.generate(state), /run_hours\s*= 1,/);
  assert.match(Input.generate(state), /end_hour\s*= 03,/);
  assert.match(Download.generate(state), /DATE="20250101"/);
  assert.match(Download.generate(state), /START_FH=24/);
  assert.match(Download.generate(state), /MAX_FH=51/);
});

test('effective boundary interval is shared and forecast coverage limits are enforced', () => {
  const state = makeState({ intervalSecondsOverride: 21600, durationHours: 25 });
  assert.match(WPS.generate(state), /interval_seconds\s*= 21600,/);
  assert.match(Input.generate(state), /interval_seconds\s*= 21600,/);
  assert.match(Download.generate(state), /INTERVAL=6/);
  assert.equal(Time.getTimeline(state).endForecastHour, 30);
  for (const extra of [{ intervalSecondsOverride: 3600 }, { startForecastHour: 1 },
    { startForecastHour: 381, durationHours: 4 }, { gfsInterval: 1, startForecastHour: 120, durationHours: 1 }]) {
    assert.throws(() => Config.prepare(makeState(extra)), /interval|aligned|coverage/i);
  }
});

test('ERA5 overnight, leap-day, month/year crossings request exact calendar times', () => {
  for (const [startDateStr, startHour, durationHours, expected] of [
    ['2025-01-01', 23, 2, ['2025-01-01', '2025-01-02']],
    ['2024-02-28', 23, 26, ['2024-02-28', '2024-02-29', '2024-03-01']],
    ['2025-12-31', 23, 2, ['2025-12-31', '2026-01-01']]
  ]) {
    const time = Time.getTimeline(makeState({ dataSource: 'ERA5', startDateStr, startHour, durationHours }));
    const requests = Time.era5Requests(time);
    assert.deepEqual(plain(requests.map(d => `${d.year}-${d.month}-${d.day}`)), expected);
    assert.deepEqual(plain(requests[0].time), ['23:00']);
    assert.deepEqual(plain(requests.at(-1).time), ['00:00', '01:00']);
  }
});

test('data caches distinguish cycles and selected areas', () => {
  const a = Config.prepare(makeState());
  const b = Config.prepare(makeState({ startDateStr: '2025-01-02' }));
  const c = Config.prepare(makeState({ domains: [root({ ref_lon: 25 })] }));
  assert.notEqual(Config.dataKey(a), Config.dataKey(b));
  assert.notEqual(Config.dataKey(a), Config.dataKey(c));
  assert.ok(Download.generate(a).includes(Config.dataKey(a)));
  assert.ok(Run.generate(a).includes(Config.dataKey(a)));
});

test('gapped IDs are serialized into consistent contiguous WPS/WRF parent references', () => {
  const domains = [root(), { id: 3, parent_id: 1, parent_grid_ratio: 3, i_parent_start: 101,
    j_parent_start: 101, e_we: 91, e_sn: 91, dx: 3000, dy: 3000, ref_lat: 39, ref_lon: 35, bounds: {} },
  { id: 4, parent_id: 3, parent_grid_ratio: 3, i_parent_start: 21, j_parent_start: 21,
    e_we: 31, e_sn: 31, dx: 1000, dy: 1000, ref_lat: 39, ref_lon: 35, bounds: {} }];
  const state = makeState({ domains });
  assert.match(WPS.generate(state), /parent_id\s*= 1, 1, 2,/);
  assert.match(Input.generate(state), /grid_id\s*= 1, 2, 3,/);
  assert.match(Input.generate(state), /parent_id\s*= 1, 1, 2,/);
  assert.deepEqual(plain(Domain.renumberDomains(domains).domains.map(d => d.id)), [1, 2, 3]);
});

test('every generator rejects undrawn/outside nests and incompatible physics', () => {
  const child = { id: 2, parent_id: 1, parent_grid_ratio: 3, i_parent_start: 1, j_parent_start: 1,
    e_we: 91, e_sn: 91, dx: 3000, dy: 3000, ref_lat: 39, ref_lon: 35, bounds: null };
  for (const state of [makeState({ domains: [root(), child] }),
    makeState({ domains: [root(), { ...child, i_parent_start: 300, bounds: {} }] }),
    makeState({ physics: { ...Physics.getDefaults(), bl_pbl_physics: 4 } })]) {
    for (const generator of [WPS, Input, Download, Run]) assert.throws(() => generator.generate(state), /Draw|within|incompatible/);
  }
});

test('physics options follow WRF 4.5+ registry and MYNN closure is explicit', () => {
  assert.equal(Physics.schemes.bl_pbl_physics.find(s => s.id === 4).name, 'QNSE');
  assert.equal(Physics.schemes.ra_lw_physics.find(s => s.id === 24).name, 'RRTMG Fast');
  const qnse = makeState({ physics: { ...Physics.getDefaults(), bl_pbl_physics: 4, sf_sfclay_physics: 4 } });
  assert.equal(Config.validate(qnse).length, 0);
  const mynn = makeState({ physics: { ...Physics.getDefaults(), bl_pbl_physics: 5 }, mynnClosure: 3 });
  assert.match(Input.generate(mynn), /bl_pbl_physics\s*= 5,/);
  assert.match(Input.generate(mynn), /bl_mynn_closure\s*= 3,/);
  assert.throws(() => Input.generate({ ...mynn, shcuPhysics: 5 }), /EDMF/);
});

test('SST updates include all auxiliary-input settings and metgrid defaults/overrides are correct', () => {
  const state = makeState({ sstUpdate: 1, intervalSecondsOverride: 21600 });
  const input = Input.generate(state);
  assert.match(input, /auxinput4_inname\s*= 'wrflowinp_d<domain>'/);
  assert.match(input, /auxinput4_interval\s*= 360,/);
  assert.match(input, /auxinput4_end_h\s*= 24,/);
  assert.match(input, /io_form_auxinput4\s*= 2,/);
  assert.match(input, /num_metgrid_levels\s*= 42,/);
  assert.match(Input.generate(makeState({ dataSource: 'ERA5' })), /num_metgrid_levels\s*= 38,/);
  assert.match(Input.generate(makeState({ numMetgridLevels: 44 })), /num_metgrid_levels\s*= 44,/);
});

test('import is schema-validated, migrates old MYNN selections, and does not mutate defaults', () => {
  const defaults = makeState(), before = JSON.stringify(defaults);
  const old = plain(defaults);
  delete old.schemaVersion;
  old.physics.bl_pbl_physics = 4;
  const migrated = Config.importState(old, defaults);
  assert.equal(migrated.physics.bl_pbl_physics, 5);
  assert.equal(migrated.mynnClosure, 2.5);
  assert.equal(migrated.schemaVersion, 2);
  assert.throws(() => Config.importState({ domains: [] }, defaults));
  assert.throws(() => Config.importState({ ...plain(defaults), domains: [{ ...root(), parent_id: 2 }] }, defaults));
  assert.equal(JSON.stringify(defaults), before);
});

test('eta-level counts/order and invalid dates are blocked', () => {
  assert.throws(() => Config.prepare(makeState({ etaLevels: '1, 0.5, 0' })), /Eta/);
  const levels = Array.from({ length: 45 }, (_, i) => (44 - i) / 44).join(', ');
  assert.doesNotThrow(() => Config.prepare(makeState({ etaLevels: levels })));
  assert.throws(() => Config.prepare(makeState({ startDateStr: '2025-02-30' })), /valid UTC/);
  assert.throws(() => Config.prepare(makeState({ startDateStr: '', startDate: new Date('2025-01-01T00:00Z') })), /Select a start date/);
  assert.throws(() => Config.prepare(makeState({ startForecastHour: NaN })), /forecast hour/);
  assert.throws(() => Config.prepare(makeState({ durationHours: 1.5 })), /whole number/);
  assert.throws(() => Input.generate(makeState({ dampCoef: NaN })), /Damping coefficient/);
});
