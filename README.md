<p align="center">
  <img src="assets/logo.svg" alt="WRFlow" height="52">
</p>

<p align="center">
  <strong>WRF Configuration Assistant</strong> — A browser-based wizard that generates complete WRF/WPS configuration files and run scripts.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/status-beta-amber.svg" alt="Status: Beta">
  <a href="https://ahmetuyuklu.github.io/WRFlow"><img src="https://img.shields.io/badge/demo-GitHub%20Pages-brightgreen" alt="GitHub Pages"></a>
</p>

---

---

## What It Does

WRFlow walks you through configuring a WRF simulation in 5 steps and generates everything you need to run it:

| Output | Description |
|--------|-------------|
| `namelist.wps` | WPS configuration (share, geogrid, ungrib, metgrid) |
| `namelist.input` | WRF configuration (time_control, domains, physics, dynamics, bdy_control) |
| `download_gfs.sh` / `download_era5.py` | Data acquisition script for your chosen source |
| `run_wrf.sh` / `run_wrf.sbatch` | Full WPS→WRF pipeline with error checking |

---

## Features

### Domain Setup
- Select simulation areas on an interactive Leaflet map with multiple tile layers (Street, Topographic, Satellite)
- Displays the actual projected WRF grid boundary, including curved Lambert and Polar edges
- Auto-calculates `e_we`, `e_sn`, `ref_lat`, `ref_lon` from rectangle selections in the selected WPS projection
- Grid-aware move/resize controls: click the pencil, drag the center to move or a corner to resize, then click the checkmark to finish
- Parent resizing keeps nests geographically fixed; moving the parent moves its entire nested group
- Multi-domain nesting (up to 4 domains), odd ratios of 3 or greater, and parent-grid buffer validation
- Invalid parent shrinks are rolled back; deleting a domain renumbers surviving parent references consistently
- 4 map projections: Lambert Conformal, Mercator, Polar Stereographic, Lat-Lon
- The basemap remains Web Mercator; the domain outline uses the selected WRF projection
- Lambert, Mercator, and Polar use equal DX/DY; Lat-Lon spacing is entered in meters at the equator and converted to degrees in `namelist.wps`

### Data Sources

| Source | Resolution | Interval | Range | Method |
|--------|-----------|----------|-------|--------|
| **GFS** | 0.25° | 1h (0–120h) / 3h (0–384h) | 16 days | cURL + NOMADS GRIB Filter (clipped) with AWS S3 fallback |
| **ERA5** | 0.25° | 1h | Historical | Python + CDS API |

**Notes:**
- **GFS**: 1h mode supports up to f120; 3h mode supports up to f384. The simulation begins at cycle time + start forecast hour. Boundary coverage is rounded up to the next interval and must stay within the forecast horizon. ±5° clipping with full-file AWS fallback.
- **ERA5**: Requires `cdsapi`, a CDS API key, and ecCodes `grib_set`. Requests exact UTC boundary times by calendar day, including overnight, leap-day, and year crossings. Converts to simple-packed GRIB1 for `Vtable.ERA-interim.pl`.
- **Boundary intervals**: Overrides are shared by WPS, WRF, and download scripts and must be whole multiples of the selected source interval.
- **Caching**: Data is stored in dataset subdirectories under DATA_DIR, keyed by cycle/time range and geographic area. Different forecast cycles and clipped regions cannot accidentally reuse one another's files.

### Physics Configuration
- 50+ parameterization schemes across 7 categories (microphysics, radiation, surface layer, land surface, PBL, cumulus)
- Recommended defaults with NCAR-sourced tooltips
- PBL ↔ surface layer compatibility validation
- Physics mappings target WRF ARW 4.5+: QNSE is option 4; MYNN is option 5 with a separate 2.5/3.0 closure setting; radiation option 24 is fast RRTMG
- Cumulus auto-disabled for domains with dx < 4 km

### Advanced Namelist Settings
- Vertical levels (`e_vert`), model top pressure (`p_top_requested`)
- Nesting feedback (one-way / two-way)
- Damping options (`w_damping`, `damp_opt`, `dampcoef`)
- History output interval (auto-computed from resolution or manual override)
- Restart interval
- SST updates include the required `auxinput4_*` settings
- `num_metgrid_levels`: defaults to current full GFS (42) / ERA5 (38) for standalone namelists; the run script detects the actual met_em dimensions before `real.exe`. Optional manual values are checked against those files.
- Explicit eta levels are validated against `e_vert` and must decrease strictly from 1 to 0

### Run Script Generation
- Sequential WPS→WRF pipeline: geogrid → ungrib → metgrid → real → wrf
- Per-step log checking and file verification
- Embeds both namelists and runs in fresh work directories under OUTPUT_DIR, preserving installation namelists
- Resolves relative paths from the scripts' directory and rewrites WPS paths consistently before execution
- Verifies every domain and required boundary time, detects metgrid/soil dimensions and land-category metadata, and checks every domain's WRF output
- Three execution modes:
  - **Local** — single process for both REAL and WRF
  - **MPI** — configurable process count for both REAL and WRF
  - **Slurm** — full `#SBATCH` header (partition, nodes, tasks, walltime, account)

### UI
- 5-step guided wizard with completion indicators
- Dark / light theme toggle
- Copy-to-clipboard and download buttons on all outputs
- Tooltips on every configurable parameter
- Session persistence (refreshing the page keeps your configuration)
- Shared validation blocks file generation for missing/invalid domains, incompatible physics, or invalid timing
- JSON/share restoration synchronizes all controls; malformed imports retain the previous configuration

---

## Quick Start

1. Open **[WRFlow](https://ahmetuyuklu.github.io/WRFlow)** in your browser
2. **Step 1 — Domain:** Select a projection and draw your simulation area; review the projected outline and adjust DX/DY or use the pencil to move/resize
3. **Step 2 — Time & Data:** Pick a data source (GFS/ERA5), start date, and duration
4. **Step 3 — Physics:** Choose parameterization schemes or use defaults
5. **Step 4 — Namelists:** Review `namelist.wps` and `namelist.input`
6. **Step 5 — Scripts:** Set WPS/WRF paths, scheduler mode, then download everything

### Running the generated files

Put the generated download and run scripts in the same directory. Configure WPS_DIR, WRF_DIR, WPS_GEOG_DIR, DATA_DIR, and OUTPUT_DIR before downloading the scripts.

The pipeline requires a configured WPS/WRF installation, Python 3, netCDF `ncdump`, and `csh`/`tcsh`. MPI mode requires `mpirun`; Slurm mode requires `srun` and `scontrol` (to recover the original script directory from Slurm's spool copy). Use an execution mode matching your WRF build. For ERA5, install `cdsapi` and ecCodes and configure `~/.cdsapirc`.

Run the download script first, then `bash run_wrf.sh` (or `sbatch run_wrf.sbatch`). Standalone namelists are provided for review/manual workflows; the run script embeds the same configuration and resolves its paths inside isolated work directories.

If the simulation duration is not a whole boundary interval, WPS and REAL's `end_*` fields include the next bracketing time. WRF's `run_days`/`run_hours` retain the requested model duration, following NCAR's documented precedence rules.

---

## Project Structure

```
WRFlow/
├── index.html              # Single-page application
├── css/style.css           # Component styles (plain CSS, no build)
├── js/
│   ├── app.js              # State management, UI wiring, wizard logic
│   ├── map.js              # Leaflet selection + projected domain editing
│   ├── projection.js       # Spherical WPS projection transforms
│   ├── domain.js           # Projected grid calculations + nesting
│   ├── datetime.js         # Date/time validation, data source constraints
│   ├── config.js           # Shared validation, import migration, output snapshots
│   ├── physics.js          # Physics scheme catalog + compatibility
│   ├── namelist-wps.js     # namelist.wps generator
│   ├── namelist-input.js   # namelist.input generator
│   ├── download-scripts.js # GFS/ERA5 download script generators
│   ├── run-script.js       # run_wrf.sh / .sbatch generator
│   └── utils.js            # Shared formatting helpers
├── README.md
└── LICENSE
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | Vanilla HTML/CSS/JavaScript — zero dependencies, zero build step |
| Styling | [Tailwind CSS](https://tailwindcss.com) (Play CDN) + custom CSS |
| Map | [Leaflet](https://leafletjs.com) + [Leaflet Draw](https://leaflet.github.io/Leaflet.draw/) |
| Hosting | GitHub Pages (static, client-side only) |

---

## Local Development

No build step required:

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve .
```

Then open `http://localhost:8000`.

Run the regression checks with Node.js and Python 3:

```bash
node --test tests/*.test.js
```

The pipeline tests use simulated WPS/WRF executables to check paths, metadata, launchers, boundary coverage, and failure handling without running a model or downloading real data.

Optional browser regressions require Playwright:

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/browser.py
```

---

## License

This project is licensed under the [MIT License](LICENSE).
