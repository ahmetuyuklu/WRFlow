/**
 * WRFlow — Download Script Generators
 * GFS (cURL) and ERA5 (Python/cdsapi) data download script generation.
 */
const WRFDownloadScripts = (() => {

  // ERA5 pressure-level variables needed for WRF
  const ERA5_PL_VARS = [
    'geopotential', 'temperature', 'u_component_of_wind', 'v_component_of_wind',
    'relative_humidity', 'specific_humidity'
  ];

  const ERA5_PL_LEVELS = [
    '1', '2', '3', '5', '7', '10', '20', '30', '50', '70',
    '100', '125', '150', '175', '200', '225', '250', '300',
    '350', '400', '450', '500', '550', '600', '650', '700',
    '750', '775', '800', '825', '850', '875', '900', '925',
    '950', '975', '1000'
  ];

  const ERA5_SFC_VARS = [
    'surface_pressure', 'mean_sea_level_pressure',
    'skin_temperature', '2m_temperature', '2m_dewpoint_temperature',
    '10m_u_component_of_wind', '10m_v_component_of_wind',
    'soil_temperature_level_1', 'soil_temperature_level_2',
    'soil_temperature_level_3', 'soil_temperature_level_4',
    'volumetric_soil_water_layer_1', 'volumetric_soil_water_layer_2',
    'volumetric_soil_water_layer_3', 'volumetric_soil_water_layer_4',
    'snow_depth', 'sea_surface_temperature', 'sea_ice_cover',
    'land_sea_mask', 'geopotential'
  ];

  function generateGFS(state) {
    const bbox = WRFUtils.bufferedBBox(
      state.domains[0].bounds.south, state.domains[0].bounds.north,
      state.domains[0].bounds.west, state.domains[0].bounds.east,
      3 // ±3° buffer
    );

    const startDate = state.startDate;
    const dateDir = WRFUtils.toGFSDateDir(startDate);
    const startHour = WRFUtils.pad(startDate.getUTCHours(), 2);

    // Request ALL variables and levels (clipped to subregion)
    const varParams = 'all_var=on';
    const levParams = 'all_lev=on';

    const leftlon = bbox.west.toFixed(2);
    const rightlon = bbox.east.toFixed(2);
    const toplat = bbox.north.toFixed(2);
    const bottomlat = bbox.south.toFixed(2);

    let script = `#!/bin/bash
# =============================================================================
# WRFlow — GFS Data Download Script
# Generated: ${new Date().toISOString().slice(0, 19)}Z
# Source: NCEP GFS 0.25° (GRIB Filter)
# Domain bounding box (with ±3° buffer):
#   South: ${bottomlat}  North: ${toplat}
#   West:  ${leftlon}  East:  ${rightlon}
# =============================================================================

set -euo pipefail

# Configuration
OUTPUT_DIR="./gfs_data"
DATE="${dateDir}"
CYCLE="${startHour}"
START_FH=${state.startForecastHour || 0}
MAX_FH=${(state.startForecastHour || 0) + state.durationHours}
INTERVAL=3

# Create output directory
mkdir -p "\${OUTPUT_DIR}"

BASE_URL="https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
AWS_BASE="https://noaa-gfs-bdp-pds.s3.amazonaws.com"
USER_AGENT="WRFlow/1.0 (+https://github.com/ahmetuyuklu/WRFlow)"
# Download mode:
# 0 = clipped NOMADS subset (default)
# 1 = full GFS files
PREFER_FULL_GFS=0
ALLOW_CLIPPED_FALLBACK=1
MIN_FULL_SIZE_MB=100

# Guard: GFS forecast cycle cannot be in the future
NOW_UTC=$(date -u +"%Y%m%d%H")
REQ_UTC="\${DATE}\${CYCLE}"
if [[ "\${REQ_UTC}" > "\${NOW_UTC}" ]]; then
  echo "[ERROR] Requested GFS cycle is in the future: \${DATE} \${CYCLE}Z"
  echo "        Select a past/available cycle (00Z, 06Z, 12Z, 18Z)."
  exit 1
fi

echo "========================================="
echo "  WRFlow GFS Download"
echo "  Date: \${DATE} Cycle: \${CYCLE}Z"
echo "  Forecast hours: \${START_FH} to \${MAX_FH}, every \${INTERVAL}h"
if [ "\${PREFER_FULL_GFS}" -eq 1 ]; then
  echo "  Mode: FULL files (AWS)"
else
  echo "  Mode: CLIPPED subset (NOMADS filter)"
fi
echo "========================================="
echo ""

ERRORS=0

for FH in $(seq \${START_FH} \${INTERVAL} \${MAX_FH}); do
  FH3=$(printf "%03d" \${FH})
  FILENAME="gfs.t\${CYCLE}z.pgrb2.0p25.f\${FH3}"
  OUTFILE="\${OUTPUT_DIR}/\${FILENAME}"

  if [ -f "\${OUTFILE}" ]; then
    if [ "\${PREFER_FULL_GFS}" -eq 1 ]; then
      SIZE_MB=$(du -m "\${OUTFILE}" | cut -f1)
      if [ "\${SIZE_MB}" -lt "\${MIN_FULL_SIZE_MB}" ]; then
        echo "[RETRY] \${FILENAME} exists but is only \${SIZE_MB}MB (likely clipped). Re-downloading full file."
        rm -f "\${OUTFILE}"
      else
        echo "[SKIP] \${FILENAME} already exists (\${SIZE_MB}MB)."
        continue
      fi
    else
      echo "[SKIP] \${FILENAME} already exists."
      continue
    fi
  fi

  FILTER_URL="\${BASE_URL}?file=\${FILENAME}&${levParams}&${varParams}&subregion=&leftlon=${leftlon}&rightlon=${rightlon}&toplat=${toplat}&bottomlat=${bottomlat}&dir=%2Fgfs.\${DATE}%2F\${CYCLE}%2Fatmos"
  FULL_URL="\${AWS_BASE}/gfs.\${DATE}/\${CYCLE}/atmos/\${FILENAME}"
  URL="\${FILTER_URL}"
  if [ "\${PREFER_FULL_GFS}" -eq 1 ]; then
    URL="\${FULL_URL}"
  fi

  echo -n "[DOWNLOAD] \${FILENAME} ... "

  HTTP_CODE=$(curl -L -sS -A "\${USER_AGENT}" --retry 2 --retry-delay 2 --connect-timeout 30 -w "%{http_code}" -o "\${OUTFILE}" "\${URL}" || true)
  HTTP_CODE="\${HTTP_CODE: -3}"
  if ! [[ "\${HTTP_CODE}" =~ ^[0-9]{3}$ ]]; then HTTP_CODE="000"; fi

  if [ "\${HTTP_CODE}" -eq 200 ] && [ -s "\${OUTFILE}" ]; then
    SIZE=$(du -h "\${OUTFILE}" | cut -f1)
    echo "OK (\${SIZE})"
  else
    if [ "\${PREFER_FULL_GFS}" -eq 1 ]; then
      echo "FULL FILE FAILED (HTTP \${HTTP_CODE})"
    else
      echo "NOMADS FAILED (HTTP \${HTTP_CODE})"
    fi
    rm -f "\${OUTFILE}"
    if [ "\${ALLOW_CLIPPED_FALLBACK}" -eq 1 ]; then
      if [ "\${PREFER_FULL_GFS}" -eq 1 ]; then
        echo "           trying NOMADS clipped fallback"
        FB_URL="\${FILTER_URL}"
      else
        echo "           trying AWS full-file fallback"
        FB_URL="\${FULL_URL}"
      fi
      HTTP_CODE_FB=$(curl -L -sS -A "\${USER_AGENT}" --retry 2 --retry-delay 2 --connect-timeout 30 -w "%{http_code}" -o "\${OUTFILE}" "\${FB_URL}" || true)
      HTTP_CODE_FB="\${HTTP_CODE_FB: -3}"
      if ! [[ "\${HTTP_CODE_FB}" =~ ^[0-9]{3}$ ]]; then HTTP_CODE_FB="000"; fi
      if [ "\${HTTP_CODE_FB}" -eq 200 ] && [ -s "\${OUTFILE}" ]; then
        SIZE=$(du -h "\${OUTFILE}" | cut -f1)
        echo "           FALLBACK OK (\${SIZE})"
      else
        echo "           FALLBACK FAILED (HTTP \${HTTP_CODE_FB})"
        rm -f "\${OUTFILE}"
        ERRORS=$((ERRORS + 1))
      fi
    else
      echo "           fallback disabled"
      ERRORS=$((ERRORS + 1))
    fi
  fi

  # Pause between requests to be courteous to NCEP servers
  sleep 0.5
done

echo ""
if [ \${ERRORS} -gt 0 ]; then
  echo "[WARNING] \${ERRORS} file(s) failed to download."
  exit 1
else
  echo "[SUCCESS] All GFS files downloaded to \${OUTPUT_DIR}/"
  echo "Total files: $(ls -1 \${OUTPUT_DIR}/*.f* 2>/dev/null | wc -l | tr -d ' ')"
fi
`;

    return script;
  }

  function generateERA5(state) {
    const bbox = WRFUtils.bufferedBBox(
      state.domains[0].bounds.south, state.domains[0].bounds.north,
      state.domains[0].bounds.west, state.domains[0].bounds.east,
      3
    );

    const startDate = state.startDate;
    const endDate = state.endDate;

    // Collect all dates in range
    const dates = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Collect unique years, months, days
    const years = [...new Set(dates.map(d => d.getUTCFullYear()))];
    const months = [...new Set(dates.map(d => d.getUTCMonth() + 1))];
    const days = [...new Set(dates.map(d => d.getUTCDate()))];

    // Hours: all 24 for ERA5
    const hours = Array.from({ length: 24 }, (_, i) => WRFUtils.pad(i, 2) + ':00');

    // Area: [North, West, South, East]
    const area = `[${bbox.north.toFixed(2)}, ${bbox.west.toFixed(2)}, ${bbox.south.toFixed(2)}, ${bbox.east.toFixed(2)}]`;

    let script = `#!/usr/bin/env python3
"""
WRFlow — ERA5 Data Download Script
Generated: ${new Date().toISOString().slice(0, 19)}Z
Source: ECMWF ERA5 Reanalysis (CDS API)
Domain bounding box (with ±3° buffer):
  North: ${bbox.north.toFixed(2)}  South: ${bbox.south.toFixed(2)}
  West:  ${bbox.west.toFixed(2)}  East:  ${bbox.east.toFixed(2)}

Prerequisites:
  pip install cdsapi
  Create ~/.cdsapirc with your CDS API key:
    url: https://cds.climate.copernicus.eu/api
    key: <YOUR-API-KEY>
"""

import cdsapi
import os

OUTPUT_DIR = "./era5_data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

c = cdsapi.Client()

# ----- Pressure Level Data -----
print("Downloading ERA5 pressure level data...")

c.retrieve(
    "reanalysis-era5-pressure-levels",
    {
        "product_type": "reanalysis",
        "variable": [
${ERA5_PL_VARS.map(v => `            "${v}"`).join(',\n')},
        ],
        "pressure_level": [
${ERA5_PL_LEVELS.map(l => `            "${l}"`).join(',\n')},
        ],
        "year": [${years.map(y => `"${y}"`).join(', ')}],
        "month": [${months.map(m => `"${WRFUtils.pad(m, 2)}"`).join(', ')}],
        "day": [${days.map(d => `"${WRFUtils.pad(d, 2)}"`).join(', ')}],
        "time": [
${hours.map(h => `            "${h}"`).join(',\n')},
        ],
        "area": ${area},
        "data_format": "grib",
    },
    os.path.join(OUTPUT_DIR, "era5_pressure_levels.grib"),
)

print("Pressure level data downloaded.")

# ----- Single (Surface) Level Data -----
print("Downloading ERA5 single level data...")

c.retrieve(
    "reanalysis-era5-single-levels",
    {
        "product_type": "reanalysis",
        "variable": [
${ERA5_SFC_VARS.map(v => `            "${v}"`).join(',\n')},
        ],
        "year": [${years.map(y => `"${y}"`).join(', ')}],
        "month": [${months.map(m => `"${WRFUtils.pad(m, 2)}"`).join(', ')}],
        "day": [${days.map(d => `"${WRFUtils.pad(d, 2)}"`).join(', ')}],
        "time": [
${hours.map(h => `            "${h}"`).join(',\n')},
        ],
        "area": ${area},
        "data_format": "grib",
    },
    os.path.join(OUTPUT_DIR, "era5_single_levels.grib"),
)

print("Single level data downloaded.")
print(f"All ERA5 data saved to {OUTPUT_DIR}/")
`;

    return script;
  }

  function generateIFS(state) {
    const startDate = state.startDate;
    const dateStr = WRFUtils.toGFSDateDir(startDate); // YYYYMMDD
    const cycleHour = startDate.getUTCHours(); // 0 or 12
    const maxFH = state.durationHours;
    const interval = 3;
    const steps = [];
    for (let fh = 0; fh <= maxFH; fh += interval) steps.push(fh);

    const script = `#!/usr/bin/env python3
"""
WRFlow — ECMWF Open Data IFS Download Script
Generated: ${new Date().toISOString().slice(0, 19)}Z
Source: ECMWF Open Data IFS (ecmwf-opendata)
Cycle: ${dateStr} ${String(cycleHour).padStart(2, '0')}Z
Forecast hours: 0 to ${maxFH}, every ${interval}h

Prerequisites:
  pip install ecmwf-opendata
  No API key required — ECMWF Open Data is freely accessible.

Note: Only the most recent 1-2 IFS cycles are available via Open Data.
      For older dates, use ERA5 reanalysis instead.
"""

import os
from ecmwf.opendata import Client

OUTPUT_DIR = "./ifs_data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

c = Client("ecmwf")

DATE   = "${dateStr}"
CYCLE  = ${cycleHour}
STEPS  = ${JSON.stringify(steps)}

# ===== Pressure-level data =====
# Variables required by WPS/ungrib for IFS input
PL_VARS   = ["z", "t", "u", "v", "r", "q"]
PL_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10]

print("Downloading IFS pressure-level data ...")
c.retrieve(
    date=DATE,
    time=CYCLE,
    step=STEPS,
    type="fc",
    levtype="pl",
    levelist=PL_LEVELS,
    param=PL_VARS,
    target=os.path.join(OUTPUT_DIR, "ifs_pl.grib2"),
)
print("  -> ifs_pl.grib2 done")

# ===== Single-level (surface) data =====
SFC_VARS = [
    "2t", "2d", "10u", "10v",    # 2m temp/dewpoint, 10m winds
    "msl", "sp",                 # mean-sea-level & surface pressure
    "skt",                       # skin temperature
    "stl1", "stl2", "stl3", "stl4",     # soil temperature levels
    "swvl1", "swvl2", "swvl3", "swvl4", # soil moisture levels
    "sd", "ci", "sst", "lsm",    # snow depth, sea ice, SST, land-sea mask
    "z",                         # surface geopotential
]

print("Downloading IFS single-level (surface) data ...")
c.retrieve(
    date=DATE,
    time=CYCLE,
    step=STEPS,
    type="fc",
    levtype="sfc",
    param=SFC_VARS,
    target=os.path.join(OUTPUT_DIR, "ifs_sfc.grib2"),
)
print("  -> ifs_sfc.grib2 done")

print(f"\\nAll IFS data saved to {OUTPUT_DIR}/")
print("  Files: ifs_pl.grib2  ifs_sfc.grib2")
print("Use Vtable.ECMWF in WPS ungrib for IFS GRIB2 files.")
`;

    return script;
  }

  function generate(state) {
    if (state.dataSource === 'ERA5') return generateERA5(state);
    if (state.dataSource === 'IFS')  return generateIFS(state);
    return generateGFS(state);
  }

  function getFilename(source) {
    if (source === 'ERA5') return 'download_era5.py';
    if (source === 'IFS')  return 'download_ifs.py';
    return 'download_gfs.sh';
  }

  function getInfo(source) {
    if (source === 'ERA5') {
      return 'Python script using the CDS API. Requires: pip install cdsapi and a ~/.cdsapirc file with your API key from the Copernicus Climate Data Store.';
    }
    if (source === 'IFS') {
      return 'Python script using the ECMWF Open Data client. Requires: pip install ecmwf-opendata. No API key needed — data is freely available. Only the most recent 1-2 IFS cycles are accessible.';
    }
    return 'Bash script using cURL to download clipped GFS GRIB2 subsets by default, with optional AWS full-file fallback when NOMADS fails. Run with: bash download_gfs.sh';
  }

  return { generate, getFilename, getInfo };
})();
