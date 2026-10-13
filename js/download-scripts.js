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
    'snow_depth', 'snow_density', 'sea_surface_temperature', 'sea_ice_cover',
    'land_sea_mask', 'geopotential'
  ];

  function generateGFS(state) {
    const bbox = WRFUtils.bufferedBBox(
      state.domains[0].bounds.south, state.domains[0].bounds.north,
      state.domains[0].bounds.west, state.domains[0].bounds.east,
      DOWNLOAD_AREA_BUFFER_DEG
    );

    const startDate = state.timeline.cycle;
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
for cmd in curl; do
  if ! command -v \$cmd &> /dev/null; then
    echo "ERROR: \$cmd not found. Install curl before downloading."
    exit 1
  fi
done

# Configuration
BASE_DIR=$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)
DATA_ROOT=${WRFUtils.shellQuote(state.downloadDataDir)}
case "\${DATA_ROOT}" in /*) ;; *) DATA_ROOT="\${BASE_DIR}/\${DATA_ROOT}" ;; esac
OUTPUT_DIR="\${DATA_ROOT}/${WRFConfig.dataKey(state)}"
DATE="${dateDir}"
CYCLE="${startHour}"
START_FH=${state.timeline.startForecastHour}
MAX_FH=${state.timeline.endForecastHour}
INTERVAL=${state.timeline.interval / 3600}

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

valid_grib() {
  [ -s "$1" ] && [ "$(dd if="$1" bs=4 count=1 2>/dev/null)" = "GRIB" ] &&
    [ "$(tail -c 4 "$1" 2>/dev/null)" = "7777" ]
}

for FH in $(seq \${START_FH} \${INTERVAL} \${MAX_FH}); do
  FH3=$(printf "%03d" \${FH})
  FILENAME="gfs.t\${CYCLE}z.pgrb2.0p25.f\${FH3}"
  OUTFILE="\${OUTPUT_DIR}/\${FILENAME}"

  if valid_grib "\${OUTFILE}"; then
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

  if [ "\${HTTP_CODE}" -eq 200 ] && valid_grib "\${OUTFILE}"; then
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
      if [ "\${HTTP_CODE_FB}" -eq 200 ] && valid_grib "\${OUTFILE}"; then
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

    const requests = WRFDateTime.era5Requests(state.timeline);
    return `#!/usr/bin/env python3
"""WRFlow ERA5 download. Requires cdsapi, ~/.cdsapirc, and ecCodes grib_set.
Requests exact UTC boundary times, grouped by calendar day. Files are converted
to simple-packed GRIB1 for the WPS Vtable.ERA-interim.pl mapping.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile
import cdsapi

if not shutil.which("grib_set"):
    raise SystemExit("Install ecCodes tools (grib_set) before downloading ERA5.")
BASE_DIR = Path(__file__).resolve().parent
DATA_ROOT = Path(${JSON.stringify(state.downloadDataDir)})
if not DATA_ROOT.is_absolute():
    DATA_ROOT = BASE_DIR / DATA_ROOT
OUTPUT_DIR = DATA_ROOT / ${JSON.stringify(WRFConfig.dataKey(state))}
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
REQUESTS = json.loads(${JSON.stringify(JSON.stringify(requests))})
AREA = [${[bbox.north, bbox.west, bbox.south, bbox.east].map(v => v.toFixed(2)).join(', ')}]
PL_VARS = ${JSON.stringify(ERA5_PL_VARS)}
PL_LEVELS = ${JSON.stringify(ERA5_PL_LEVELS)}
SFC_VARS = ${JSON.stringify(ERA5_SFC_VARS)}

def valid_grib(path):
    if not path.exists() or path.stat().st_size < 8:
        return False
    with path.open("rb") as stream:
        first = stream.read(4)
        stream.seek(-4, os.SEEK_END)
        return first == b"GRIB" and stream.read(4) == b"7777"

def unpack_and_convert(path):
    # Some CDS responses contain several GRIB members in a zip archive.
    if zipfile.is_zipfile(path):
        combined = path.with_suffix(".combined")
        with zipfile.ZipFile(path) as archive, combined.open("wb") as out:
            members = [name for name in archive.namelist() if name.endswith((".grib", ".grb", ".grib2"))]
            if not members:
                raise RuntimeError("CDS archive contains no GRIB files.")
            for name in sorted(members):
                with archive.open(name) as source:
                    shutil.copyfileobj(source, out)
        combined.replace(path)
    if not valid_grib(path):
        raise RuntimeError(f"CDS did not return valid GRIB data: {path}")
    tmp = path.with_suffix(".tmp")
    subprocess.run(["grib_set", "-r", "-s", "edition=1,packingType=grid_simple", str(path), str(tmp)], check=True)
    if not valid_grib(tmp):
        raise RuntimeError("ecCodes conversion did not produce valid GRIB.")
    tmp.replace(path)

client = cdsapi.Client()
for day in REQUESTS:
    stamp = day["year"] + day["month"] + day["day"]
    for kind, dataset, variables in [
        ("pressure", "reanalysis-era5-pressure-levels", PL_VARS),
        ("surface", "reanalysis-era5-single-levels", SFC_VARS),
    ]:
        request = dict(day, product_type="reanalysis", variable=variables,
                       area=AREA, data_format="grib", download_format="unarchived")
        if kind == "pressure":
            request["pressure_level"] = PL_LEVELS
        target = OUTPUT_DIR / f"era5_{kind}_{stamp}.grib"
        if not valid_grib(target):
            client.retrieve(dataset, request, str(target))
        unpack_and_convert(target)
        print(f"Ready: {target}")
print(f"ERA5 boundary data is ready in {OUTPUT_DIR}")
`;
  }

  function generate(state) {
    state = WRFConfig.prepare(state);
    if (state.dataSource === 'ERA5') return generateERA5(state);
    return generateGFS(state);
  }

  function getFilename(source) {
    if (source === 'ERA5') return 'download_era5.py';
    return 'download_gfs.sh';
  }

  function getInfo(source) {
    if (source === 'ERA5') {
      return 'Python script using the CDS API. Requires cdsapi, ecCodes grib_set, and a ~/.cdsapirc file with your CDS API key. Requests exact UTC boundary times and converts GRIB data for WPS compatibility.';
    }
    return 'Bash script using cURL to download clipped GFS GRIB2 subsets by default, with optional AWS full-file fallback when NOMADS fails. Run with: bash download_gfs.sh';
  }

  return { generate, getFilename, getInfo };
})();
