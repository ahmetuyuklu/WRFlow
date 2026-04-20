/**
 * WRFlow — Shared Utilities
 * Date formatting, coordinate math, clipboard/file helpers
 */
const WRFUtils = (() => {

  // Format a Date to WRF date string: 'YYYY-MM-DD_HH:MM:SS'
  function toWRFDate(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${y}-${m}-${d}_${h}:00:00`;
  }

  // Format date for display: 'YYYY-MM-DD HH:00Z'
  function toDisplayDate(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:00Z`;
  }

  // Format YYYYMMDD for GFS directory structure
  function toGFSDateDir(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  // Pad number with leading zeros
  function pad(n, width) {
    return String(n).padStart(width, '0');
  }

  // Clamp a value between min and max
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // Calculate buffered bounding box (±buffer degrees), clamped to valid ranges
  function bufferedBBox(south, north, west, east, bufferDeg) {
    return {
      south: clamp(south - bufferDeg, -90, 90),
      north: clamp(north + bufferDeg, -90, 90),
      west: clamp(west - bufferDeg, -180, 180),
      east: clamp(east + bufferDeg, -180, 180)
    };
  }

  // Convert longitude to 0-360 range for GFS
  function lonTo360(lon) {
    return ((lon % 360) + 360) % 360;
  }

  // Approximate distance in meters between two lat/lon points (Haversine)
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Copy text to clipboard, return Promise
  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }

  // Trigger file download with given filename and content
  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Repeat a value N times separated by commas (for namelist multi-domain columns)
  function repeatVal(val, count) {
    return new Array(count).fill(val).join(', ');
  }

  // Format an array of values for namelist (comma-separated, aligned)
  function nlJoin(arr) {
    return arr.join(', ');
  }

  // Right-pad a namelist key for alignment
  function nlKey(key, width) {
    width = width || 36;
    return (' ' + key).padEnd(width);
  }

  return {
    toWRFDate,
    toDisplayDate,
    toGFSDateDir,
    pad,
    clamp,
    bufferedBBox,
    lonTo360,
    haversineDistance,
    copyToClipboard,
    downloadFile,
    repeatVal,
    nlJoin,
    nlKey
  };
})();
