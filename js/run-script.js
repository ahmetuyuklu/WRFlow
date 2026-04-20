/**
 * WRFlow — WRF Run Script Generator
 * Generates run_wrf.sh for sequential WPS + WRF execution with error handling.
 */
const WRFRunScript = (() => {

  function generate(state) {
    let vtable = 'Vtable.GFS';
    if (state.dataSource === 'ERA5') vtable = 'Vtable.ERA-interim.pl';
    if (state.dataSource === 'IFS')  vtable = 'Vtable.ECMWF';

    const dataDir = state.dataSource === 'ERA5' ? './era5_data'
                  : state.dataSource === 'IFS'  ? './ifs_data'
                  : './gfs_data';
    const gribPattern = state.dataSource === 'ERA5' ? '"${DATA_DIR}"/*.grib'
                      : state.dataSource === 'IFS'  ? '"${DATA_DIR}"/ifs_*.grib2'
                      : '"${DATA_DIR}"/gfs.*';
    const numDomains = state.domains.length;
    const numProcs = state.numProcs || 4;
    const scheduler = state.scheduler || 'local';

    // Scheduler-specific SBATCH header (empty for local/mpi)
    const sbatchHeader = scheduler === 'slurm' ? `#SBATCH --job-name=WRFlow
#SBATCH --partition=${state.slurmPartition || 'compute'}
#SBATCH --nodes=${state.slurmNodes || 1}
#SBATCH --ntasks-per-node=${state.slurmNtasksPerNode || 32}
#SBATCH --time=${state.slurmWalltime || '24:00:00'}
${state.slurmAccount ? '#SBATCH --account=' + state.slurmAccount + '\n' : ''}#SBATCH --output=wrflow_%j.out
#SBATCH --error=wrflow_%j.err
` : '';

    // WRF execution command depends on scheduler
    let wrfExec;
    if (scheduler === 'slurm') {
      wrfExec = `srun ./wrf.exe >& wrf.log || true`;
    } else if (scheduler === 'mpi') {
      wrfExec = `if ! command -v mpirun &> /dev/null; then\n  log_error "mpirun not found. Install an MPI library (e.g., OpenMPI) or switch to Local mode."\n  exit 1\nfi\nmpirun -np \${NUM_PROCS} ./wrf.exe >& wrf.log || true`;
    } else {
      wrfExec = `if command -v mpirun &> /dev/null; then\n  mpirun -np \${NUM_PROCS} ./wrf.exe >& wrf.log || true\nelse\n  log_warn "mpirun not found, running serial wrf.exe"\n  ./wrf.exe >& wrf.log || true\nfi`;
    }

    let script = `#!/bin/bash
${sbatchHeader}# =============================================================================
# WRFlow — WRF Run Script
# Generated: ${new Date().toISOString().slice(0, 19)}Z
# Data Source: ${state.dataSource}
# Domains: ${numDomains}
# Scheduler: ${scheduler}
# 
# This script runs the WRF Preprocessing System (WPS) and WRF model
# sequentially: geogrid → ungrib → metgrid → real → wrf
# =============================================================================

set -euo pipefail

# ============== USER CONFIGURATION ==============
# Set these paths to your WPS and WRF installation directories
WPS_DIR="${state.wpsDir}"
WRF_DIR="${state.wrfDir}"
DATA_DIR="${dataDir}"
NUM_PROCS=${numProcs}  # Number of MPI processes for wrf.exe
# ================================================

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
NC='\\033[0m'

log_info()  { echo -e "\${GREEN}[INFO]\${NC}  $1"; }
log_warn()  { echo -e "\${YELLOW}[WARN]\${NC}  $1"; }
log_error() { echo -e "\${RED}[ERROR]\${NC} $1"; }

check_success() {
  local program="$1"
  local logfile="$2"
  # WPS programs print "Successful completion of program <name>"
  # WRF/real print "SUCCESS COMPLETE WRF"
  local pattern="$3"

  if [ ! -f "\${logfile}" ]; then
    log_error "\${program}: Log file not found: \${logfile}"
    exit 1
  fi

  if grep -q "\${pattern}" "\${logfile}" 2>/dev/null; then
    log_info "\${program}: SUCCESS"
  else
    log_error "\${program}: FAILED — check \${logfile}"
    tail -20 "\${logfile}"
    exit 1
  fi
}

echo "========================================="
echo "  WRFlow — WRF Execution Pipeline"
echo "  $(date -u '+%Y-%m-%d %H:%MZ')"
echo "========================================="
echo ""

# ===== Step 1: GEOGRID =====
log_info "Step 1/5: Running geogrid.exe ..."
cd "\${WPS_DIR}"

# Copy namelist.wps (should already be in WPS_DIR)
if [ ! -f namelist.wps ]; then
  log_error "namelist.wps not found in \${WPS_DIR}"
  exit 1
fi

./geogrid.exe >& geogrid.log || true

check_success "geogrid.exe" "geogrid.log" "Successful completion of program geogrid"

# Verify geo_em files were created
for d in $(seq 1 ${numDomains}); do
  dnum=$(printf "%02d" \${d})
  if [ ! -f "geo_em.d\${dnum}.nc" ]; then
    log_error "geo_em.d\${dnum}.nc not found after geogrid"
    exit 1
  fi
done
log_info "All geo_em files created successfully."
echo ""

# ===== Step 2: UNGRIB =====
log_info "Step 2/5: Running ungrib.exe ..."

# Link Vtable
ln -sf ungrib/Variable_Tables/${vtable} Vtable

# Link GRIB files
./link_grib.csh ${gribPattern}

if [ ! -f Vtable ]; then
  log_error "Vtable link not found"
  exit 1
fi

./ungrib.exe >& ungrib.log || true

check_success "ungrib.exe" "ungrib.log" "Successful completion of program ungrib"
echo ""

# ===== Step 3: METGRID =====
log_info "Step 3/5: Running metgrid.exe ..."

./metgrid.exe >& metgrid.log || true

check_success "metgrid.exe" "metgrid.log" "Successful completion of program metgrid"

# Verify met_em files were created
MET_COUNT=$(ls -1 met_em.d01.* 2>/dev/null | wc -l | tr -d ' ')
if [ "\${MET_COUNT}" -eq 0 ]; then
  log_error "No met_em files found after metgrid"
  exit 1
fi
log_info "Created \${MET_COUNT} met_em time slices."
echo ""

# ===== Step 4: REAL =====
log_info "Step 4/5: Running real.exe ..."
cd "\${WRF_DIR}/run"

# Copy namelist.input into the run directory
if [ ! -f namelist.input ]; then
  log_error "namelist.input not found in \${WRF_DIR}/run"
  log_error "Copy your namelist.input to \${WRF_DIR}/run/ before running."
  exit 1
fi

# Link met_em files from WPS directory
ln -sf "\${WPS_DIR}"/met_em.* .

./real.exe >& real.log || true

check_success "real.exe" "rsl.out.0000" "SUCCESS COMPLETE REAL"

# Verify wrfinput and wrfbdy files
if [ ! -f wrfinput_d01 ]; then
  log_error "wrfinput_d01 not found after real.exe"
  exit 1
fi
if [ ! -f wrfbdy_d01 ]; then
  log_error "wrfbdy_d01 not found after real.exe"
  exit 1
fi
log_info "wrfinput and wrfbdy files created."
echo ""

# ===== Step 5: WRF =====
log_info "Step 5/5: Running wrf.exe ..."

${wrfExec}

check_success "wrf.exe" "rsl.out.0000" "SUCCESS COMPLETE WRF"

# Verify wrfout files
WRF_COUNT=$(ls -1 wrfout_d01_* 2>/dev/null | wc -l | tr -d ' ')
if [ "\${WRF_COUNT}" -eq 0 ]; then
  log_error "No wrfout files found after wrf.exe"
  exit 1
fi

echo ""
echo "========================================="
log_info "WRF run completed successfully!"
log_info "Output files: \${WRF_COUNT} wrfout time slices"
echo "  Location: \${WRF_DIR}/run/"
echo "========================================="
`;

    return script;
  }

  function getFilename(state) {
    return (state.scheduler === 'slurm') ? 'run_wrf.sbatch' : 'run_wrf.sh';
  }

  return { generate, getFilename };
})();
