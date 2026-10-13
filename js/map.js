/**
 * WRFlow — Leaflet Map Module
 * Rectangle selection with projected WRF footprints and grid-aware editing.
 */
const WRFMap = (() => {
  let map = null;
  let drawControl = null;
  let drawnItems = null;
  const domainLayers = {};
  const geometries = {};
  let activeDomainId = 1;
  let editing = false;
  let editButton = null;
  let handles = null;
  let draggingHandle = null;
  const markers = {};

  function init() {
    map = L.map('map', { center: [39, 35], zoom: 5 });
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>', maxZoom: 18
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> | &copy; OpenTopoMap', maxZoom: 17
    });
    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri', maxZoom: 18
    });
    osm.addTo(map);
    L.control.layers({ 'Street (OSM)': osm, 'Topographic': topo, 'Satellite': esriSat }, {}, { position: 'topright' }).addTo(map);
    drawnItems = L.featureGroup().addTo(map);
    handles = L.featureGroup().addTo(map);
    updateDrawControl();

    // Generic polygon editing would distort the rectangular WRF grid. Use a
    // center move handle and four corners that resize in the projection plane.
    const EditControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar wrf-edit-control');
        editButton = L.DomUtil.create('a', '', container);
        editButton.href = '#';
        editButton.setAttribute('role', 'button');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(editButton, 'click', e => {
          L.DomEvent.preventDefault(e);
          if (geometries[activeDomainId]) setEditing(!editing);
        });
        updateEditButton();
        return container;
      }
    });
    new EditControl().addTo(map);

    map.on('mousemove', e => {
      const el = document.getElementById('map-coords');
      if (el) el.textContent = `Lat: ${e.latlng.lat.toFixed(4)}  Lon: ${WRFProjection.normalizeLon(e.latlng.lng).toFixed(4)}`;
    });
    map.on(L.Draw.Event.DRAWSTART, () => setEditing(false));
    map.on(L.Draw.Event.CREATED, e => {
      const bounds = e.layer.getBounds();
      // The temporary rectangle is only a selection gesture, never a footprint.
      document.dispatchEvent(new CustomEvent('domain-updated', {
        detail: { domainId: activeDomainId, bounds: {
          south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast()
        } }
      }));
    });
  }

  function updateDrawControl() {
    if (!map) return;
    if (drawControl) map.removeControl(drawControl);
    drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polyline: false, polygon: false, circle: false, marker: false, circlemarker: false,
        rectangle: { showArea: false, shapeOptions: {
          color: WRFDomain.getColor(activeDomainId - 1), weight: 3, fillOpacity: 0.08
        } }
      },
      edit: false
    });
    map.addControl(drawControl);
  }

  function updateEditButton() {
    if (!editButton) return;
    const available = !!geometries[activeDomainId];
    editButton.textContent = editing ? '✓' : '✎';
    editButton.title = editing ? 'Finish editing domain' : 'Edit active domain: drag center to move, corners to resize';
    editButton.setAttribute('aria-label', editButton.title);
    editButton.setAttribute('aria-pressed', String(editing));
    editButton.setAttribute('aria-disabled', String(!available));
    editButton.classList.toggle('wrf-edit-active', editing);
    editButton.classList.toggle('wrf-edit-disabled', !available);
  }

  function setEditing(enabled) {
    editing = enabled;
    handles.clearLayers();
    Object.keys(markers).forEach(key => delete markers[key]);
    draggingHandle = null;
    updateEditButton();
    if (editing && geometries[activeDomainId]) createHandles();
  }

  function handlePoints(geometry) {
    const { xMin, xMax, yMin, yMax, projection } = geometry;
    const coords = {
      center: [(xMin + xMax) / 2, (yMin + yMax) / 2],
      sw: [xMin, yMin], se: [xMax, yMin], ne: [xMax, yMax], nw: [xMin, yMax]
    };
    return Object.fromEntries(Object.entries(coords).map(([key, [x, y]]) => {
      const p = projection.inverse(x, y);
      return [key, [p.lat, WRFProjection.unwrapLon(p.lon, geometry.center.lon)]];
    }));
  }

  function createHandles() {
    const geometry = geometries[activeDomainId];
    Object.entries(handlePoints(geometry)).forEach(([key, latlng]) => {
      const marker = L.marker(latlng, {
        draggable: true,
        autoPan: true,
        title: key === 'center' ? 'Move domain' : 'Resize domain',
        icon: L.divIcon({ className: `wrf-domain-handle ${key === 'center' ? 'wrf-move-handle' : ''}`,
          html: key === 'center' ? '✥' : '', iconSize: [16, 16], iconAnchor: [8, 8] })
      }).addTo(handles);
      let original, projectedRect, valid;
      marker.on('dragstart', () => {
        original = geometries[activeDomainId];
        projectedRect = null;
        draggingHandle = key;
      });
      marker.on('drag', () => {
        valid = false;
        try {
          const latlon = marker.getLatLng();
          const point = original.projection.forward(latlon.lat, latlon.lng);
          const rect = { xMin: original.xMin, xMax: original.xMax, yMin: original.yMin, yMax: original.yMax };
          if (key === 'center') {
            const deltaX = point.x - (original.xMin + original.xMax) / 2;
            const deltaY = point.y - (original.yMin + original.yMax) / 2;
            rect.xMin += deltaX; rect.xMax += deltaX;
            rect.yMin += deltaY; rect.yMax += deltaY;
          } else {
            if (key.includes('w')) rect.xMin = Math.min(point.x, rect.xMax - original.dx * 9);
            else rect.xMax = Math.max(point.x, rect.xMin + original.dx * 9);
            if (key.includes('s')) rect.yMin = Math.min(point.y, rect.yMax - original.dy * 9);
            else rect.yMax = Math.max(point.y, rect.yMin + original.dy * 9);
          }
          const preview = WRFDomain.rectGeometry(original.projection, rect, original.dx, original.dy);
          projectedRect = rect;
          setDomainGeometry(activeDomainId, preview);
          valid = true;
        } catch { /* Keep the last valid preview until the handle is released. */ }
      });
      marker.on('dragend', () => {
        draggingHandle = null;
        // Restore the committed geometry before asking the app to snap the edit.
        setDomainGeometry(activeDomainId, original);
        if (valid && projectedRect) document.dispatchEvent(new CustomEvent('domain-updated', {
          detail: { domainId: activeDomainId, projectedRect,
            operation: key === 'center' ? 'move' : 'resize', handle: key }
        }));
      });
      markers[key] = marker;
    });
  }

  function updateHandles() {
    if (!editing || !geometries[activeDomainId]) return;
    const points = handlePoints(geometries[activeDomainId]);
    Object.entries(markers).forEach(([key, marker]) => {
      if (key !== draggingHandle) marker.setLatLng(points[key]);
    });
  }

  function setDomainGeometry(domainId, geometry) {
    geometries[domainId] = geometry;
    if (domainLayers[domainId]) {
      domainLayers[domainId].setLatLngs(geometry.boundary);
    } else {
      const layer = L.polygon(geometry.boundary, {
        color: WRFDomain.getColor(domainId - 1), weight: domainId === 1 ? 3 : 2,
        fillOpacity: 0.06 + (domainId - 1) * 0.03, smoothFactor: 0,
        className: 'wrf-domain-outline'
      }).addTo(drawnItems);
      layer.bindTooltip(`d${WRFUtils.pad(domainId, 2)}`);
      layer.on('click', () => {
        if (draggingHandle) return;
        setActiveDrawDomain(domainId);
        document.dispatchEvent(new CustomEvent('domain-selected', { detail: { domainId } }));
      });
      domainLayers[domainId] = layer;
    }
    updateEditButton();
    if (domainId === activeDomainId) updateHandles();
  }

  function setActiveDrawDomain(domainId) {
    const wasEditing = editing;
    setEditing(false);
    activeDomainId = domainId;
    updateDrawControl();
    updateEditButton();
    if (wasEditing && geometries[domainId]) setEditing(true);
  }

  function removeDomainLayer(domainId) {
    if (domainLayers[domainId]) drawnItems.removeLayer(domainLayers[domainId]);
    delete domainLayers[domainId];
    delete geometries[domainId];
    if (activeDomainId === domainId) setActiveDrawDomain(1);
  }

  function clearDomains() {
    Object.keys(domainLayers).forEach(id => removeDomainLayer(Number(id)));
    setActiveDrawDomain(1);
  }

  function setDomainValidation(domainId, isValid) {
    const layer = domainLayers[domainId];
    if (layer) layer.setStyle({ dashArray: isValid ? null : '8,4',
      color: isValid ? WRFDomain.getColor(domainId - 1) : '#ef4444' });
  }

  function fitBounds() {
    if (drawnItems.getLayers().length) map.fitBounds(drawnItems.getBounds().pad(0.1));
  }

  function invalidateSize() {
    if (map) setTimeout(() => map.invalidateSize(), 100);
  }

  return { init, setDomainGeometry, setActiveDrawDomain, removeDomainLayer, clearDomains,
    setDomainValidation, fitBounds, invalidateSize, getMap: () => map,
    get activeDomainId() { return activeDomainId; }, get domainLayers() { return domainLayers; } };
})();
