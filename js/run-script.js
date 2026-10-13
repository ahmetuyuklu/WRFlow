/** WRFlow — Isolated WPS → WRF pipeline with metadata and artifact checks. */
const WRFRunScript = (() => {
  function generate(state) {
    state = WRFConfig.prepare(state);
    const Q = WRFUtils.shellQuote;
    const n = state.domains.length;
    const vtable = state.dataSource === 'ERA5' ? 'Vtable.ERA-interim.pl' : 'Vtable.GFS';
    const scheduler = state.scheduler;
    const sbatch = scheduler === 'slurm' ? `#SBATCH --job-name=WRFlow
#SBATCH --partition=${state.slurmPartition || 'compute'}
#SBATCH --nodes=${state.slurmNodes}
#SBATCH --ntasks-per-node=${state.slurmNtasksPerNode}
#SBATCH --time=${state.slurmWalltime}
${state.slurmAccount ? '#SBATCH --account=' + state.slurmAccount + '\n' : ''}#SBATCH --output=wrflow_%j.out
#SBATCH --error=wrflow_%j.err
` : '';
    const modelLauncher = scheduler === 'slurm' ? 'srun' : scheduler === 'mpi' ? `mpirun -np ${state.numProcs}` : '';
    const wpsLauncher = scheduler === 'slurm' ? 'srun -n 1' : scheduler === 'mpi' ? 'mpirun -np 1' : '';
    const stamps = WRFDateTime.dataTimes(state.timeline).map(WRFUtils.toWRFDate);
    return `#!/bin/bash
${sbatch}# WRFlow — ${state.dataSource} / ${n} domains / ${scheduler}
# Run from any directory. Relative paths are based on this script's directory.
# Namelists are embedded below; each invocation uses fresh work directories.
# Requires Python 3, netCDF ncdump, csh/tcsh, and your configured WPS/WRF build.
set -euo pipefail
die() { printf '[ERROR] %s\\n' "$*" >&2; exit 1; }
command -v python3 >/dev/null || die 'Required command missing: python3'
BASE_DIR=$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)
${scheduler === 'slurm' ? `# Slurm runs a spool copy; recover the original submitted script path.
if [ -n "\${SLURM_JOB_ID:-}" ]; then
  command -v scontrol >/dev/null || die 'Slurm mode requires scontrol to resolve the submitted script path.'
  SCRIPT_PATH=$(scontrol show job "$SLURM_JOB_ID" | python3 -c 'import re, sys; text=sys.stdin.read(); match=re.search(r"(?m)^\\s*Command=(.+)$", text); match or sys.exit("Cannot resolve Slurm job Command"); print(match[1].strip())')
  BASE_DIR=$(cd "$(dirname "$SCRIPT_PATH")" && pwd)
fi
` : ''}
WPS_DIR=${Q(state.wpsDir)}
WRF_DIR=${Q(state.wrfDir)}
DATA_ROOT=${Q(state.downloadDataDir)}
OUTPUT_DIR=${Q(state.outputDir)}
GEOG_DIR=${Q(state.geogDataPath)}
resolve_path() { case "$1" in /*) printf '%s\\n' "$1" ;; *) printf '%s/%s\\n' "$BASE_DIR" "$1" ;; esac; }
WPS_DIR=$(resolve_path "$WPS_DIR")
WRF_DIR=$(resolve_path "$WRF_DIR")
DATA_ROOT=$(resolve_path "$DATA_ROOT")
OUTPUT_DIR=$(resolve_path "$OUTPUT_DIR")
GEOG_DIR=$(resolve_path "$GEOG_DIR")
DATA_DIR="$DATA_ROOT/${WRFConfig.dataKey(state)}"
for cmd in python3 ncdump; do command -v "$cmd" >/dev/null || die "Required command missing: $cmd"; done
${scheduler === 'mpi' ? 'command -v mpirun >/dev/null || die "MPI mode requires mpirun."' : ''}
${scheduler === 'slurm' ? 'command -v srun >/dev/null || die "Slurm mode requires srun."' : ''}
CSH=$(command -v csh || command -v tcsh || true)
[ -n "$CSH" ] || die "WPS link_grib.csh requires csh or tcsh."
for exe in geogrid ungrib metgrid; do [ -x "$WPS_DIR/$exe.exe" ] || die "Missing WPS executable: $exe.exe"; done
for exe in real wrf; do [ -x "$WRF_DIR/run/$exe.exe" ] || die "Missing WRF executable: $exe.exe"; done
[ -f "$WPS_DIR/ungrib/Variable_Tables/${vtable}" ] || die "Missing ${vtable}"
[ -d "$GEOG_DIR" ] || die "Geographical data directory does not exist: $GEOG_DIR"
[ -f "$WPS_DIR/link_grib.csh" ] || die "Missing WPS link_grib.csh"
shopt -s nullglob
grib_files=("$DATA_DIR"/${state.dataSource === 'ERA5' ? '*.grib' : 'gfs.*'})
[ "\${#grib_files[@]}" -gt 0 ] || die "No matching GRIB data in $DATA_DIR. Run the generated download script first."
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR=$(cd "$OUTPUT_DIR" && pwd)
RUN_DIR=$(mktemp -d "$OUTPUT_DIR/run_XXXXXXXX")
WPS_WORK="$RUN_DIR/wps"
WRF_WORK="$RUN_DIR/wrf"
MET_DIR="$RUN_DIR/metgrid"
mkdir -p "$WPS_WORK" "$WRF_WORK" "$MET_DIR"
printf '[INFO] Work directory: %s\\n' "$RUN_DIR"
ln -s "$WPS_DIR/geogrid" "$WPS_WORK/geogrid"
ln -s "$WPS_DIR/metgrid" "$WPS_WORK/metgrid"
ln -s "$WPS_DIR/ungrib/Variable_Tables/${vtable}" "$WPS_WORK/Vtable"
for source in "$WRF_DIR/run"/*; do
  name=$(basename "$source")
  case "$name" in namelist.*|rsl.*|*.log|met_em.*|wrfinput*|wrfbdy*|wrfout*|wrfrst*|wrflowinp*) continue ;; esac
  ln -s "$source" "$WRF_WORK/$name"
done
cat > "$WPS_WORK/namelist.wps" <<'WRFLOW_WPS'
${WRFNamelistWPS.generate(state)}WRFLOW_WPS
cat > "$WRF_WORK/namelist.input" <<'WRFLOW_INPUT'
${WRFNamelistInput.generate(state)}WRFLOW_INPUT

# Resolve namelist paths to exactly the same absolute locations as the pipeline.
python3 - "$WPS_WORK/namelist.wps" "$MET_DIR" "$GEOG_DIR" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
def quoted(value):
    return "'" + value.replace("'", "''") + "'"
for key, value in {"prefix": sys.argv[2] + "/FILE", "fg_name": sys.argv[2] + "/FILE",
                   "opt_output_from_metgrid_path": sys.argv[2] + "/", "geog_data_path": sys.argv[3]}.items():
    line = " " + key.ljust(35) + "= " + quoted(value) + ","
    text, count = re.subn(r"(?im)^\\s*" + key + r"\\s*=.*$", lambda _: line, text)
    if count != 1:
        raise SystemExit(f"Expected one {key} entry in namelist.wps")
path.write_text(text)
PY

run_program() {
  local name="$1" pattern="$2"; shift 2
  local log="$name.stdout.log"
  printf '[INFO] Running %s\\n' "$name"
  if ! "$@" > "$log" 2>&1; then tail -20 "$log" >&2; die "$name failed; see $PWD/$log"; fi
  if ! grep -qs "$pattern" "$log" "$name.log" rsl.out.0000; then
    tail -20 "$log" >&2
    die "$name did not report successful completion; see $PWD/$log"
  fi
}
cd "$WPS_WORK"
run_program geogrid 'Successful completion of program geogrid' ${wpsLauncher} "$WPS_DIR/geogrid.exe"
for ((d=1; d<=${n}; d++)); do printf -v dom '%02d' "$d"; [ -s "geo_em.d$dom.nc" ] || die "Missing geo_em.d$dom.nc"; done
"$CSH" "$WPS_DIR/link_grib.csh" "\${grib_files[@]}"
run_program ungrib 'Successful completion of program ungrib' ${wpsLauncher} "$WPS_DIR/ungrib.exe"
run_program metgrid 'Successful completion of program metgrid' ${wpsLauncher} "$WPS_DIR/metgrid.exe"

# Verify every required domain/time slice and use real met_em dimensions.
python3 - "$MET_DIR" "$WRF_WORK/namelist.input" <<'PY'
import json, pathlib, re, subprocess, sys
directory, namelist = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
times = json.loads(${JSON.stringify(JSON.stringify(stamps))})
levels = set()
soil_levels = set()
land_categories = set()
for domain in range(1, ${n} + 1):
    for time in times:
        path = directory / f"met_em.d{domain:02d}.{time}.nc"
        if not path.is_file() or path.stat().st_size == 0:
            raise SystemExit(f"Missing boundary input: {path}")
        header = subprocess.check_output(["ncdump", "-h", str(path)], text=True)
        match = re.search(r"\\bnum_metgrid_levels\\s*=\\s*(\\d+)\\s*;", header)
        if not match:
            raise SystemExit(f"Cannot read num_metgrid_levels from {path}")
        levels.add(int(match[1]))
        match = re.search(r"\\bnum_st_layers\\s*=\\s*(\\d+)\\s*;", header)
        if match:
            soil_levels.add(int(match[1]))
        match = re.search(r"\\bNUM_LAND_CAT\\s*=\\s*(\\d+)", header)
        if match:
            land_categories.add(int(match[1]))
if len(levels) != 1 or next(iter(levels)) < 2:
    raise SystemExit("Inconsistent metgrid vertical dimensions across domains/times")
actual = next(iter(levels))
expected = ${state.numMetgridLevels ?? 'None'}
if expected is not None and expected != actual:
    raise SystemExit(f"Configured num_metgrid_levels={expected}, but met_em contains {actual}")
text = namelist.read_text()
values = {"num_metgrid_levels": actual}
for key, candidates in [("num_metgrid_soil_levels", soil_levels), ("num_land_cat", land_categories)]:
    if len(candidates) > 1:
        raise SystemExit(f"Inconsistent {key} across met_em inputs")
    if candidates:
        values[key] = next(iter(candidates))
for key, value in values.items():
    line = " " + key.ljust(35) + "= " + str(value) + ","
    pattern = r"(?im)^\\s*" + key + r"\\s*=.*$"
    if re.search(pattern, text):
        text = re.sub(pattern, lambda _: line, text)
    else:
        text = re.sub(r"(?im)^\\s*&domains\\s*$", lambda m: m[0] + "\\n" + line, text)
namelist.write_text(text)
print(f"[INFO] Actual metgrid levels: {actual}")
PY
cd "$WRF_WORK"
ln -s "$MET_DIR"/met_em.* .
run_program real 'SUCCESS COMPLETE REAL' ${modelLauncher} ./real.exe
for ((d=1; d<=${n}; d++)); do
  printf -v dom '%02d' "$d"
  [ -s "wrfinput_d$dom" ] || die "Missing wrfinput_d$dom"
  ${state.sstUpdate ? '[ -s "wrflowinp_d$dom" ] || die "Missing SST input wrflowinp_d$dom"' : ':'}
done
[ -s wrfbdy_d01 ] || die 'Missing wrfbdy_d01'
run_program wrf 'SUCCESS COMPLETE WRF' ${modelLauncher} ./wrf.exe
for ((d=1; d<=${n}; d++)); do
  printf -v dom '%02d' "$d"
  outputs=(wrfout_d"$dom"_*)
  [ "\${#outputs[@]}" -gt 0 ] || die "No wrfout files for d$dom"
  for output in "\${outputs[@]}"; do [ -s "$output" ] || die "Empty WRF output: $output"; done
  cp "\${outputs[@]}" "$OUTPUT_DIR/"
done
printf '[INFO] WRF completed. Outputs: %s; namelists and logs: %s\\n' "$OUTPUT_DIR" "$RUN_DIR"
`;
  }

  function getFilename(state) { return state.scheduler === 'slurm' ? 'run_wrf.sbatch' : 'run_wrf.sh'; }
  return { generate, getFilename };
})();
