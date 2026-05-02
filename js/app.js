/**
 * WRFlow — Main Application Controller
 * Wizard navigation, state management, UI event binding, and orchestration.
 */
const WRFApp = (() => {

  // ===== Central State =====
  let state = {
    currentStep: 1,
    mapProj: 'lambert',
    domains: [
      {
        id: 1,
        parent_id: 1,
        parent_grid_ratio: 1,
        i_parent_start: 1,
        j_parent_start: 1,
        e_we: 100,
        e_sn: 100,
        dx: 9000,
        dy: 9000,
        ref_lat: 39.0,
        ref_lon: 35.0,
        bounds: null
      }
    ],
    wrfCore: 'ARW',
    eVert: 45,
    truelat1: 30,
    truelat2: 60,
    standLon: 35,
    dataSource: 'GFS',
    gfsInterval: 3,
    startDateStr: '',
    startHour: 12,
    durationHours: 24,
    startForecastHour: 0,
    intervalSeconds: 10800,
    startDate: null,
    endDate: null,
    wpsDir: '/path/to/WPS',
    wrfDir: '/path/to/WRF',
    physics: WRFPhysics.getDefaults(),
    // Advanced namelist settings
    pTop: 5000,
    feedback: 1,
    wDamping: 1,
    dampOpt: 3,
    dampCoef: 0.2,
    diffOpt: 1,
    kmOpt: 4,
    diff6thOpt: 0,
    zdamp: 5000,
    geogDataPath: '/path/to/WPS_GEOG/',
    restartInterval: 1440,
    framesPerOutfile: 1000,
    debugLevel: 0,
    intervalSecondsOverride: null,
    etaLevels: '',
    // Advanced Physics
    shcuPhysics: 0,
    sfUrbanPhysics: 0,
    sfLakePhysics: 0,
    sstUpdate: 0,
    // Scheduler / runtime
    scheduler: 'local',
    numProcs: 4,
    slurmPartition: 'compute',
    slurmNodes: 1,
    slurmNtasksPerNode: 32,
    slurmWalltime: '24:00:00',
    slurmAccount: '',
    // Script directories
    downloadDataDir: './wrf_data',
    outputDir: './wrf_output'
  };

  // ===== State Persistence =====
  // ===== Serialize / Deserialize (for share URL) =====
  function serializeState() {
    const s = { ...state };
    s.startDate = s.startDate ? s.startDate.toISOString() : null;
    s.endDate   = s.endDate   ? s.endDate.toISOString()   : null;
    const bytes = new TextEncoder().encode(JSON.stringify(s));
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function deserializeState(encoded) {
    const binary = atob(encoded);
    const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0));
    const s      = JSON.parse(new TextDecoder().decode(bytes));
    s.startDate = s.startDate ? new Date(s.startDate) : null;
    s.endDate   = s.endDate   ? new Date(s.endDate)   : null;
    if (!WRFDateTime.DATA_SOURCES[s.dataSource]) s.dataSource = 'GFS';
    Object.assign(state, s);
  }

  function saveState() {
    try {
      const s = { ...state };
      s.startDate = s.startDate ? s.startDate.toISOString() : null;
      s.endDate = s.endDate ? s.endDate.toISOString() : null;
      sessionStorage.setItem('wrflow-state', JSON.stringify(s));
    } catch (e) { /* quota exceeded — ignore */ }
  }

  function loadState() {
    try {
      const raw = sessionStorage.getItem('wrflow-state');
      if (!raw) return false;
      const s = JSON.parse(raw);
      s.startDate = s.startDate ? new Date(s.startDate) : null;
      s.endDate = s.endDate ? new Date(s.endDate) : null;
      if (!WRFDateTime.DATA_SOURCES[s.dataSource]) s.dataSource = 'GFS';
      Object.assign(state, s);
      return true;
    } catch (e) { return false; }
  }

  // ===== Wizard Navigation =====
  function goToStep(step) {
    if (step < 0 || step > 5) return;

    // Hide all steps
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('hidden'));
    document.getElementById(`step-${step}`).classList.remove('hidden');

    // Intro page — no nav/state updates needed
    if (step === 0) return;

    // Update sidebar
    document.querySelectorAll('.wizard-step-btn').forEach(btn => {
      const s = parseInt(btn.dataset.step);
      const numEl = btn.querySelector('.step-num');
      btn.classList.toggle('active', s === step);
      btn.classList.toggle('completed', s < step);
      // Show ✔ on completed steps, restore number otherwise
      if (numEl) numEl.textContent = s < step ? '✔' : s;
    });

    // Update mobile tabs
    document.querySelectorAll('.mobile-tab').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.step) === step);
    });

    state.currentStep = step;
    saveState();

    // Warn if going to output steps without config
    if ((step === 4 || step === 5) && (!state.domains[0].bounds || !state.startDate)) {
      showToast('Please configure domains and time settings first.', 'warning');
    }

    // Step-specific init
    if (step === 1) WRFMap.invalidateSize();
    if (step === 3) updatePhysicsUI();
    if (step === 4) { syncAdvancedUI(); updateNamelists(); }
    if (step === 5) updateScripts();
  }

  // ===== Toast Notification =====
  function showToast(message, type = 'info') {
    const existing = document.getElementById('wrflow-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'wrflow-toast';
    const colors = {
      warning: 'background:#fef3c7;color:#92400e;border:1px solid #fcd34d',
      info: 'background:#dbeafe;color:#1e40af;border:1px solid #93c5fd',
      success: 'background:#dcfce7;color:#166534;border:1px solid #86efac'
    };
    toast.style.cssText = `position:fixed;bottom:1.5rem;right:1.5rem;padding:0.75rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;z-index:3000;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s;${colors[type] || colors.info}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
  }

  // ===== Dark Mode =====
  function initTheme() {
    const saved = localStorage.getItem('wrflow-theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    }
    document.getElementById('btn-theme').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('wrflow-theme', next);
    });
  }

  // ===== Tooltip System =====
  function initTooltips() {
    const popover = document.getElementById('tooltip-popover');
    document.addEventListener('mouseover', (e) => {
      const trigger = e.target.closest('.tooltip-trigger');
      if (!trigger) return;
      const text = trigger.dataset.tooltip;
      if (!text) return;

      popover.textContent = text;
      popover.classList.remove('hidden');

      const rect = trigger.getBoundingClientRect();
      popover.style.top = (rect.bottom + 8) + 'px';
      popover.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 320)) + 'px';
    });

    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('.tooltip-trigger')) {
        popover.classList.add('hidden');
      }
    });
  }

  // ===== Domain Setup (Step 1) =====
  function initDomainUI() {
    // Projection change
    document.getElementById('map-proj').addEventListener('change', (e) => {
      state.mapProj = e.target.value;
      updateProjectionFields();
      recalcDomain(1);
    });

    // DX/DY
    document.getElementById('dx').addEventListener('change', (e) => {
      state.domains[0].dx = parseInt(e.target.value) || 9000;
      recalcDomain(1);
    });
    document.getElementById('dy').addEventListener('change', (e) => {
      state.domains[0].dy = parseInt(e.target.value) || 9000;
      recalcDomain(1);
    });

    // Manual coordinate inputs
    ['ref-lat', 'ref-lon', 'e-we', 'e-sn', 'truelat1', 'truelat2', 'stand-lon', 'e-vert'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => syncManualInputs());
    });

    // Domain update from map
    document.addEventListener('domain-updated', (e) => {
      const { domainId, bounds } = e.detail;
      const domIdx = state.domains.findIndex(d => d.id === domainId);
      if (domIdx === -1) return;
      state.domains[domIdx].bounds = bounds;
      recalcDomain(domainId);
    });

    // Add Nest button
    document.getElementById('btn-add-nest').addEventListener('click', openNestModal);
    document.getElementById('nest-cancel').addEventListener('click', closeNestModal);
    document.getElementById('nest-confirm').addEventListener('click', confirmAddNest);
    initNestRatioControls();
  }

  function initNestRatioControls() {
    const ratioButtons = document.querySelectorAll('[data-ratio]');
    const customInput = document.getElementById('nest-ratio-custom');
    const ratioHidden = document.getElementById('nest-ratio');

    if (!customInput || !ratioHidden || ratioButtons.length === 0) return;

    const resetRatioButtons = () => {
      ratioButtons.forEach((b) => {
        b.classList.remove('bg-primary-50', 'dark:bg-primary-900/20', 'border-primary-500');
        b.classList.add('border-surface-200', 'dark:border-surface-700');
      });
    };

    const setActiveRatioButton = (button) => {
      resetRatioButtons();
      button.classList.add('bg-primary-50', 'dark:bg-primary-900/20', 'border-primary-500');
      button.classList.remove('border-surface-200', 'dark:border-surface-700');
      customInput.value = '';
      ratioHidden.value = button.dataset.ratio;
    };

    ratioButtons.forEach((btn) => {
      btn.addEventListener('click', () => setActiveRatioButton(btn));
    });

    customInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (Number.isInteger(val) && val > 0 && val % 2 === 1) {
        resetRatioButtons();
        ratioHidden.value = String(val);
      }
    });

    const defaultBtn = document.querySelector('[data-ratio="3"]');
    if (defaultBtn) setActiveRatioButton(defaultBtn);
  }

  function recalcDomain(domainId) {
    const domIdx = state.domains.findIndex(d => d.id === domainId);
    if (domIdx === -1) return;
    const dom = state.domains[domIdx];

    if (domainId === 1 && dom.bounds) {
      const grid = WRFDomain.calcGrid(dom.bounds, dom.dx, dom.dy);
      dom.e_we = grid.e_we;
      dom.e_sn = grid.e_sn;
      dom.ref_lat = grid.ref_lat;
      dom.ref_lon = grid.ref_lon;

      // Projection params
      const projParams = WRFDomain.calcProjectionParams(state.mapProj, grid.ref_lat, grid.ref_lon);
      state.truelat1 = projParams.truelat1;
      state.truelat2 = projParams.truelat2;
      state.standLon = projParams.stand_lon;

      // Update UI
      document.getElementById('ref-lat').value = grid.ref_lat;
      document.getElementById('ref-lon').value = grid.ref_lon;
      document.getElementById('e-we').value = grid.e_we;
      document.getElementById('e-sn').value = grid.e_sn;
      document.getElementById('truelat1').value = state.truelat1;
      document.getElementById('truelat2').value = state.truelat2;
      document.getElementById('stand-lon').value = state.standLon;

      // Update info
      const rotation = WRFDomain.calcRotation(state.mapProj, state.standLon, dom.ref_lon);
      document.getElementById('d01-info').textContent =
        `${grid.e_we}×${grid.e_sn} | ${dom.dx/1000}km | ${rotation}° rotation`;
    } else if (domainId > 1 && dom.bounds) {
      // Nest domain calculation
      const parent = state.domains.find(d => d.id === dom.parent_id);
      if (!parent || !parent.bounds) return;

      const nestParams = WRFDomain.calcNest(parent, dom.bounds, dom.parent_grid_ratio);
      dom.e_we = nestParams.e_we;
      dom.e_sn = nestParams.e_sn;
      dom.dx = nestParams.dx;
      dom.dy = nestParams.dy;
      dom.i_parent_start = nestParams.i_parent_start;
      dom.j_parent_start = nestParams.j_parent_start;
      dom.ref_lat = nestParams.ref_lat;
      dom.ref_lon = nestParams.ref_lon;

      // Validate
      const errors = WRFDomain.validateNest(parent, dom.bounds, dom.parent_grid_ratio);
      WRFMap.setDomainValidation(domainId, errors.length === 0);

      // Update domain card info
      const infoEl = document.getElementById(`d${WRFUtils.pad(domainId, 2)}-info`);
      if (infoEl) {
        if (errors.length > 0) {
          infoEl.textContent = errors[0];
          infoEl.classList.add('text-red-500');
        } else {
          const rotation = WRFDomain.calcRotation(state.mapProj, state.standLon, dom.ref_lon);
          infoEl.textContent = `${dom.e_we}×${dom.e_sn} | ${(dom.dx/1000).toFixed(1)}km | ${rotation}° | ratio ${dom.parent_grid_ratio}:1`;
          infoEl.classList.remove('text-red-500');
        }
      }
    }

    updateSummary();
    saveState();
  }

  function syncManualInputs() {
    const refLat = parseFloat(document.getElementById('ref-lat').value);
    const refLon = parseFloat(document.getElementById('ref-lon').value);
    const eWe = parseInt(document.getElementById('e-we').value);
    const eSn = parseInt(document.getElementById('e-sn').value);
    const eVert = parseInt(document.getElementById('e-vert').value);

    if (!isNaN(refLat)) state.domains[0].ref_lat = refLat;
    if (!isNaN(refLon)) state.domains[0].ref_lon = refLon;
    if (!isNaN(eWe) && eWe >= 10) state.domains[0].e_we = eWe;
    if (!isNaN(eSn) && eSn >= 10) state.domains[0].e_sn = eSn;
    if (!isNaN(eVert) && eVert >= 28) state.eVert = eVert;

    const tl1 = parseFloat(document.getElementById('truelat1').value);
    const tl2 = parseFloat(document.getElementById('truelat2').value);
    const slon = parseFloat(document.getElementById('stand-lon').value);
    if (!isNaN(tl1)) state.truelat1 = tl1;
    if (!isNaN(tl2)) state.truelat2 = tl2;
    if (!isNaN(slon)) state.standLon = slon;

    // If we have ref_lat/lon and e_we/e_sn but no bounds yet, compute approximate bounds
    if (state.domains[0].ref_lat && state.domains[0].ref_lon && !state.domains[0].bounds) {
      const dom = state.domains[0];
      const halfW = (dom.e_we * dom.dx / 2) / 111000; // rough deg
      const halfH = (dom.e_sn * dom.dy / 2) / 111000;
      const bounds = {
        south: dom.ref_lat - halfH,
        north: dom.ref_lat + halfH,
        west: dom.ref_lon - halfW / Math.cos(dom.ref_lat * Math.PI / 180),
        east: dom.ref_lon + halfW / Math.cos(dom.ref_lat * Math.PI / 180)
      };
      dom.bounds = bounds;
      WRFMap.setDomainRect(1, bounds.south, bounds.north, bounds.west, bounds.east);
      WRFMap.fitBounds();
    }

    updateSummary();
    saveState();
  }

  function updateProjectionFields() {
    const sect = document.getElementById('truelat-section');
    const isLatLon = state.mapProj === 'lat-lon';
    sect.style.display = isLatLon ? 'none' : '';
    document.getElementById('stand-lon').closest('.space-y-2').style.display = isLatLon ? 'none' : '';
  }

  // ===== Nesting =====
  function openNestModal() {
    if (state.domains.length >= 4) {
      alert('Maximum 4 domains supported.');
      return;
    }
    if (!state.domains[0].bounds) {
      alert('Please draw the parent domain (d01) on the map first.');
      return;
    }

    // Populate parent dropdown
    const sel = document.getElementById('nest-parent');
    sel.innerHTML = '';
    state.domains.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `d${WRFUtils.pad(d.id, 2)} (${(d.dx/1000).toFixed(1)} km)`;
      sel.appendChild(opt);
    });

    const ratioHidden = document.getElementById('nest-ratio');
    const customInput = document.getElementById('nest-ratio-custom');
    if (ratioHidden) ratioHidden.value = '3';
    if (customInput) customInput.value = '';
    document.querySelectorAll('[data-ratio]').forEach((b) => {
      b.classList.remove('bg-primary-50', 'dark:bg-primary-900/20', 'border-primary-500');
      b.classList.add('border-surface-200', 'dark:border-surface-700');
    });
    const defaultBtn = document.querySelector('[data-ratio="3"]');
    if (defaultBtn) {
      defaultBtn.classList.add('bg-primary-50', 'dark:bg-primary-900/20', 'border-primary-500');
      defaultBtn.classList.remove('border-surface-200', 'dark:border-surface-700');
    }

    document.getElementById('nest-modal').classList.remove('hidden');
  }

  function closeNestModal() {
    document.getElementById('nest-modal').classList.add('hidden');
  }

  function confirmAddNest() {
    const parentId = parseInt(document.getElementById('nest-parent').value);
    const ratio = parseInt(document.getElementById('nest-ratio').value, 10);
    const parent = state.domains.find(d => d.id === parentId);

    if (!parent) {
      showToast('Parent domain not found.', 'warning');
      return;
    }
    if (!Number.isInteger(ratio) || ratio < 1 || ratio % 2 === 0) {
      showToast('Grid ratio must be a positive odd number (e.g. 3, 5, 7).', 'warning');
      return;
    }

    const newId = Math.max(...state.domains.map(d => d.id)) + 1;

    state.domains.push({
      id: newId,
      parent_id: parentId,
      parent_grid_ratio: ratio,
      i_parent_start: 1,
      j_parent_start: 1,
      e_we: 100,
      e_sn: 100,
      dx: parent.dx / ratio,
      dy: parent.dy / ratio,
      ref_lat: parent.ref_lat,
      ref_lon: parent.ref_lon,
      bounds: null
    });

    renderDomainList();
    closeNestModal();

    // Set draw tool to new domain color
    WRFMap.setActiveDrawDomain(newId);

    saveState();
  }

  function removeDomain(domainId) {
    if (domainId === 1) return;

    // Remove this domain and any children
    const toRemove = [domainId];
    let changed = true;
    while (changed) {
      changed = false;
      state.domains.forEach(d => {
        if (toRemove.includes(d.parent_id) && !toRemove.includes(d.id)) {
          toRemove.push(d.id);
          changed = true;
        }
      });
    }

    toRemove.forEach(id => {
      WRFMap.removeDomainLayer(id);
    });

    state.domains = state.domains.filter(d => !toRemove.includes(d.id));
    renderDomainList();
    saveState();
  }

  function renderDomainList() {
    const container = document.getElementById('domain-list');
    container.innerHTML = '';

    state.domains.forEach((dom, idx) => {
      const card = document.createElement('div');
      card.className = 'domain-card' + (dom.bounds ? '' : ' opacity-70');
      card.dataset.domain = dom.id;

      const dStr = `d${WRFUtils.pad(dom.id, 2)}`;
      let infoText = dom.id === 1 ? 'Parent domain' : `Nest of d${WRFUtils.pad(dom.parent_id, 2)} | ratio ${dom.parent_grid_ratio}:1`;
      if (dom.bounds) {
        infoText = `${dom.e_we}×${dom.e_sn} | ${(dom.dx/1000).toFixed(1)}km`;
        if (dom.id > 1) infoText += ` | ratio ${dom.parent_grid_ratio}:1`;
      } else if (dom.id > 1) {
        infoText += ' — draw on map';
      }

      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="domain-badge" style="background: ${WRFDomain.getColor(idx)}">${dStr}</span>
            <span class="text-xs text-surface-400" id="${dStr}-info">${infoText}</span>
          </div>
          ${dom.id > 1 ? `<button class="text-xs text-red-400 hover:text-red-600 px-2" data-remove="${dom.id}" title="Remove domain">✕</button>` : ''}
        </div>
      `;

      // Click to activate draw for this domain
      card.addEventListener('click', (e) => {
        if (e.target.dataset.remove) {
          removeDomain(parseInt(e.target.dataset.remove));
          return;
        }
        WRFMap.setActiveDrawDomain(dom.id);
        document.querySelectorAll('.domain-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      });

      container.appendChild(card);
    });

    // Rebind remove buttons
    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeDomain(parseInt(e.target.dataset.remove));
      });
    });
  }

  // ===== Time & Data (Step 2) =====
  function initTimeUI() {
    // Default start date: today
    const today = new Date();
    const todayStr = `${today.getUTCFullYear()}-${WRFUtils.pad(today.getUTCMonth() + 1, 2)}-${WRFUtils.pad(today.getUTCDate(), 2)}`;
    if (!state.startDateStr) state.startDateStr = todayStr;

    document.getElementById('start-date').value = state.startDateStr;
    document.getElementById('start-hour').value = state.startHour;
    document.getElementById('run-duration').value = state.durationHours;
    document.getElementById('start-fh').value = state.startForecastHour || 0;

    // GFS interval selector
    const gfsIntervalSel = document.getElementById('gfs-interval');
    if (gfsIntervalSel) {
      gfsIntervalSel.value = String(state.gfsInterval || 3);
      gfsIntervalSel.addEventListener('change', (e) => {
        state.gfsInterval = parseInt(e.target.value);
        updateTimeConstraints();
        recalcTime();
      });
    }

    // Data source radio buttons
    document.querySelectorAll('input[name="data-source"]').forEach(radio => {
      radio.checked = radio.value === state.dataSource;
      radio.addEventListener('change', () => {
        state.dataSource = radio.value;
        updateTimeConstraints();
        recalcTime();
      });
    });

    document.getElementById('start-date').addEventListener('change', (e) => {
      state.startDateStr = e.target.value;
      recalcTime();
    });
    document.getElementById('start-hour').addEventListener('change', (e) => {
      state.startHour = parseInt(e.target.value);
      recalcTime();
    });
    document.getElementById('run-duration').addEventListener('change', (e) => {
      state.durationHours = parseInt(e.target.value) || 24;
      recalcTime();
    });
    document.getElementById('start-fh').addEventListener('change', (e) => {
      state.startForecastHour = parseInt(e.target.value) || 0;
      recalcTime();
    });

    updateTimeConstraints();
    recalcTime();
  }

  function updateTimeConstraints() {
    const src = WRFDateTime.DATA_SOURCES[state.dataSource];
    const hourSelect = document.getElementById('start-hour');
    const durationInput = document.getElementById('run-duration');
    const gfsIntervalRow = document.getElementById('gfs-interval-row');
    const startFhRow = document.getElementById('start-fh-row');
    const startFhInput = document.getElementById('start-fh');

    // GFS-only fields: hide for ERA5
    const isGFS = state.dataSource === 'GFS';
    if (gfsIntervalRow) gfsIntervalRow.style.display = isGFS ? '' : 'none';
    if (startFhRow) startFhRow.style.display = isGFS ? '' : 'none';

    // Update available hours
    const hours = WRFDateTime.getStartHours(state.dataSource);
    hourSelect.innerHTML = '';
    hours.forEach(h => {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = WRFUtils.pad(h, 2) + 'Z';
      hourSelect.appendChild(opt);
    });

    // Ensure current selection is valid
    if (!hours.includes(state.startHour)) {
      state.startHour = hours[0];
    }
    hourSelect.value = state.startHour;

    // GFS: interval and max duration depend on gfsInterval selection
    let maxDuration = src.maxDurationHours;
    let intervalSec = src.intervalSeconds;
    if (state.dataSource === 'GFS' && state.gfsInterval === 1) {
      maxDuration = 120;
      intervalSec = 3600;
    }

    // Update start-fh step to match interval
    if (startFhInput) startFhInput.step = state.dataSource === 'GFS' ? (state.gfsInterval || 3) : 1;

    // Duration max
    durationInput.max = maxDuration;
    if (state.durationHours > maxDuration) {
      state.durationHours = maxDuration;
      durationInput.value = state.durationHours;
    }

    // Interval
    state.intervalSeconds = intervalSec;
  }

  function recalcTime() {
    if (!state.startDateStr) return;

    const dur = WRFDateTime.splitDuration(state.durationHours);
    state.startDate = new Date(state.startDateStr + 'T' + WRFUtils.pad(state.startHour, 2) + ':00:00Z');
    state.endDate = WRFDateTime.calcEndDate(state.startDateStr, state.startHour, state.durationHours);

    document.getElementById('computed-run-days').textContent = dur.run_days;
    document.getElementById('computed-run-hours').textContent = dur.run_hours;
    document.getElementById('computed-interval').textContent = state.intervalSeconds;
    document.getElementById('computed-end-date').textContent = WRFUtils.toDisplayDate(state.endDate);

    // Validate
    const warnings = WRFDateTime.validate(state.dataSource, state.startDateStr, state.durationHours);
    const warningDiv = document.getElementById('time-warnings');
    const warningText = document.getElementById('time-warning-text');
    if (warnings.length > 0) {
      warningText.textContent = warnings.join(' ');
      warningDiv.classList.remove('hidden');
    } else {
      warningDiv.classList.add('hidden');
    }

    saveState();
  }

  // ===== Physics (Step 3) =====
  function initPhysicsUI() {
    // Populate dropdowns
    Object.entries(WRFPhysics.schemes).forEach(([param, options]) => {
      const selectId = param.replace(/_/g, '-');
      const select = document.getElementById(selectId);
      if (!select) return;

      select.innerHTML = '';
      options.forEach(opt => {
        const el = document.createElement('option');
        el.value = opt.id;
        el.textContent = `${opt.id} — ${opt.name}`;
        if (opt.rec) el.textContent += ' ★';
        select.appendChild(el);
      });

      // Set current value
      select.value = state.physics[param];

      // Change handler
      select.addEventListener('change', () => {
        state.physics[param] = parseInt(select.value);
        validatePhysics();
        saveState();
      });
    });

    // Recommended defaults button
    document.getElementById('btn-defaults').addEventListener('click', () => {
      state.physics = WRFPhysics.getDefaults();
      Object.entries(state.physics).forEach(([param, val]) => {
        const selectId = param.replace(/_/g, '-');
        const select = document.getElementById(selectId);
        if (select) select.value = val;
      });
      validatePhysics();
      saveState();
    });
  }

  function updatePhysicsUI() {
    // Update values from state
    Object.entries(state.physics).forEach(([param, val]) => {
      const selectId = param.replace(/_/g, '-');
      const select = document.getElementById(selectId);
      if (select) select.value = val;
    });

    // Resolution hint
    const dxKm = state.domains[0].dx / 1000;
    const hintEl = document.getElementById('resolution-hint-text');
    if (dxKm > 10) {
      hintEl.textContent = `Your grid spacing is ${dxKm} km. A cumulus parameterization is required at this resolution.`;
    } else if (dxKm < 4) {
      hintEl.textContent = `Your grid spacing is ${dxKm} km. Cumulus parameterization is not needed at this resolution (set to None).`;
    } else {
      hintEl.textContent = `Your grid spacing is ${dxKm} km (gray zone: 4-10 km). Consider scale-aware schemes like Grell-Freitas (3) or MSKF (11).`;
    }

    validatePhysics();
  }

  function validatePhysics() {
    const warnings = WRFPhysics.validate(
      state.physics.bl_pbl_physics,
      state.physics.sf_sfclay_physics,
      state.physics.cu_physics,
      state.domains[0].dx
    );

    const warnDiv = document.getElementById('physics-warnings');
    const warnList = document.getElementById('physics-warning-list');

    if (warnings.length > 0) {
      warnList.innerHTML = warnings.map(w => `<li>${w}</li>`).join('');
      warnDiv.classList.remove('hidden');
    } else {
      warnDiv.classList.add('hidden');
    }
  }

  // ===== Namelists (Step 4) =====
  function initNamelistUI() {
    // Tab switching
    document.querySelectorAll('.namelist-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.namelist-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.namelist-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
      });
    });

    // Advanced settings toggle
    document.getElementById('btn-advanced-toggle').addEventListener('click', () => {
      const panel = document.getElementById('advanced-panel');
      const icon = document.getElementById('advanced-toggle-icon');
      panel.classList.toggle('hidden');
      icon.style.transform = panel.classList.contains('hidden') ? '' : 'rotate(180deg)';
    });

    // Advanced panel tab switching
    document.querySelectorAll('.adv-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.adv-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.adv-tab-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.advTab).classList.remove('hidden');
      });
    });

    // Advanced settings inputs — each regenerates namelists on change
    const bindAdv = (id, key, transform) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', (e) => {
        state[key] = transform ? transform(e.target.value) : e.target.value;
        updateNamelists();
        saveState();
      });
    };
    bindAdv('adv-e-vert',            'eVert',                   Number);
    bindAdv('adv-p-top',             'pTop',                    Number);
    bindAdv('adv-feedback',          'feedback',                Number);
    bindAdv('adv-restart-interval',  'restartInterval',         Number);
    bindAdv('adv-w-damping',         'wDamping',                Number);
    bindAdv('adv-damp-opt',          'dampOpt',                 Number);
    bindAdv('adv-damp-coef',         'dampCoef',                parseFloat);
    bindAdv('adv-diff-opt',          'diffOpt',                 Number);
    bindAdv('adv-km-opt',            'kmOpt',                   Number);
    bindAdv('adv-diff-6th-opt',      'diff6thOpt',              Number);
    bindAdv('adv-zdamp',             'zdamp',                   Number);
    bindAdv('adv-history-interval',  'historyInterval',         v => v ? Number(v) : null);
    bindAdv('adv-interval-seconds',  'intervalSecondsOverride', v => v ? Number(v) : null);
    bindAdv('adv-frames-per-outfile','framesPerOutfile',        Number);
    bindAdv('adv-debug-level',       'debugLevel',              Number);
    bindAdv('adv-eta-levels',        'etaLevels',               v => v.trim());
    bindAdv('adv-shcu-physics',      'shcuPhysics',             Number);
    bindAdv('adv-sf-urban-physics',  'sfUrbanPhysics',          Number);
    bindAdv('adv-sf-lake-physics',   'sfLakePhysics',           Number);
    bindAdv('adv-sst-update',        'sstUpdate',               Number);
    bindAdv('adv-geog-path',         'geogDataPath',            v => v || '/path/to/WPS_GEOG/');
  }

  function syncAdvancedUI() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (!el || val === null || val === undefined) return;
      el.value = val;
    };
    setVal('adv-e-vert',             state.eVert);
    setVal('adv-p-top',              state.pTop);
    setVal('adv-feedback',           state.feedback);
    setVal('adv-restart-interval',   state.restartInterval);
    setVal('adv-w-damping',          state.wDamping);
    setVal('adv-damp-opt',           state.dampOpt);
    setVal('adv-damp-coef',          state.dampCoef);
    setVal('adv-diff-opt',           state.diffOpt);
    setVal('adv-km-opt',             state.kmOpt);
    setVal('adv-diff-6th-opt',       state.diff6thOpt);
    setVal('adv-zdamp',              state.zdamp);
    setVal('adv-history-interval',   state.historyInterval || '');
    setVal('adv-interval-seconds',   state.intervalSecondsOverride || '');
    setVal('adv-frames-per-outfile', state.framesPerOutfile);
    setVal('adv-debug-level',        state.debugLevel);
    setVal('adv-eta-levels',         state.etaLevels || '');
    setVal('adv-shcu-physics',       state.shcuPhysics);
    setVal('adv-sf-urban-physics',   state.sfUrbanPhysics);
    setVal('adv-sf-lake-physics',    state.sfLakePhysics);
    setVal('adv-sst-update',         state.sstUpdate);
  }

  function updateNamelists() {
    if (!state.startDate || !state.domains[0].bounds) {
      document.getElementById('namelist-wps-output').textContent = '⚠ Configure domains and time settings first.';
      document.getElementById('namelist-input-output').textContent = '⚠ Configure domains and time settings first.';
      return;
    }

    const wpsText = WRFNamelistWPS.generate(state);
    const inputText = WRFNamelistInput.generate(state);

    document.getElementById('namelist-wps-output').textContent = wpsText;
    document.getElementById('namelist-input-output').textContent = inputText;
  }

  // ===== Scripts (Step 5) =====
  function initScriptUI() {
    // Tab switching
    document.querySelectorAll('.script-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.script-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.script-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
      });
    });

    // WRF/WPS path inputs
    document.getElementById('wps-dir').addEventListener('change', (e) => {
      state.wpsDir = e.target.value || '/path/to/WPS';
      updateScripts();
      saveState();
    });
    document.getElementById('wrf-dir').addEventListener('change', (e) => {
      state.wrfDir = e.target.value || '/path/to/WRF';
      updateScripts();
      saveState();
    });
    document.getElementById('download-data-dir').addEventListener('change', (e) => {
      state.downloadDataDir = e.target.value || './wrf_data';
      updateScripts();
      saveState();
    });
    document.getElementById('output-dir').addEventListener('change', (e) => {
      state.outputDir = e.target.value || './wrf_output';
      updateScripts();
      saveState();
    });

    // Scheduler mode radios
    document.querySelectorAll('input[name="scheduler"]').forEach(radio => {
      radio.addEventListener('change', () => {
        state.scheduler = radio.value;
        document.getElementById('slurm-options').classList.toggle('hidden', radio.value !== 'slurm');
        updateScripts();
        saveState();
      });
    });

    // Scheduler field helpers
    const bindSched = (id, key, transform) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', (e) => {
        state[key] = transform ? transform(e.target.value) : e.target.value;
        updateScripts();
        saveState();
      });
    };
    bindSched('num-procs',           'numProcs',          Number);
    bindSched('slurm-partition',     'slurmPartition',    null);
    bindSched('slurm-nodes',         'slurmNodes',        Number);
    bindSched('slurm-ntasks-per-node','slurmNtasksPerNode',Number);
    bindSched('slurm-walltime',      'slurmWalltime',     null);
    bindSched('slurm-account',       'slurmAccount',      null);

    // Download All button
    document.getElementById('btn-download-all').addEventListener('click', () => {
      if (!state.startDate || !state.domains[0].bounds) {
        showToast('Configure domains and time settings first.', 'warning');
        return;
      }
      const wps = WRFNamelistWPS.generate(state);
      const input = WRFNamelistInput.generate(state);
      const dl = WRFDownloadScripts.generate(state);
      const run = WRFRunScript.generate(state);
      const runFilename = WRFRunScript.getFilename(state);
      WRFUtils.downloadFile('namelist.wps', wps);
      setTimeout(() => WRFUtils.downloadFile('namelist.input', input), 200);
      setTimeout(() => WRFUtils.downloadFile(WRFDownloadScripts.getFilename(state.dataSource), dl), 400);
      setTimeout(() => WRFUtils.downloadFile(runFilename, run), 600);
      showToast('All files downloaded!', 'success');
    });
  }

  function updateScripts() {
    if (!state.startDate || !state.domains[0].bounds) {
      document.getElementById('download-script-output').textContent = '⚠ Configure domains and time settings first.';
      document.getElementById('run-script-output').textContent = '⚠ Configure domains and time settings first.';
      return;
    }

    // Download script
    const dlScript = WRFDownloadScripts.generate(state);
    document.getElementById('download-script-output').textContent = dlScript;
    document.getElementById('download-script-info').textContent = WRFDownloadScripts.getInfo(state.dataSource);

    // Set download button filename
    const dlBtn = document.querySelector('#tab-download-script .btn-download');
    if (dlBtn) dlBtn.dataset.filename = WRFDownloadScripts.getFilename(state.dataSource);

    // Run script — filename changes for Slurm
    const runScript = WRFRunScript.generate(state);
    document.getElementById('run-script-output').textContent = runScript;
    const runDlBtn = document.querySelector('#tab-run-script .btn-download');
    if (runDlBtn) runDlBtn.dataset.filename = WRFRunScript.getFilename(state);
  }

  // ===== Copy / Download Buttons =====
  function initCopyDownload() {
    document.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.btn-copy');
      if (copyBtn) {
        const targetId = copyBtn.dataset.target;
        const text = document.getElementById(targetId).textContent;
        WRFUtils.copyToClipboard(text).then(() => {
          copyBtn.classList.add('copied');
          const origHTML = copyBtn.innerHTML;
          copyBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = origHTML;
          }, 2000);
        });
        return;
      }

      const dlBtn = e.target.closest('.btn-download');
      if (dlBtn) {
        const targetId = dlBtn.dataset.target;
        const text = document.getElementById(targetId).textContent;
        const filename = dlBtn.dataset.filename || 'output.txt';
        WRFUtils.downloadFile(filename, text);
        return;
      }
    });
  }

  // ===== Summary Panel =====
  function updateSummary() {
    const el = document.getElementById('summary-content');
    if (!el) return;

    const dom = state.domains[0];
    if (!dom.bounds) {
      el.innerHTML = '<p class="italic">Draw a domain on the map to begin.</p>';
      return;
    }

    let html = `
      <div class="space-y-1.5">
        <div><span class="font-medium text-surface-600 dark:text-surface-300">Projection:</span> ${state.mapProj}</div>
        <div><span class="font-medium text-surface-600 dark:text-surface-300">Domains:</span> ${state.domains.length}</div>
        <div><span class="font-medium text-surface-600 dark:text-surface-300">d01:</span> ${dom.e_we}×${dom.e_sn} @ ${dom.dx/1000}km</div>
    `;

    state.domains.slice(1).forEach((d, i) => {
      html += `<div><span class="font-medium text-surface-600 dark:text-surface-300">d${WRFUtils.pad(d.id, 2)}:</span> ${d.e_we}×${d.e_sn} @ ${(d.dx/1000).toFixed(1)}km</div>`;
    });

    html += `
        <div class="mt-2 pt-2 border-t border-surface-200 dark:border-surface-700">
          <span class="font-medium text-surface-600 dark:text-surface-300">Center:</span> ${dom.ref_lat}°, ${dom.ref_lon}°
        </div>
    `;

    if (state.startDate) {
      html += `
        <div><span class="font-medium text-surface-600 dark:text-surface-300">Source:</span> ${state.dataSource}</div>
        <div><span class="font-medium text-surface-600 dark:text-surface-300">Period:</span> ${state.durationHours}h</div>
      `;
    }

    html += '</div>';
    el.innerHTML = html;
  }

  // ===== Share / Export / Import =====
  function initShareImport() {
    const modal      = document.getElementById('share-modal');
    const backdrop   = document.getElementById('share-modal-backdrop');
    const closeBtn   = document.getElementById('share-modal-close');
    const urlInput   = document.getElementById('share-url-input');
    const copyBtn    = document.getElementById('btn-copy-link');
    const downloadBtn= document.getElementById('btn-download-json');
    const fileInput  = document.getElementById('import-json-file');
    const shareBtn   = document.getElementById('btn-share');
    const importBtn  = document.getElementById('btn-import');

    const openModal = () => {
      const encoded = serializeState();
      urlInput.value = `${location.origin}${location.pathname}?s=${encoded}`;
      modal.classList.remove('hidden');
    };
    const closeModal = () => modal.classList.add('hidden');

    shareBtn.addEventListener('click', openModal);
    importBtn.addEventListener('click', () => fileInput.click());
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(urlInput.value).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      });
    });

    downloadBtn.addEventListener('click', () => {
      const s = { ...state };
      s.startDate = s.startDate ? s.startDate.toISOString() : null;
      s.endDate   = s.endDate   ? s.endDate.toISOString()   : null;
      const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wrflow-config.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const s = JSON.parse(ev.target.result);
          s.startDate = s.startDate ? new Date(s.startDate) : null;
          s.endDate   = s.endDate   ? new Date(s.endDate)   : null;
          if (!WRFDateTime.DATA_SOURCES[s.dataSource]) s.dataSource = 'GFS';
          Object.assign(state, s);
          saveState();
          closeModal();
          restoreFromState();
          showToast('Configuration imported successfully.', 'info');
        } catch {
          showToast('Failed to import: invalid JSON file.', 'warning');
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });
  }

  // ===== Reset =====
  function initReset() {
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (confirm('Reset all configuration? This cannot be undone.')) {
        sessionStorage.removeItem('wrflow-state');
        location.reload();
      }
    });
  }

  // ===== Navigation Buttons =====
  function initNavButtons() {
    document.querySelectorAll('.btn-next').forEach(btn => {
      btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.next)));
    });
    document.querySelectorAll('.btn-prev').forEach(btn => {
      btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.prev)));
    });
    document.querySelectorAll('.wizard-step-btn').forEach(btn => {
      btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.step)));
    });
    document.querySelectorAll('.mobile-tab').forEach(btn => {
      btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.step)));
    });
    const logoBtn = document.getElementById('btn-logo-home');
    if (logoBtn) logoBtn.addEventListener('click', () => goToStep(1));
    const getStartedBtn = document.getElementById('btn-get-started');
    if (getStartedBtn) getStartedBtn.addEventListener('click', () => goToStep(1));
  }

  // ===== Restore from State =====
  function restoreFromState() {
    // Restore domain rectangles on map
    state.domains.forEach(dom => {
      if (dom.bounds) {
        WRFMap.setDomainRect(dom.id, dom.bounds.south, dom.bounds.north, dom.bounds.west, dom.bounds.east);
      }
    });
    if (state.domains[0].bounds) {
      WRFMap.fitBounds();
    }

    // Restore UI values
    document.getElementById('map-proj').value = state.mapProj;
    document.getElementById('dx').value = state.domains[0].dx;
    document.getElementById('dy').value = state.domains[0].dy;
    document.getElementById('e-vert').value = state.eVert;

    if (state.domains[0].ref_lat) document.getElementById('ref-lat').value = state.domains[0].ref_lat;
    if (state.domains[0].ref_lon) document.getElementById('ref-lon').value = state.domains[0].ref_lon;
    if (state.domains[0].e_we) document.getElementById('e-we').value = state.domains[0].e_we;
    if (state.domains[0].e_sn) document.getElementById('e-sn').value = state.domains[0].e_sn;

    document.getElementById('truelat1').value = state.truelat1;
    document.getElementById('truelat2').value = state.truelat2;
    document.getElementById('stand-lon').value = state.standLon;

    // Restore WRF paths
    document.getElementById('wps-dir').value = state.wpsDir;
    document.getElementById('wrf-dir').value = state.wrfDir;
    document.getElementById('download-data-dir').value = state.downloadDataDir || './wrf_data';
    document.getElementById('output-dir').value = state.outputDir || './wrf_output';

    // Restore advanced settings
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('adv-e-vert',           state.eVert);
    setVal('adv-p-top',            state.pTop);
    setVal('adv-feedback',         state.feedback);
    setVal('adv-restart-interval', state.restartInterval);
    setVal('adv-w-damping',        state.wDamping);
    setVal('adv-damp-opt',         state.dampOpt);
    setVal('adv-damp-coef',        state.dampCoef);
    setVal('adv-diff-opt',         state.diffOpt);
    if (state.historyInterval) setVal('adv-history-interval', state.historyInterval);
    setVal('adv-geog-path',        state.geogDataPath);

    // Restore scheduler
    const schedRadio = document.querySelector(`input[name="scheduler"][value="${state.scheduler}"]`);
    if (schedRadio) schedRadio.checked = true;
    document.getElementById('slurm-options').classList.toggle('hidden', state.scheduler !== 'slurm');
    setVal('num-procs',             state.numProcs);
    setVal('slurm-partition',       state.slurmPartition);
    setVal('slurm-nodes',           state.slurmNodes);
    setVal('slurm-ntasks-per-node', state.slurmNtasksPerNode);
    setVal('slurm-walltime',        state.slurmWalltime);
    setVal('slurm-account',         state.slurmAccount);

    updateProjectionFields();
    renderDomainList();
    updateSummary();

    // Restore step
    goToStep(state.currentStep);
  }

  // ===== Init =====
  function init() {
    // Check for a shared config in the URL (?s=...)
    const urlParams   = new URLSearchParams(location.search);
    const sharedParam = urlParams.get('s');
    let hadState = false;
    if (sharedParam) {
      try {
        deserializeState(sharedParam);
        history.replaceState(null, '', location.pathname);
        hadState = true;
        saveState();
      } catch { /* ignore malformed param */ }
    } else {
      hadState = loadState();
    }

    initTheme();
    initTooltips();
    initNavButtons();
    initReset();
    initCopyDownload();
    initShareImport();

    WRFMap.init();

    initDomainUI();
    initTimeUI();
    initPhysicsUI();
    initNamelistUI();
    initScriptUI();

    if (hadState) {
      restoreFromState();
    } else {
      renderDomainList();
      updateProjectionFields();
      goToStep(0);
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  return { state, goToStep };
})();
