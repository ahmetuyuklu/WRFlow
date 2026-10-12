/**
 * WRFlow — Spherical WPS projections
 * Matches WPS geogrid's map_utils conventions (Earth radius = 6,370 km).
 * Projected coordinates are meters; Lat-Lon uses meters per degree at the equator.
 */
const WRFProjection = (() => {
  const EARTH_RADIUS = 6370000;
  const RAD = Math.PI / 180;
  const METERS_PER_DEGREE = EARTH_RADIUS * RAD;

  function normalizeLon(lon) {
    return ((lon + 180) % 360 + 360) % 360 - 180;
  }

  function unwrapLon(lon, reference) {
    return reference + normalizeLon(lon - reference);
  }

  function create(config, refLon) {
    const { mapProj, truelat1, truelat2, standLon } = config;
    const hemi = truelat1 < 0 ? -1 : 1;
    let forward, inverse;

    if (!Number.isFinite(refLon)) throw new Error('Enter a valid reference longitude.');

    if (mapProj === 'lat-lon') {
      forward = (lat, lon) => ({
        x: (unwrapLon(lon, refLon) - refLon) * METERS_PER_DEGREE,
        y: lat * METERS_PER_DEGREE
      });
      inverse = (x, y) => ({ lat: y / METERS_PER_DEGREE, lon: refLon + x / METERS_PER_DEGREE });
    } else if (mapProj === 'mercator') {
      if (!Number.isFinite(truelat1) || Math.abs(truelat1) >= 90) {
        throw new Error('Mercator truelat1 must be between -90° and 90°.');
      }
      const scale = EARTH_RADIUS * Math.cos(truelat1 * RAD);
      forward = (lat, lon) => ({
        x: (unwrapLon(lon, refLon) - refLon) * RAD * scale,
        y: scale * Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2))
      });
      inverse = (x, y) => ({
        lat: (2 * Math.atan(Math.exp(y / scale)) - Math.PI / 2) / RAD,
        lon: refLon + x / scale / RAD
      });
    } else if (mapProj === 'lambert' || mapProj === 'polar') {
      if (!Number.isFinite(standLon) || !Number.isFinite(truelat1)) {
        throw new Error('Enter valid true latitude and standard longitude values.');
      }
      let cone = 1;
      let scale;
      if (mapProj === 'lambert') {
        if (!Number.isFinite(truelat2) || truelat1 * truelat2 <= 0 ||
            Math.abs(truelat1) >= 90 || Math.abs(truelat2) >= 90) {
          throw new Error('Lambert true latitudes must be nonzero, below 90°, and in the same hemisphere.');
        }
        const t1 = Math.abs(truelat1) * RAD;
        const t2 = Math.abs(truelat2) * RAD;
        // WPS uses the tangent case when the parallels differ by <= 0.1°.
        cone = Math.abs(truelat1 - truelat2) > 0.1
          ? Math.log(Math.cos(t1) / Math.cos(t2)) /
            Math.log(Math.tan(Math.PI / 4 - t1 / 2) / Math.tan(Math.PI / 4 - t2 / 2))
          : Math.sin(t1);
        scale = EARTH_RADIUS * Math.cos(t1) / cone /
          Math.tan(Math.PI / 4 - t1 / 2) ** cone;
      } else {
        if (truelat1 === 0 || Math.abs(truelat1) > 90) {
          throw new Error('Polar truelat1 must be nonzero and between -90° and 90°.');
        }
        scale = EARTH_RADIUS * (1 + Math.sin(Math.abs(truelat1) * RAD));
      }
      forward = (lat, lon) => {
        const radius = scale * Math.tan(Math.PI / 4 - hemi * lat * RAD / 2) ** cone;
        const angle = cone * normalizeLon(lon - standLon) * RAD;
        return { x: radius * Math.sin(angle), y: -hemi * radius * Math.cos(angle) };
      };
      inverse = (x, y) => {
        const radius = Math.hypot(x, y);
        return {
          lat: hemi * (Math.PI / 2 - 2 * Math.atan((radius / scale) ** (1 / cone))) / RAD,
          lon: unwrapLon(standLon + Math.atan2(x, -hemi * y) / cone / RAD, refLon)
        };
      };
    } else {
      throw new Error('Unknown map projection.');
    }

    return {
      mapProj,
      hemi,
      forward(lat, lon) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 ||
            (mapProj === 'mercator' && Math.abs(lat) === 90)) {
          throw new Error('Coordinates are outside the selected projection.');
        }
        const point = forward(lat, lon);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
          throw new Error('Coordinates are outside the selected projection.');
        }
        return point;
      },
      inverse(x, y) {
        const point = inverse(x, y);
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 90) {
          throw new Error('The domain extends outside the selected projection.');
        }
        return point;
      }
    };
  }

  return { create, normalizeLon, unwrapLon, EARTH_RADIUS, METERS_PER_DEGREE };
})();
