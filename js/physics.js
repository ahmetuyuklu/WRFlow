/**
 * WRFlow — Physics Scheme Registry & Compatibility
 * Defines all WRF physics schemes, educational tooltips, and compatibility rules.
 */
const WRFPhysics = (() => {

  const schemes = {
    mp_physics: [
      { id: 0,  name: 'None',               desc: 'No microphysics.' },
      { id: 1,  name: 'Kessler',            desc: 'Warm-rain (no ice). Simple scheme for idealized tests.' },
      { id: 3,  name: 'WSM3',               desc: 'Simple-ice scheme. Good for coarse grids (dx > 25km).', rec: true },
      { id: 4,  name: 'WSM5',               desc: 'Mixed-phase. Good for mesoscale grids (10-25km).', rec: true },
      { id: 6,  name: 'WSM6',               desc: 'Graupel scheme. Suitable for cloud-resolving grids.' },
      { id: 8,  name: 'Thompson',           desc: 'Aerosol-aware, two-moment rain/ice/snow. Widely recommended for research.', rec: true },
      { id: 10, name: 'Morrison 2-moment',  desc: 'Double-moment ice, snow, rain, graupel. Good for high-res simulations.' },
      { id: 16, name: 'WDM6',               desc: 'WDM6 double-moment warm rain + WSM6 ice microphysics.' },
      { id: 28, name: 'Thompson Aerosol',   desc: 'Thompson scheme with aerosol-aware nucleation.' }
    ],
    ra_lw_physics: [
      { id: 0,  name: 'None',    desc: 'No longwave radiation.' },
      { id: 1,  name: 'RRTM',    desc: 'Rapid Radiative Transfer Model. Accurate lookup-table based scheme.' },
      { id: 3,  name: 'CAM',     desc: 'Community Atmosphere Model radiation. Includes aerosol effects.' },
      { id: 4,  name: 'RRTMG',   desc: 'RRTMG longwave. Monte Carlo Independent Column Approximation. NCAR recommended.', rec: true },
      { id: 5,  name: 'New Goddard', desc: 'Goddard longwave scheme with updated absorption coefficients.' },
      { id: 24, name: 'RRTMGP',  desc: 'Next-generation RRTMG using RRTMGP library.' }
    ],
    ra_sw_physics: [
      { id: 0,  name: 'None',    desc: 'No shortwave radiation.' },
      { id: 1,  name: 'Dudhia',  desc: 'Simple downward integration. Efficient for mesoscale runs.' },
      { id: 2,  name: 'Goddard', desc: 'Two-stream multi-band scheme with ozone and aerosol effects.' },
      { id: 3,  name: 'CAM',     desc: 'Community Atmosphere Model shortwave.' },
      { id: 4,  name: 'RRTMG',   desc: 'Monte Carlo Independent Column Approximation shortwave. NCAR recommended.', rec: true },
      { id: 5,  name: 'New Goddard', desc: 'Updated Goddard shortwave scheme.' },
      { id: 24, name: 'RRTMGP',  desc: 'Next-generation RRTMG shortwave.' }
    ],
    sf_sfclay_physics: [
      { id: 0,  name: 'None',          desc: 'No surface layer scheme.' },
      { id: 1,  name: 'Revised MM5',   desc: 'Revised MM5 Monin-Obukhov surface layer. Pairs with YSU PBL.', rec: true },
      { id: 2,  name: 'Eta (MO)',      desc: 'Eta similarity based on Monin-Obukhov. Required for MYJ PBL.' },
      { id: 5,  name: 'MYNN',          desc: 'MYNN surface layer. Pairs with MYNN2.5 or MYNN3 PBL.' },
      { id: 91, name: 'Revised MM5 (old)', desc: 'Old Revised MM5 surface layer.' }
    ],
    sf_surface_physics: [
      { id: 0,  name: 'None',     desc: 'No land surface model.' },
      { id: 1,  name: 'Thermal',  desc: '5-layer thermal diffusion. Simple, 5 soil layers.' },
      { id: 2,  name: 'Noah',     desc: 'Unified Noah LSM. 4 soil layers. Widely validated.', rec: true },
      { id: 3,  name: 'RUC',      desc: 'RUC LSM. 6 or 9 soil layers. Good for short-range forecasts.' },
      { id: 4,  name: 'Noah-MP',  desc: 'Noah Multi-Parameterization. Enhanced canopy, groundwater, snow physics.' },
      { id: 5,  name: 'CLM4',     desc: 'Community Land Model v4. Complex, 10 soil layers.' }
    ],
    bl_pbl_physics: [
      { id: 0,  name: 'None',     desc: 'No PBL scheme. Only use for LES (dx < 100m).' },
      { id: 1,  name: 'YSU',      desc: 'Yonsei University non-local scheme. Pairs with Revised MM5 (sfclay=1) or MYNN (sfclay=5).', rec: true },
      { id: 2,  name: 'MYJ',      desc: 'Mellor-Yamada-Janjić local TKE scheme. Requires Eta sfclay (sfclay=2).' },
      { id: 4,  name: 'MYNN2.5',  desc: 'MYNN 2.5-level TKE scheme. Pairs with MYNN sfclay (sfclay=5).' },
      { id: 5,  name: 'MYNN3',    desc: 'MYNN 3rd-level TKE scheme. Pairs with MYNN sfclay (sfclay=5).' },
      { id: 7,  name: 'ACM2',     desc: 'Asymmetric Convective Model v2. Non-local with local closure above PBL.' },
      { id: 8,  name: 'Boulac',   desc: 'Bougeault-Lacarrère TKE scheme. For mesoscale to LES.' },
      { id: 12, name: 'GBM',      desc: 'Grenier-Bretherton-McCaa TKE scheme (v3.5+).' }
    ],
    cu_physics: [
      { id: 0,  name: 'None',         desc: 'No cumulus parameterization. Appropriate when dx < 4 km.' },
      { id: 1,  name: 'Kain-Fritsch', desc: 'Mass-flux scheme with CAPE closure. Widely used for mid-latitudes.' },
      { id: 2,  name: 'BMJ',          desc: 'Betts-Miller-Janjić adjustment scheme. Good for tropical regions.' },
      { id: 3,  name: 'Grell-Freitas', desc: 'Scale-aware GF scheme. Works across grid spacings (4-25km+).', rec: true },
      { id: 4,  name: 'SAS',          desc: 'Simplified Arakawa-Schubert (New SAS). Operational at NCEP.' },
      { id: 5,  name: 'Grell-3',      desc: 'Grell 3D ensemble scheme. Multi-cloud approach.' },
      { id: 6,  name: 'New Tiedtke',  desc: 'New Tiedtke mass-flux scheme. Includes shallow convection.' },
      { id: 11, name: 'MSKF',         desc: 'Multi-Scale Kain-Fritsch. Scale-aware, works from 3-25km.' },
      { id: 14, name: 'OSAS',         desc: 'Old SAS scheme (pre-GFSv15).' },
      { id: 16, name: 'New Tiedtke (GRIMS)', desc: 'Newer Tiedtke variant used in GRIMS.' }
    ]
  };

  // Compatibility matrix: PBL → required surface layer scheme(s)
  const pblSfclayCompat = {
    1: [1, 91],      // YSU → Revised MM5 or old MM5
    2: [2],           // MYJ → Eta/MO only
    4: [1, 5],        // MYNN2.5 → Revised MM5 or MYNN
    5: [1, 5],        // MYNN3 → Revised MM5 or MYNN
    7: [1],           // ACM2 → Revised MM5
    8: [1, 2],        // Boulac → MM5 or Eta
    12: [1]           // GBM → Revised MM5
  };

  // num_soil_layers for each sf_surface_physics option
  const soilLayers = {
    0: 5, 1: 5, 2: 4, 3: 6, 4: 4, 5: 10
  };

  // Validate compatibility, return array of warning messages
  function validate(pblId, sfclayId, cuId, dxMeters) {
    const warnings = [];

    // PBL ↔ sfclay compatibility
    if (pblId > 0 && pblSfclayCompat[pblId]) {
      if (!pblSfclayCompat[pblId].includes(sfclayId)) {
        const pbl = schemes.bl_pbl_physics.find(s => s.id === pblId);
        const sfclay = schemes.sf_sfclay_physics.find(s => s.id === sfclayId);
        const okNames = pblSfclayCompat[pblId].map(id =>
          schemes.sf_sfclay_physics.find(s => s.id === id)
        ).filter(Boolean).map(s => `${s.name} (${s.id})`).join(' or ');
        warnings.push(`${pbl.name} PBL (${pblId}) requires surface layer: ${okNames}. Current: ${sfclay ? sfclay.name : 'None'} (${sfclayId}).`);
      }
    }

    // Cumulus ↔ resolution
    const dxKm = dxMeters / 1000;
    if (dxKm > 10 && cuId === 0) {
      warnings.push(`Grid spacing is ${dxKm} km (>10 km). A cumulus parameterization is recommended.`);
    }
    if (dxKm < 4 && cuId > 0) {
      const cu = schemes.cu_physics.find(s => s.id === cuId);
      warnings.push(`Grid spacing is ${dxKm} km (<4 km). Cumulus parameterization (${cu ? cu.name : cuId}) is typically not needed at this resolution.`);
    }

    return warnings;
  }

  // Get recommended defaults
  function getDefaults() {
    return {
      mp_physics: 8,         // Thompson
      ra_lw_physics: 4,      // RRTMG
      ra_sw_physics: 4,      // RRTMG
      sf_sfclay_physics: 1,  // Revised MM5
      sf_surface_physics: 2, // Noah
      bl_pbl_physics: 1,     // YSU
      cu_physics: 1          // Kain-Fritsch
    };
  }

  function getSoilLayers(sfSurfaceId) {
    return soilLayers[sfSurfaceId] || 4;
  }

  return { schemes, validate, getDefaults, getSoilLayers, pblSfclayCompat };
})();
