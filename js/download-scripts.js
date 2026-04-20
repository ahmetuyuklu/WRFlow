/**
 * WRFlow — Download Script Generators
 * GFS (cURL) and ERA5 (Python/cdsapi) data download script generation.
 */
const WRFDownloadScripts = (() => {
  const DOWNLOAD_AREA_BUFFER_DEG = 5;

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
      DOWNLOAD_AREA_BUFFER_DEG
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
# Domain bounding box (with ±${DOWNLOAD_AREA_BUFFER_DEG}° buffer):
#   South: ${bottomlat}  North: ${toplat}
#   West:  ${leftlon}  East:  ${rightlon}
# =============================================================================

set -euo pipefail

# Check for required commands
for cmd in curl wget; do
  if ! command -v \$cmd &> /dev/null; then
    echo "WARNING: \$cmd not found. Install with: apt-get install curl wget (Linux) or brew install curl wget (macOS)"
  fi
done

# Configuration
OUTPUT_DIR="./gfs_data"
DATE="${dateDir}"
CYCLE="${startHour}"
START_FH=${state.startForecastHour || 0}
MAX_FH=${Math.min((state.startForecastHour || 0) + state.durationHours, (state.gfsInterval || 3) === 1 ? 120 : 384)}
INTERVAL=${state.gfsInterval || 3}

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
      DOWNLOAD_AREA_BUFFER_DEG
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
Domain bounding box (with ±${DOWNLOAD_AREA_BUFFER_DEG}° buffer):
  North: ${bbox.north.toFixed(2)}  South: ${bbox.south.toFixed(2)}
  West:  ${bbox.west.toFixed(2)}  East:  ${bbox.east.toFixed(2)}

Prerequisites:
  pip install cdsapi
  Create ~/.cdsapirc with your CDS API key:
    url: https://cds.climate.copernicus.eu/api
    key: <YOUR-API-KEY>
  Install ecCodes tools (needed to fix GRIB2 packing for ungrib.exe):
    Ubuntu/Debian: sudo apt install -y libeccodes-tools
    Conda:         conda install -c conda-forge eccodes
"""

import sys
import subprocess
import os

# Ensure cdsapi is installed
try:
    import cdsapi
except ImportError:
    print("Installing cdsapi...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "cdsapi", "-q"])
    import cdsapi

OUTPUT_DIR = "./era5_data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Helper: convert GRIB2 packing to grid_simple so ungrib.exe can read it.
# ECMWF uses AEC/CCSDS compression (DRS Template 42) which older WPS builds
# do not support. grib_set re-packs the file in-place using simple packing.
# ---------------------------------------------------------------------------
def fix_grib_packing(path):
    tmp = path + ".tmp"
    result = subprocess.run(
        ["grib_set", "-s", "packingType=grid_simple", path, tmp],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  WARNING: grib_set failed for {path}:")
        print(f"    {result.stderr.strip()}")
        print("  Make sure libeccodes-tools is installed and try again.")
        if os.path.exists(tmp):
            os.remove(tmp)
    else:
        os.replace(tmp, path)
        print(f"  Packing fixed: {os.path.basename(path)}")

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
print("Converting packing for ungrib.exe compatibility...")
fix_grib_packing(os.path.join(OUTPUT_DIR, "era5_pressure_levels.grib"))

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
print("Converting packing for ungrib.exe compatibility...")
fix_grib_packing(os.path.join(OUTPUT_DIR, "era5_single_levels.grib"))

print(f"All ERA5 data saved to {OUTPUT_DIR}/")
print("You can now run ungrib.exe. Link or copy the .grib files to your WPS run directory.")
`;

    return script;
  }

  function generate(state) {
    if (state.dataSource === 'ERA5') return generateERA5(state);
    return generateGFS(state);
  }

  function getFilename(source) {
    if (source === 'ERA5') return 'download_era5.py';
    return 'download_gfs.sh';
  }

  function getInfo(source) {
    if (source === 'ERA5') {
      return 'Python script using the CDS API. Requires: pip install cdsapi and a ~/.cdsapirc file with your API key from the Copernicus Climate Data Store.';
    }
    return 'Bash script using cURL to download clipped GFS GRIB2 subsets by default, with optional AWS full-file fallback when NOMADS fails. Run with: bash download_gfs.sh';
  }

  return { generate, getFilename, getInfo };
})();
