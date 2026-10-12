const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ console });
for (const file of ['utils', 'projection', 'domain', 'namelist-wps']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${file}.js`), 'utf8'), context);
}
const { WRFProjection: Projection, WRFDomain: Domain, WRFUtils: Utils, WRFNamelistWPS: WPS } =
  vm.runInContext('({ WRFProjection, WRFDomain, WRFUtils, WRFNamelistWPS })', context);

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

const lambert = { mapProj: 'lambert', truelat1: 30, truelat2: 60, standLon: 35 };
function root(extra = {}) {
  return { id: 1, parent_id: 1, parent_grid_ratio: 1, i_parent_start: 1, j_parent_start: 1,
    ref_lat: 39, ref_lon: 35, dx: 9000, dy: 9000, e_we: 121, e_sn: 151, bounds: {}, ...extra };
}

// Independent reference coordinates from PROJ 9.8 (pyproj), using R=6370000.
// LCC lat_0 is the appropriate pole; Mercator/EQC lon_0 is the reference longitude.
const fixtures = [
  { config: lambert, refLon: 35, lat: 42, lon: 40, x: 399465.21973354346, y: -6388757.190531662 },
  { config: { mapProj: 'lambert', truelat1: -30, truelat2: -60, standLon: 135 },
    refLon: 135, lat: -38, lon: 142, x: 596583.7496697524, y: 6806712.6660333155 },
  { config: { mapProj: 'polar', truelat1: 60, standLon: 0 },
    refLon: 0, lat: 75, lon: 20, x: 535226.7014065713, y: -1470523.2764037366 },
  { config: { mapProj: 'polar', truelat1: -60, standLon: 0 },
    refLon: 0, lat: -75, lon: 20, x: 535226.7014065713, y: 1470523.2764037366 },
  { config: { mapProj: 'mercator', truelat1: 30, standLon: 0 },
    refLon: 35, lat: 42, lon: 40, x: 481412.58125716535, y: 4463837.227910323 },
  { config: { mapProj: 'lat-lon' }, refLon: 179, lat: 10, lon: 181,
    x: 222354.94670407788, y: 1111774.733520388 }
];

fixtures.forEach(({ config, refLon, lat, lon, x, y }) => {
  test(`${config.mapProj} ${lat < 0 ? 'south' : 'north'} agrees with independent PROJ coordinates`, () => {
    const projection = Projection.create(config, refLon);
    const point = projection.forward(lat, lon);
    close(point.x, x);
    close(point.y, y);
    const inverse = projection.inverse(x, y);
    close(inverse.lat, lat, 1e-9);
    close(inverse.lon, lon, 1e-9);
  });
});

test('Lambert footprint follows WPS ARW exterior edges and includes edge extrema', () => {
  const geometry = Domain.buildGeometries([root()], lambert)[1];
  close(geometry.xMax - geometry.xMin, 120 * 9000);
  close(geometry.yMax - geometry.yMin, 150 * 9000);
  close(geometry.center.lat, 39);
  close(geometry.center.lon, 35);
  const northwest = geometry.projection.inverse(geometry.xMin, geometry.yMax);
  close(northwest.lon, 27.871668450061833, 1e-9);
  close(northwest.lat, 45.04850585928276, 1e-9);
  close(geometry.bounds.north, 45.27253880314084, 1e-9);
  assert.ok(geometry.bounds.north > northwest.lat, 'Lambert north edge must be curved');
  for (const [lat, lon] of geometry.boundary) {
    const p = geometry.projection.forward(lat, lon);
    const edgeDistance = Math.min(Math.abs(p.x - geometry.xMin), Math.abs(p.x - geometry.xMax),
      Math.abs(p.y - geometry.yMin), Math.abs(p.y - geometry.yMax));
    assert.ok(edgeDistance < 1e-6, 'Every outline point must lie on a projected grid edge');
  }
});

test('changing standard longitude tilts the outline while preserving the reference center', () => {
  const straight = Domain.buildGeometries([root()], lambert)[1];
  const tilted = Domain.buildGeometries([root()], { ...lambert, standLon: 10 })[1];
  close(tilted.center.lat, 39);
  close(tilted.center.lon, 35);
  assert.ok(Math.abs(tilted.boundary[0][0] - straight.boundary[0][0]) > 1);
  assert.ok(Math.abs(tilted.boundary[0][0] - tilted.boundary[64][0]) > 1);
});

test('rectangle selection size depends on the chosen projection and covers the selection', () => {
  const bounds = { south: 20, north: 55, west: 0, east: 65 };
  const configs = [lambert, { mapProj: 'mercator', truelat1: 30 },
    { mapProj: 'polar', truelat1: 90, standLon: 35 }, { mapProj: 'lat-lon' }];
  const sizes = new Set();
  for (const config of configs) {
    const grid = Domain.calcGrid(bounds, 9000, 9000, config);
    sizes.add(`${grid.e_we}x${grid.e_sn}`);
    assert.equal((grid.e_we - 1) % 3, 0);
    const geometry = Domain.buildGeometries([root({ ...grid, bounds })], config)[1];
    const selection = Domain.projectBounds(bounds, geometry.projection);
    assert.ok(selection.xMin >= geometry.xMin - 1e-6 && selection.xMax <= geometry.xMax + 1e-6);
    assert.ok(selection.yMin >= geometry.yMin - 1e-6 && selection.yMax <= geometry.yMax + 1e-6);
  }
  assert.equal(sizes.size, 4);
});

test('nested and multiply nested grids align with parent cells exactly', () => {
  const domains = [root(), { id: 2, parent_id: 1, parent_grid_ratio: 3,
    i_parent_start: 21, j_parent_start: 31, e_we: 91, e_sn: 121, bounds: {} },
  { id: 3, parent_id: 2, parent_grid_ratio: 5,
    i_parent_start: 11, j_parent_start: 16, e_we: 76, e_sn: 101, bounds: {} }];
  const geometry = Domain.buildGeometries(domains, { ...lambert, standLon: 10 });
  close(geometry[2].xMin, geometry[1].xMin + 20 * 9000);
  close(geometry[2].yMin, geometry[1].yMin + 30 * 9000);
  close(geometry[2].dx, 3000);
  close(geometry[3].xMin, geometry[2].xMin + 10 * 3000);
  close(geometry[3].yMin, geometry[2].yMin + 15 * 3000);
  close(geometry[3].dx, 600);
  const snapped = Domain.calcNestRect(geometry[1], geometry[2], 3);
  assert.equal(snapped.i_parent_start, 21);
  assert.equal(snapped.j_parent_start, 31);
  assert.equal(snapped.e_we, 91);
  assert.equal(snapped.e_sn, 121);
  assert.equal(Domain.validateNest(domains[0], domains[1]).length, 0);
});

test('nest validation measures buffers in each parent-grid axis without clamping outside nests', () => {
  const parent = root({ e_sn: 1001 });
  const nest = { i_parent_start: 11, j_parent_start: 11, parent_grid_ratio: 3, e_we: 31, e_sn: 31 };
  assert.equal(Domain.validateNest(parent, nest).length, 0);
  assert.match(Domain.validateNest(parent, { ...nest, i_parent_start: 10 })[0], /east\/west/);
  const geometry = Domain.buildGeometries([parent], lambert)[1];
  const outside = Domain.calcNestRect(geometry, { xMin: geometry.xMin - 90000,
    xMax: geometry.xMin + 90000, yMin: geometry.yMin + 90000, yMax: geometry.yMin + 180000 }, 3);
  assert.ok(outside.i_parent_start < 1);
  assert.match(Domain.validateNest(parent, { ...outside, parent_grid_ratio: 3 })[0], /entirely within/);
});

test('date-line crossing stays continuous on the map and download bounds cover both sides', () => {
  const geometry = Domain.buildGeometries([root({ ref_lat: 10, ref_lon: 179 })],
    { mapProj: 'mercator', truelat1: 10 })[1];
  assert.ok(geometry.bounds.east > 180);
  assert.ok(geometry.bounds.east - geometry.bounds.west < 20);
  for (let i = 1; i < geometry.boundary.length; i++) {
    assert.ok(Math.abs(geometry.boundary[i][1] - geometry.boundary[i - 1][1]) < 1);
  }
  const { south, north, west, east } = geometry.bounds;
  const bbox = Utils.bufferedBBox(south, north, west, east, 5);
  assert.equal(bbox.west, -180);
  assert.equal(bbox.east, 180);
});

test('pole-enclosing domains include the pole in their data bounding box', () => {
  const geometry = Domain.buildGeometries([root({ ref_lat: 89, ref_lon: 0 })],
    { mapProj: 'polar', truelat1: 90, standLon: 0 })[1];
  assert.equal(geometry.bounds.north, 90);
  assert.equal(geometry.bounds.west, -180);
  assert.equal(geometry.bounds.east, 180);
});

test('Lat-Lon WPS spacing is angular while projected WPS spacing stays in meters', () => {
  const state = { domains: [root({ dy: 18000 })], startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-01-02T00:00:00Z'), intervalSeconds: 10800, ...lambert };
  const projected = WPS.generate(state);
  assert.match(projected, /dx\s*= 9000,/);
  state.mapProj = 'lat-lon';
  const latlon = WPS.generate(state);
  close(Number(latlon.match(/\bdx\s*= ([\d.]+)/)[1]), 9000 / Projection.METERS_PER_DEGREE, 1e-12);
  close(Number(latlon.match(/\bdy\s*= ([\d.]+)/)[1]), 18000 / Projection.METERS_PER_DEGREE, 1e-12);
  assert.equal(state.domains[0].dx, 9000, 'Application spacing must remain in meters');
});

test('defaults are valid in the southern hemisphere and invalid singular parameters are rejected', () => {
  const params = Domain.calcProjectionParams('lambert', -5, 135);
  assert.ok(params.truelat1 < 0 && params.truelat2 < 0);
  assert.doesNotThrow(() => Projection.create({ mapProj: 'lambert', truelat1: params.truelat1,
    truelat2: params.truelat2, standLon: params.stand_lon }, 135).forward(-5, 135));
  assert.throws(() => Projection.create({ ...lambert, truelat2: -30 }, 35), /same hemisphere/);
  assert.throws(() => Projection.create({ mapProj: 'mercator', truelat1: 90 }, 35), /Mercator/);
  assert.throws(() => Domain.buildGeometries([root({ dx: 0 })], lambert), /spacing/);
  // Tangent Lambert must be invertible too.
  const projection = Projection.create({ ...lambert, truelat2: 30 }, 35);
  const point = projection.forward(39, 35);
  close(projection.inverse(point.x, point.y).lat, 39, 1e-9);
});
