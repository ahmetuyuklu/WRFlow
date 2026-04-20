/**
 * WRFlow — Leaflet Map Module
 * Interactive map with domain rectangle drawing and nesting visualization.
 */
const WRFMap = (() => {
  let map = null;
  let drawControl = null;
  let drawnItems = null;
  let domainLayers = {};  // { domainId: L.rectangle }
  let activeDrawDomain = null;

  function init() {
    map = L.map('map', {
      center: [39, 35],
      zoom: 5,
      zoomControl: true,
      attributionControl: true
    });

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 18
    });

    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> | &copy; OpenTopoMap',
      maxZoom: 17
    });

    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 18
    });

    osm.addTo(map);

    const baseMaps = {
      'Street (OSM)': osm,
      'Topographic': topo,
      'Satellite': esriSat
    };

    L.control.layers(baseMaps, {}, { position: 'topright' }).addTo(map);

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Initialize draw control for rectangles
    drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polyline: false,
        polygon: false,
        circle: false,
        marker: false,
        circlemarker: false,
        rectangle: {
          showArea: false,
          shapeOptions: {
            color: WRFDomain.DOMAIN_COLORS[0],
            weight: 3,
            fillOpacity: 0.08,
            dashArray: null
          }
        }
      },
      edit: {
        featureGroup: drawnItems,
        remove: false
      }
    });
    map.addControl(drawControl);

    // Track mouse coordinates
    map.on('mousemove', (e) => {
      const el = document.getElementById('map-coords');
      if (el) {
        el.textContent = `Lat: ${e.latlng.lat.toFixed(4)}  Lon: ${e.latlng.lng.toFixed(4)}`;
      }
    });

    // Handle new rectangle drawn
    map.on(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      const domainId = activeDrawDomain || 1;

      // Remove existing rectangle for this domain
      if (domainLayers[domainId]) {
        drawnItems.removeLayer(domainLayers[domainId]);
      }

      layer.setStyle({
        color: WRFDomain.getColor(domainId - 1),
        weight: domainId === 1 ? 3 : 2,
        fillOpacity: 0.06 + (domainId - 1) * 0.03,
        dashArray: null
      });

      // Make rectangle editable on drag/resize
      layer.options.editable = true;

      drawnItems.addLayer(layer);
      domainLayers[domainId] = layer;

      // Add drag and resize handlers
      layer.on('edit', () => onDomainEdited(domainId));

      // Trigger initial computation
      onDomainEdited(domainId);

      activeDrawDomain = null;
    });

    // Handle rectangle edits (resize/move)
    map.on(L.Draw.Event.EDITED, (e) => {
      e.layers.eachLayer((layer) => {
        for (const [id, l] of Object.entries(domainLayers)) {
          if (l === layer) {
            onDomainEdited(parseInt(id));
          }
        }
      });
    });
  }

  // Called when a domain rectangle is created or edited
  function onDomainEdited(domainId) {
    const layer = domainLayers[domainId];
    if (!layer) return;

    const bounds = layer.getBounds();
    const boundsObj = {
      south: bounds.getSouth(),
      north: bounds.getNorth(),
      west: bounds.getWest(),
      east: bounds.getEast()
    };

    // Dispatch event for app.js to handle
    document.dispatchEvent(new CustomEvent('domain-updated', {
      detail: { domainId, bounds: boundsObj }
    }));
  }

  // Programmatically set a domain rectangle from coordinates
  function setDomainRect(domainId, south, north, west, east) {
    const bounds = [[south, west], [north, east]];

    if (domainLayers[domainId]) {
      domainLayers[domainId].setBounds(bounds);
    } else {
      const rect = L.rectangle(bounds, {
        color: WRFDomain.getColor(domainId - 1),
        weight: domainId === 1 ? 3 : 2,
        fillOpacity: 0.06 + (domainId - 1) * 0.03,
        interactive: true
      });

      drawnItems.addLayer(rect);
      domainLayers[domainId] = rect;

      rect.on('edit', () => onDomainEdited(domainId));
    }
  }

  // Set which domain is being drawn next
  function setActiveDrawDomain(domainId) {
    activeDrawDomain = domainId;
    // Update draw control color
    if (drawControl && map) {
      map.removeControl(drawControl);
      drawControl = new L.Control.Draw({
        position: 'topleft',
        draw: {
          polyline: false,
          polygon: false,
          circle: false,
          marker: false,
          circlemarker: false,
          rectangle: {
            shapeOptions: {
              color: WRFDomain.getColor(domainId - 1),
              weight: domainId === 1 ? 3 : 2,
              fillOpacity: 0.08,
              dashArray: null
            }
          }
        },
        edit: {
          featureGroup: drawnItems,
          remove: false
        }
      });
      map.addControl(drawControl);
      // Ensure map is properly sized after control changes
      setTimeout(() => map.invalidateSize(false), 100);
    }
  }

  // Remove a domain layer
  function removeDomainLayer(domainId) {
    if (domainLayers[domainId]) {
      drawnItems.removeLayer(domainLayers[domainId]);
      delete domainLayers[domainId];
    }
  }

  // Set visual validation state on a domain
  function setDomainValidation(domainId, isValid) {
    const layer = domainLayers[domainId];
    if (!layer) return;

    if (isValid) {
      layer.setStyle({ dashArray: null, color: WRFDomain.getColor(domainId - 1) });
    } else {
      layer.setStyle({ dashArray: '8,4', color: '#ef4444' });
    }
  }

  // Fit map view to show all domains
  function fitBounds() {
    if (drawnItems.getLayers().length > 0) {
      map.fitBounds(drawnItems.getBounds().pad(0.1));
    }
  }

  // Force map to recalculate size (needed when container resizes)
  function invalidateSize() {
    if (map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
  }

  function getMap() {
    return map;
  }

  return {
    init,
    setDomainRect,
    setActiveDrawDomain,
    removeDomainLayer,
    setDomainValidation,
    fitBounds,
    invalidateSize,
    getMap,
    get domainLayers() { return domainLayers; }
  };
})();
