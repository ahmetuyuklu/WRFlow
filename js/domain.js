/**
 * WRFlow — Domain Configuration & Grid Math
 * Handles grid calculations, nesting validation, and projection logic.
 */
const WRFDomain = (() => {

  const DOMAIN_COLORS = ['#4f46e5', '#059669', '#d97706', '#dc2626'];

  // Calculate grid dimensions from map bounds and resolution
  function calcGrid(bounds, dx, dy) {
    const { south, north, west, east } = bounds;
    const centerLat = (south + north) / 2;
    const centerLon = (west + east) / 2;

    // Approximate domain size in meters
    const widthM = WRFUtils.haversineDistance(centerLat, west, centerLat, east);
    const heightM = WRFUtils.haversineDistance(south, centerLon, north, centerLon);

    // Grid points: ensure odd-compatible for nesting
    let eWe = Math.max(100, Math.floor(widthM / dx) + 1);
    let eSn = Math.max(100, Math.floor(heightM / dy) + 1);

    // Make (e_we - 1) divisible by common ratios (3, 5) for potential nesting
    // Round up to next value where (n-1) is divisible by 3
    while ((eWe - 1) % 3 !== 0) eWe++;
    while ((eSn - 1) % 3 !== 0) eSn++;

    return {
      e_we: eWe,
      e_sn: eSn,
      ref_lat: Math.round(centerLat * 100) / 100,
      ref_lon: Math.round(centerLon * 100) / 100,
      width_km: Math.round(widthM / 1000),
      height_km: Math.round(heightM / 1000)
    };
  }

  // Calculate truelat1, truelat2, stand_lon based on projection and domain center
  function calcProjectionParams(proj, refLat, refLon) {
    const params = { truelat1: refLat, truelat2: refLat, stand_lon: refLon };

    switch (proj) {
      case 'lambert':
        // Standard: truelats placed at ~1/6 from edges of domain, simplified as ±15° from center
        // Clamp between -90 and 90
        params.truelat1 = Math.round(WRFUtils.clamp(refLat - 15, -90, 90) * 100) / 100;
        params.truelat2 = Math.round(WRFUtils.clamp(refLat + 15, -90, 90) * 100) / 100;
        break;
      case 'mercator':
        params.truelat1 = Math.round(refLat * 100) / 100;
        params.truelat2 = 0;
        break;
      case 'polar':
        params.truelat1 = refLat >= 0 ? 90 : -90;
        params.truelat2 = 0;
        break;
      case 'lat-lon':
        params.truelat1 = 0;
        params.truelat2 = 0;
        params.stand_lon = 0;
        break;
    }
    return params;
  }

  // Calculate nest grid parameters from parent and nest bounds
  function calcNest(parentDomain, nestBounds, ratio) {
    const pBounds = parentDomain.bounds;
    const dx = parentDomain.dx / ratio;
    const dy = parentDomain.dy / ratio;

    // Position of nest lower-left corner in parent grid coordinates
    const parentWidthDeg = pBounds.east - pBounds.west;
    const parentHeightDeg = pBounds.north - pBounds.south;

    // i_parent_start, j_parent_start (1-indexed grid point in parent)
    const iStart = Math.max(1, Math.round(
      ((nestBounds.west - pBounds.west) / parentWidthDeg) * (parentDomain.e_we - 1)
    ) + 1);
    const jStart = Math.max(1, Math.round(
      ((nestBounds.south - pBounds.south) / parentHeightDeg) * (parentDomain.e_sn - 1)
    ) + 1);

    // Nest grid dimensions in parent cells
    const iEnd = Math.round(
      ((nestBounds.east - pBounds.west) / parentWidthDeg) * (parentDomain.e_we - 1)
    ) + 1;
    const jEnd = Math.round(
      ((nestBounds.north - pBounds.south) / parentHeightDeg) * (parentDomain.e_sn - 1)
    ) + 1;

    const parentCellsWE = iEnd - iStart;
    const parentCellsSN = jEnd - jStart;

    // Nest grid points: (parent_cells * ratio) + 1
    let eWe = parentCellsWE * ratio + 1;
    let eSn = parentCellsSN * ratio + 1;

    // Ensure minimum size and (n-1) divisible by ratio
    eWe = Math.max(ratio * 10 + 1, eWe);
    eSn = Math.max(ratio * 10 + 1, eSn);
    while ((eWe - 1) % ratio !== 0) eWe++;
    while ((eSn - 1) % ratio !== 0) eSn++;

    return {
      i_parent_start: iStart,
      j_parent_start: jStart,
      e_we: eWe,
      e_sn: eSn,
      dx: dx,
      dy: dy,
      ref_lat: Math.round(((nestBounds.south + nestBounds.north) / 2) * 100) / 100,
      ref_lon: Math.round(((nestBounds.west + nestBounds.east) / 2) * 100) / 100
    };
  }

  // Validate nesting: check containment and buffer zone
  function validateNest(parentDomain, nestBounds, ratio) {
    const errors = [];
    const pBounds = parentDomain.bounds;

    // 1. Nest must be inside parent
    if (nestBounds.west < pBounds.west || nestBounds.east > pBounds.east ||
        nestBounds.south < pBounds.south || nestBounds.north > pBounds.north) {
      errors.push('Nest domain must be entirely within parent domain.');
    }

    // 2. Buffer zone: nest should be at least ~10 parent grid points from parent boundary
    const parentWidthDeg = pBounds.east - pBounds.west;
    const parentHeightDeg = pBounds.north - pBounds.south;
    const minBufferFrac = 10 / Math.max(parentDomain.e_we, parentDomain.e_sn);

    const bufferW = (nestBounds.west - pBounds.west) / parentWidthDeg;
    const bufferE = (pBounds.east - nestBounds.east) / parentWidthDeg;
    const bufferS = (nestBounds.south - pBounds.south) / parentHeightDeg;
    const bufferN = (pBounds.north - nestBounds.north) / parentHeightDeg;

    if (bufferW < minBufferFrac || bufferE < minBufferFrac) {
      errors.push(`Nest is too close to parent east/west boundary. Keep ~10+ grid points buffer (NCAR recommends ~1/3 of domain).`);
    }
    if (bufferS < minBufferFrac || bufferN < minBufferFrac) {
      errors.push(`Nest is too close to parent north/south boundary. Keep ~10+ grid points buffer.`);
    }

    return errors;
  }

  function getColor(domainIndex) {
    return DOMAIN_COLORS[domainIndex % DOMAIN_COLORS.length];
  }

  function calcRotation(proj, standLon, refLon) {
    // Calculate the natural rotation of the domain based on projection
    // For most projections, rotation is minimal; for lat-lon it's 0
    if (proj === 'lat-lon') return 0;
    // For other projections, the standard rotation is based on how stand_lon differs from ref_lon
    const diff = ((standLon - refLon + 180) % 360) - 180;
    return Math.round(diff * 10) / 10; // Round to 0.1 degree
  }

  return { calcGrid, calcProjectionParams, calcNest, validateNest, getColor, calcRotation, DOMAIN_COLORS };
})();
