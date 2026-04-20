/**
 * WRFlow — Time & Date Module
 * UTC date handling, synoptic hour enforcement, duration calculations, data source constraints.
 */
const WRFDateTime = (() => {

  const DATA_SOURCES = {
    GFS: {
      name: 'GFS',
      maxDurationHours: 384,  // 16 days
      intervalSeconds: 10800, // 3 hours
      synopticHours: [0, 6, 12, 18],
      allHours: false,
      description: 'NCEP Global Forecast System — 0.25° resolution; 1h intervals (0–120h) or 3h intervals (0–384h)'
    },
    ERA5: {
      name: 'ERA5',
      maxDurationHours: 8760, // 1 year (practical limit)
      intervalSeconds: 3600,  // 1 hour
      synopticHours: null,    // all hours available
      allHours: true,
      description: 'ECMWF Reanalysis v5 — 0.25° resolution, 1h interval, historical data only'
    }
  };

  // Get available start hours for a data source
  function getStartHours(source) {
    const src = DATA_SOURCES[source];
    if (src.allHours) {
      return Array.from({ length: 24 }, (_, i) => i);
    }
    return src.synopticHours;
  }

  // Calculate run_days and run_hours from total duration
  function splitDuration(totalHours) {
    return {
      run_days: Math.floor(totalHours / 24),
      run_hours: totalHours % 24
    };
  }

  // Calculate end date from start date + duration
  function calcEndDate(startDate, startHour, durationHours) {
    const start = new Date(startDate);
    start.setUTCHours(startHour, 0, 0, 0);
    const end = new Date(start.getTime() + durationHours * 3600 * 1000);
    return end;
  }

  // Validate date based on data source constraints
  function validate(source, startDate, durationHours) {
    const warnings = [];
    const src = DATA_SOURCES[source];
    const now = new Date();

    if (source === 'ERA5') {
      // ERA5 data available up to ~5 days behind real-time
      const cutoff = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
      const start = new Date(startDate);
      if (start > cutoff) {
        warnings.push(`ERA5 data is typically available up to ~5 days behind real-time. Your start date may not have data yet.`);
      }
    }

    if (source === 'GFS') {
      const start = new Date(startDate + 'T00:00:00Z');
      const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      if (start > todayUtc) {
        warnings.push('GFS forecast cycles are not available for future UTC dates. Choose today or a past date.');
      }
      if (durationHours > src.maxDurationHours) {
        warnings.push(`GFS forecast data is available up to ${src.maxDurationHours} hours (16 days). Duration exceeds this limit.`);
      }
    }

    if (durationHours < 1) {
      warnings.push('Run duration must be at least 1 hour.');
    }

    return warnings;
  }

  // Build the WRF date components (year, month, day, hour) for all domains
  function getDateComponents(startDate, startHour, durationHours, numDomains) {
    const start = new Date(startDate);
    start.setUTCHours(startHour, 0, 0, 0);
    const end = new Date(start.getTime() + durationHours * 3600 * 1000);

    const comp = {
      start_year: new Array(numDomains).fill(start.getUTCFullYear()),
      start_month: new Array(numDomains).fill(start.getUTCMonth() + 1),
      start_day: new Array(numDomains).fill(start.getUTCDate()),
      start_hour: new Array(numDomains).fill(start.getUTCHours()),
      end_year: new Array(numDomains).fill(end.getUTCFullYear()),
      end_month: new Array(numDomains).fill(end.getUTCMonth() + 1),
      end_day: new Array(numDomains).fill(end.getUTCDate()),
      end_hour: new Array(numDomains).fill(end.getUTCHours()),
      start: start,
      end: end
    };
    return comp;
  }

  return { DATA_SOURCES, getStartHours, splitDuration, calcEndDate, validate, getDateComponents };
})();
