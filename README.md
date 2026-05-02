<p align="center">
  <img src="assets/logo.svg" alt="WRFlow" height="52">
</p>

<p align="center">
  <strong>WRF Configuration Assistant</strong> — A browser-based wizard that generates complete WRF/WPS configuration files and run scripts.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
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
- Draw simulation domains on an interactive Leaflet map with multiple tile layers (Street, Topographic, Satellite)
- Auto-calculates `e_we`, `e_sn`, `ref_lat`, `ref_lon` from drawn rectangles
- Multi-domain nesting (up to 4 domains) with 3:1 or 5:1 ratio enforcement and buffer zone validation
- 4 map projections: Lambert Conformal, Mercator, Polar Stereographic, Lat-Lon

### Data Sources

| Source | Resolution | Interval | Range | Method |
|--------|-----------|----------|-------|--------|
| **GFS** | 0.25° | 1h (0–120h) / 3h (0–384h) | 16 days | cURL + NOMADS GRIB Filter (clipped) with AWS S3 fallback |
| **ERA5** | 0.25° | 1h | Historical | Python + CDS API |

**Notes:**
- **GFS**: Selectable interval: 1h mode downloads f000–f120 hourly (5-day runs); 3h mode downloads up to f384 (16-day runs). ±5° bounding box clipping. Configurable start forecast hour.
- **ERA5**: Requires CDS API key (~5 min setup); full historical coverage.

### Physics Configuration
- 50+ parameterization schemes across 7 categories (microphysics, radiation, surface layer, land surface, PBL, cumulus)
- Recommended defaults with NCAR-sourced tooltips
- PBL ↔ surface layer compatibility validation
- Cumulus auto-disabled for domains with dx < 4 km

### Advanced Namelist Settings
- Vertical levels (`e_vert`), model top pressure (`p_top_requested`)
- Nesting feedback (one-way / two-way)
- Damping options (`w_damping`, `damp_opt`, `dampcoef`)
- History output interval (auto-computed from resolution or manual override)
- Restart interval

### Run Script Generation
- Sequential WPS→WRF pipeline: geogrid → ungrib → metgrid → real → wrf
- Per-step log checking and file verification
- Three execution modes:
  - **Local** — auto-detects `mpirun`, falls back to serial
  - **MPI** — configurable process count
  - **Slurm** — full `#SBATCH` header (partition, nodes, tasks, walltime, account)

### UI
- 5-step guided wizard with completion indicators
- Dark / light theme toggle
- Copy-to-clipboard and download buttons on all outputs
- Tooltips on every configurable parameter
- Session persistence (refreshing the page keeps your configuration)

---

## Quick Start

1. Open **[WRFlow](https://ahmetuyuklu.github.io/WRFlow)** in your browser
2. **Step 1 — Domain:** Draw your simulation area, set DX/DY and projection
3. **Step 2 — Time & Data:** Pick a data source (GFS/ERA5), start date, and duration
4. **Step 3 — Physics:** Choose parameterization schemes or use defaults
5. **Step 4 — Namelists:** Review `namelist.wps` and `namelist.input`
6. **Step 5 — Scripts:** Set WPS/WRF paths, scheduler mode, then download everything

---

## Project Structure

```
WRFlow/
├── index.html              # Single-page application
├── css/style.css           # Component styles (plain CSS, no build)
├── js/
│   ├── app.js              # State management, UI wiring, wizard logic
│   ├── map.js              # Leaflet map + domain drawing
│   ├── domain.js           # Grid calculations, nesting, projections
│   ├── datetime.js         # Date/time validation, data source constraints
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

---

## License

This project is licensed under the [MIT License](LICENSE).
