/**
 * WRFlow — Domain Configuration & Grid Math
 * Domain boundaries and nesting are calculated in the WPS projection plane.
 */
const WRFDomain = (() => {
  const DOMAIN_COLORS = ['#4f46e5', '#059669', '#d97706', '#dc2626'];

  function gridPoints(length, spacing, ratio = 3, minimum = 100) {
    const cells = Math.ceil(length / spacing / ratio - 1e-9) * ratio;
    return Math.max(Math.ceil((minimum - 1) / ratio) * ratio, cells) + 1;
  }

  function calcProjectionParams(proj, refLat, refLon, bounds) {
    const hemi = refLat < 0 ? -1 : 1;
    const parallel = lat => Math.round(WRFUtils.clamp(Math.abs(lat), 1, 89) * 100) / 100;
    const params = { truelat1: refLat, truelat2: 0, stand_lon: refLon };
    if (proj === 'lambert') {
      const span = bounds ? bounds.north - bounds.south : 45;
      // Keep both standard parallels in the domain's hemisphere.
      const lower = Math.max(1, Math.abs(refLat) - span / 3);
      const upper = Math.abs(refLat) + span / 3;
      params.truelat1 = hemi * parallel(lower);
      params.truelat2 = hemi * parallel(upper);
    } else if (proj === 'polar') {
      params.truelat1 = hemi * 90;
    } else if (proj === 'mercator') {
      params.truelat1 = Math.round(WRFUtils.clamp(refLat, -89, 89) * 100) / 100;
    } else if (proj === 'lat-lon') {
      params.truelat1 = 0;
      params.stand_lon = 0;
    }
    return params;
  }

  // Sample the whole selection, not just its corners: projected edge extrema
  // can occur between corners (particularly Lambert and Polar domains).
  function projectBounds(bounds, projection) {
    const points = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const lat = bounds.south + (bounds.north - bounds.south) * t;
      const lon = bounds.west + (bounds.east - bounds.west) * t;
      points.push(projection.forward(bounds.south, lon), projection.forward(bounds.north, lon),
        projection.forward(lat, bounds.west), projection.forward(lat, bounds.east));
    }
    return {
      xMin: Math.min(...points.map(p => p.x)), xMax: Math.max(...points.map(p => p.x)),
      yMin: Math.min(...points.map(p => p.y)), yMax: Math.max(...points.map(p => p.y))
    };
  }

  function calcGrid(bounds, dx, dy, config) {
    const refLat = Math.round((bounds.south + bounds.north) / 2 * 1e6) / 1e6;
    const refLon = Math.round(WRFProjection.normalizeLon((bounds.west + bounds.east) / 2) * 1e6) / 1e6;
    const projection = WRFProjection.create(config, refLon);
    const center = projection.forward(refLat, refLon);
    const rect = projectBounds(bounds, projection);
    const width = 2 * Math.max(center.x - rect.xMin, rect.xMax - center.x);
    const height = 2 * Math.max(center.y - rect.yMin, rect.yMax - center.y);
    return {
      e_we: gridPoints(width, dx), e_sn: gridPoints(height, dy),
      ref_lat: refLat, ref_lon: refLon
    };
  }

  function calcNest(parent, bounds, ratio) {
    return calcNestRect(parent, projectBounds(bounds, parent.projection), ratio);
  }

  function calcNestRect(parent, rect, ratio) {
    const iStart = Math.round((rect.xMin - parent.xMin) / parent.dx) + 1;
    const jStart = Math.round((rect.yMin - parent.yMin) / parent.dy) + 1;
    const cellsWE = Math.max(10, Math.round((rect.xMax - rect.xMin) / parent.dx));
    const cellsSN = Math.max(10, Math.round((rect.yMax - rect.yMin) / parent.dy));
    return {
      i_parent_start: iStart, j_parent_start: jStart,
      e_we: cellsWE * ratio + 1, e_sn: cellsSN * ratio + 1,
      dx: parent.dx / ratio, dy: parent.dy / ratio
    };
  }

  // ARW's exterior edges lie at .5 and e_we-.5 (likewise e_sn).
  // Their midpoint is e_we/2, the default WPS ref_x/ref_y. Nest edges align
  // with parent edges at i_parent_start-.5, giving this exact grid offset.
  function rectGeometry(projection, rect, dx, dy) {
    const { xMin, xMax, yMin, yMax } = rect;
    const center = projection.inverse((xMin + xMax) / 2, (yMin + yMax) / 2);
    const corners = [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]];
    const boundary = [];
    corners.forEach(([x, y], edge) => {
      const [nextX, nextY] = corners[(edge + 1) % 4];
      for (let i = 0; i < 64; i++) {
        const point = projection.inverse(x + (nextX - x) * i / 64, y + (nextY - y) * i / 64);
        // Keep the footprint on one world copy when crossing the date line.
        point.lon = WRFProjection.unwrapLon(point.lon, boundary.length ? boundary[boundary.length - 1][1] : center.lon);
        boundary.push([point.lat, point.lon]);
      }
    });
    const bounds = {
      south: Math.min(...boundary.map(p => p[0])), north: Math.max(...boundary.map(p => p[0])),
      west: Math.min(...boundary.map(p => p[1])), east: Math.max(...boundary.map(p => p[1]))
    };
    const enclosesPole = (projection.mapProj === 'polar' || projection.mapProj === 'lambert') &&
      xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0;
    if (enclosesPole) {
      if (projection.hemi > 0) bounds.north = 90;
      else bounds.south = -90;
      bounds.west = -180;
      bounds.east = 180;
      // Close a pole-enclosing ring along the top/bottom of the Mercator map.
      boundary.push([projection.hemi * 90, boundary[boundary.length - 1][1]],
        [projection.hemi * 90, boundary[0][1]]);
    }
    return { projection, ...rect, dx, dy, center, boundary, bounds };
  }

  function buildGeometries(domains, config) {
    const geometries = {};
    const root = domains.find(d => d.id === 1);
    if (!root || !root.bounds) return geometries;
    const projection = WRFProjection.create(config, root.ref_lon);
    const visiting = new Set();
    function build(dom) {
      if (geometries[dom.id]) return geometries[dom.id];
      if (!dom.bounds) return null;
      if (visiting.has(dom.id)) throw new Error('Domain nesting contains a circular parent reference.');
      visiting.add(dom.id);
      let xMin, yMin, dx = dom.dx, dy = dom.dy;
      if (dom.id === 1) {
        const center = projection.forward(dom.ref_lat, dom.ref_lon);
        xMin = center.x - (dom.e_we - 1) * dx / 2;
        yMin = center.y - (dom.e_sn - 1) * dy / 2;
      } else {
        if (!Number.isInteger(dom.parent_grid_ratio) || dom.parent_grid_ratio < 1) {
          throw new Error('Nest grid ratios must be positive integers.');
        }
        const parentDomain = domains.find(d => d.id === dom.parent_id);
        const parent = parentDomain && build(parentDomain);
        if (!parent) throw new Error('Draw the nest’s parent domain first.');
        dx = parent.dx / dom.parent_grid_ratio;
        dy = parent.dy / dom.parent_grid_ratio;
        xMin = parent.xMin + (dom.i_parent_start - 1) * parent.dx;
        yMin = parent.yMin + (dom.j_parent_start - 1) * parent.dy;
      }
      if (!(dx > 0 && dy > 0 && dom.e_we >= 10 && dom.e_sn >= 10)) {
        throw new Error('Grid spacing must be positive and dimensions must be at least 10.');
      }
      const geometry = rectGeometry(projection, {
        xMin, yMin, xMax: xMin + (dom.e_we - 1) * dx, yMax: yMin + (dom.e_sn - 1) * dy
      }, dx, dy);
      geometries[dom.id] = geometry;
      visiting.delete(dom.id);
      return geometry;
    }
    domains.forEach(build);
    return geometries;
  }

  function validateNest(parentDomain, nest) {
    const errors = [];
    const ratio = nest.parent_grid_ratio;
    const west = nest.i_parent_start - 1;
    const south = nest.j_parent_start - 1;
    const east = parentDomain.e_we - 1 - west - (nest.e_we - 1) / ratio;
    const north = parentDomain.e_sn - 1 - south - (nest.e_sn - 1) / ratio;
    if (Math.min(west, east, south, north) < 0) {
      errors.push('Nest domain must be entirely within parent domain.');
    } else {
      if (Math.min(west, east) < 10) errors.push('Keep at least 10 parent grid cells from the east/west boundary.');
      if (Math.min(south, north) < 10) errors.push('Keep at least 10 parent grid cells from the north/south boundary.');
    }
    if ((nest.e_we - 1) % ratio !== 0 || (nest.e_sn - 1) % ratio !== 0) {
      errors.push('Nest dimensions minus one must be divisible by the parent grid ratio.');
    }
    return errors;
  }

  function getColor(domainIndex) {
    return DOMAIN_COLORS[domainIndex % DOMAIN_COLORS.length];
  }

  function renumberDomains(domains) {
    const ordered = [], pending = [...domains], seen = new Set();
    if (new Set(domains.map(d => d.id)).size !== domains.length) throw new Error('Domain IDs must be unique.');
    while (pending.length) {
      const index = pending.findIndex(d => d.id === 1 || seen.has(d.parent_id));
      if (index < 0) throw new Error('Domain parents are missing or circular.');
      const [dom] = pending.splice(index, 1);
      ordered.push(dom);
      seen.add(dom.id);
    }
    if (ordered[0]?.id !== 1) throw new Error('The parent domain d01 is required.');
    const ids = new Map(ordered.map((d, i) => [d.id, i + 1]));
    return { ids, domains: ordered.map(d => ({ ...d, id: ids.get(d.id), parent_id: ids.get(d.parent_id) })) };
  }

  // Resize in grid space, anchoring the opposite corner. Retaining this grid
  // lattice lets children keep their geographic footprints exactly, including
  // Mercator/Lat-Lon where changing ref_lon changes the coordinate origin.
  function resizeDomains(domains, config, domainId, rect, handle = 'ne', dimensions = {}) {
    const result = domains.map(d => ({ ...d }));
    const before = buildGeometries(domains, config);
    const dom = result.find(d => d.id === domainId);
    const old = before[domainId];
    if (!dom || !old) throw new Error('Draw the domain before resizing it.');
    const ratio = domainId === 1 ? 3 : dom.parent_grid_ratio;
    dom.e_we = dimensions.e_we ?? gridPoints(rect.xMax - rect.xMin, old.dx, ratio, 10);
    dom.e_sn = dimensions.e_sn ?? gridPoints(rect.yMax - rect.yMin, old.dy, ratio, 10);
    const width = (dom.e_we - 1) * old.dx, height = (dom.e_sn - 1) * old.dy;
    const xMin = handle.includes('w') ? old.xMax - width : old.xMin;
    const yMin = handle.includes('s') ? old.yMax - height : old.yMin;
    if (domainId === 1) {
      const center = old.projection.inverse(xMin + width / 2, yMin + height / 2);
      dom.ref_lat = center.lat;
      dom.ref_lon = WRFProjection.normalizeLon(center.lon);
    } else {
      const parent = before[dom.parent_id];
      dom.i_parent_start = Math.round((xMin - parent.xMin) / parent.dx) + 1;
      dom.j_parent_start = Math.round((yMin - parent.yMin) / parent.dy) + 1;
    }
    const descendants = new Set([domainId]);
    let grew = true;
    while (grew) {
      grew = false;
      result.forEach(d => {
        if (d.id !== domainId && descendants.has(d.parent_id) && !descendants.has(d.id)) {
          descendants.add(d.id); grew = true;
        }
      });
    }
    let after = buildGeometries(result.filter(d => d.id === domainId || !descendants.has(d.id)), config);
    result.filter(d => d.id !== domainId && d.parent_id === domainId && d.bounds).forEach(child => {
      const [lat, lon] = before[child.id].boundary[0];
      const parent = after[domainId];
      const position = parent.projection.forward(lat, lon);
      child.i_parent_start = Math.round((position.x - parent.xMin) / parent.dx) + 1;
      child.j_parent_start = Math.round((position.y - parent.yMin) / parent.dy) + 1;
    });
    after = buildGeometries(result, config);
    for (const child of result.filter(d => d.id > 1 && d.bounds)) {
      const errors = validateNest(result.find(d => d.id === child.parent_id), child);
      if (errors.length) throw new Error(`Resize cannot fit d${WRFUtils.pad(child.id, 2)}: ${errors[0]}`);
    }
    return result;
  }

  return { calcGrid, calcProjectionParams, calcNest, calcNestRect, projectBounds,
    buildGeometries, rectGeometry, gridPoints, validateNest, resizeDomains, renumberDomains, getColor, DOMAIN_COLORS };
})();
