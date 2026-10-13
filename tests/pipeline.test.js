const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { makeState, root, WRFConfig: Config, WRFDateTime: Time, WRFRunScript: Run,
  WRFDownloadScripts: Download } = require('./helpers');

function fixture(t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(process.env.WRFLOW_TEST_TMP || os.tmpdir(), 'wrflow-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const base = path.join(directory, "configuration's folder with spaces");
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(bin);
  const write = (name, content, executable = false) => {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, content, { mode: executable ? 0o755 : 0o644 });
  };
  const state = makeState({ wpsDir: './WPS install', wrfDir: './WRF install',
    geogDataPath: './geog', downloadDataDir: './data', outputDir: './output', durationHours: 3, ...extra });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    PYTHONPATH: bin, PYTHONDONTWRITEBYTECODE: '1', TRACE: path.join(directory, 'trace'), REQUESTS_TRACE: path.join(directory, 'requests') };
  const execute = (name, source, additions = {}) => {
    const file = path.join(base, name);
    write(file, source, true);
    return spawnSync(name.endsWith('.py') ? 'python3' : '/bin/bash', [file],
      { cwd: directory, env: { ...env, ...additions }, encoding: 'utf8', timeout: 30000 });
  };
  return { directory, base, bin, state, env, write, execute };
}

function installPipelineMocks(f) {
  const wps = path.join(f.base, f.state.wpsDir), wrf = path.join(f.base, f.state.wrfDir, 'run');
  f.write(path.join(wps, 'ungrib/Variable_Tables/Vtable.GFS'), 'GFS fixture');
  f.write(path.join(wps, 'ungrib/Variable_Tables/Vtable.ERA-interim.pl'), 'ERA fixture');
  f.write(path.join(wps, 'geogrid/GEOGRID.TBL'), 'fixture');
  f.write(path.join(wps, 'metgrid/METGRID.TBL'), 'fixture');
  f.write(path.join(wrf, 'LANDUSE.TBL'), 'fixture');
  f.write(path.join(wrf, 'namelist.input'), 'preserve installation namelist');
  fs.mkdirSync(path.join(f.base, f.state.geogDataPath), { recursive: true });
  f.write(path.join(f.bin, 'csh'), '#!/bin/bash\nexec "$@"\n', true);
  for (const launcher of ['mpirun', 'srun']) {
    f.write(path.join(f.bin, launcher), `#!/bin/bash\nprintf '${launcher} %s\\n' "$*" >> "$TRACE"\nif [ "$1" = '-np' ] || [ "$1" = '-n' ]; then shift 2; fi\nexec "$@"\n`, true);
  }
  f.write(path.join(wps, 'link_grib.csh'), `#!/usr/bin/env python3
import pathlib, sys
for i, arg in enumerate(sys.argv[1:]):
    source = pathlib.Path(arg)
    assert source.read_bytes().startswith(b"GRIB"), str(source)
    pathlib.Path(f"GRIBFILE.{i:03d}").symlink_to(source)
`, true);
  f.write(path.join(f.bin, 'ncdump'), `#!/usr/bin/env python3
import os
print("netcdf fixture { dimensions: num_metgrid_levels = " + os.environ.get("ACTUAL_LEVELS", "44") + " ; num_st_layers = 4 ; :NUM_LAND_CAT = 21 ; }")
`, true);
  const program = `#!/usr/bin/env python3
import datetime, os, pathlib, re, sys
name = pathlib.Path(sys.argv[0]).stem
with open(os.environ["TRACE"], "a") as trace:
    trace.write(name + "\\n")
text = pathlib.Path("namelist.input" if name in ["real", "wrf"] else "namelist.wps").read_text()
def number(key):
    return int(re.search(r"\\b" + key + r"\\s*=\\s*(\\d+)", text)[1])
def string(key):
    return re.search(r"\\b" + key + r"\\s*=\\s*'((?:[^']|'')*)'", text)[1].replace("''", "'")
domains = number("max_dom")
if name == "geogrid":
    for d in range(1, domains + 1): pathlib.Path(f"geo_em.d{d:02d}.nc").write_text("geo fixture")
elif name in ["ungrib", "metgrid"]:
    start = datetime.datetime.strptime(string("start_date"), "%Y-%m-%d_%H:%M:%S")
    end = datetime.datetime.strptime(string("end_date"), "%Y-%m-%d_%H:%M:%S")
    prefix = pathlib.Path(string("prefix" if name == "ungrib" else "fg_name"))
    assert prefix.is_absolute() and prefix.parent.is_dir(), str(prefix)
    time = start
    while time <= end:
        stamp = time.strftime("%Y-%m-%d_%H:%M:%S")
        if name == "ungrib":
            pathlib.Path(str(prefix) + ":" + stamp).write_text("intermediate fixture")
        else:
            assert pathlib.Path(str(prefix) + ":" + stamp).is_file()
            directory = pathlib.Path(string("opt_output_from_metgrid_path"))
            assert directory == prefix.parent
            for d in range(1, domains + 1):
                if not (os.environ.get("MISSING_TIME") and d == domains and time == end):
                    (directory / f"met_em.d{d:02d}.{stamp}.nc").write_text("metgrid fixture")
        time += datetime.timedelta(seconds=number("interval_seconds"))
elif name == "real":
    assert number("num_metgrid_levels") == int(os.environ.get("ACTUAL_LEVELS", "44"))
    assert number("num_metgrid_soil_levels") == 4
    assert len(list(pathlib.Path(".").glob("met_em.*"))) >= domains * 2
    if "sst_update" in text:
        assert number("io_form_auxinput4") == 2
    for d in range(1, domains + 1):
        pathlib.Path(f"wrfinput_d{d:02d}").write_text("initial fixture")
        if "sst_update" in text: pathlib.Path(f"wrflowinp_d{d:02d}").write_text("sst fixture")
    pathlib.Path("wrfbdy_d01").write_text("boundary fixture")
elif name == "wrf":
    for d in range(1, domains + 1): pathlib.Path(f"wrfout_d{d:02d}_fixture").write_text("output fixture")
if name in ["real", "wrf"]:
    if not (name == "wrf" and os.environ.get("NO_SUCCESS_WRF")): print("SUCCESS COMPLETE " + name.upper())
else:
    print("Successful completion of program " + name)
`;
  for (const name of ['geogrid', 'ungrib', 'metgrid']) f.write(path.join(wps, `${name}.exe`), program, true);
  for (const name of ['real', 'wrf']) f.write(path.join(wrf, `${name}.exe`), program, true);
  const prepared = Config.prepare(f.state), data = path.join(f.base, f.state.downloadDataDir, Config.dataKey(prepared));
  fs.mkdirSync(data, { recursive: true });
  for (const time of Time.dataTimes(prepared.timeline)) {
    const fh = (time - prepared.timeline.cycle) / 3600000;
    f.write(path.join(data, `gfs.t00z.pgrb2.0p25.f${String(fh).padStart(3, '0')}`), 'GRIBfixture7777');
  }
}

test('all generated Bash and Python programs parse, including spaces/apostrophes in paths', t => {
  const f = fixture(t);
  for (const scheduler of ['local', 'mpi', 'slurm']) {
    const result = spawnSync('/bin/bash', ['-n'], { input: Run.generate({ ...f.state, scheduler }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const bash = spawnSync('/bin/bash', ['-n'], { input: Download.generate(f.state), encoding: 'utf8' });
  assert.equal(bash.status, 0, bash.stderr);
  const python = spawnSync('python3', ['-B', '-c', 'import ast,sys; ast.parse(sys.stdin.read())'],
    { input: Download.generate({ ...f.state, dataSource: 'ERA5' }), encoding: 'utf8' });
  assert.equal(python.status, 0, python.stderr);
});

for (const scheduler of ['local', 'mpi', 'slurm']) {
  test(`${scheduler}: generated pipeline resolves paths, inspects metadata, and verifies all nested outputs`, t => {
    const child = { id: 2, parent_id: 1, parent_grid_ratio: 3, i_parent_start: 101, j_parent_start: 101,
      e_we: 91, e_sn: 91, dx: 3000, dy: 3000, ref_lat: 39, ref_lon: 35, bounds: {} };
    const f = fixture(t, { scheduler, sstUpdate: 1, domains: [root(), child] });
    installPipelineMocks(f);
    const result = f.execute('run_wrf.sh', Run.generate(f.state));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(fs.existsSync(path.join(f.base, 'output/wrfout_d02_fixture')));
    assert.equal(fs.readFileSync(path.join(f.base, 'WRF install/run/namelist.input'), 'utf8'), 'preserve installation namelist');
    const trace = fs.readFileSync(f.env.TRACE, 'utf8');
    assert.ok(trace.includes('real\n') && trace.includes('wrf\n'));
    if (scheduler === 'local') assert.ok(!trace.includes('mpirun') && !trace.includes('srun'));
    else assert.equal(trace.split('\n').filter(l => l.startsWith(scheduler === 'mpi' ? 'mpirun ' : 'srun ')).length, 5);
  });
}

test('missing boundary times and explicit metadata mismatch stop before real.exe', t => {
  const f = fixture(t);
  installPipelineMocks(f);
  let result = f.execute('run_wrf.sh', Run.generate(f.state), { MISSING_TIME: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing boundary input/);
  assert.ok(!fs.readFileSync(f.env.TRACE, 'utf8').includes('real\n'));
  result = f.execute('run_wrf.sh', Run.generate({ ...f.state, numMetgridLevels: 42 }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains 44/);
});

test('Slurm spool copies resolve relative paths from the original submitted script', t => {
  const f = fixture(t, { scheduler: 'slurm' });
  installPipelineMocks(f);
  const original = path.join(f.base, 'run_wrf.sbatch');
  const spool = path.join(f.directory, 'slurm spool', 'slurm_script');
  f.write(original, Run.generate(f.state), true);
  f.write(spool, fs.readFileSync(original, 'utf8'), true);
  f.write(path.join(f.bin, 'scontrol'), '#!/bin/bash\nprintf "   Command=%s\\n" "$SUBMITTED_SCRIPT"\n', true);
  const result = spawnSync('/bin/bash', [spool], { cwd: f.directory,
    env: { ...f.env, SLURM_JOB_ID: '123', SUBMITTED_SCRIPT: original }, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(fs.existsSync(path.join(f.base, 'output/wrfout_d01_fixture')));
  assert.ok(!fs.existsSync(path.join(f.directory, 'slurm spool/output')));
});

test('a failed rerun cannot reuse previous success logs or output artifacts', t => {
  const f = fixture(t);
  installPipelineMocks(f);
  const script = Run.generate(f.state);
  assert.equal(f.execute('run_wrf.sh', script).status, 0);
  const result = f.execute('run_wrf.sh', script, { NO_SUCCESS_WRF: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /did not report successful completion/);
  assert.equal(fs.readdirSync(path.join(f.base, 'output')).filter(n => n.startsWith('run_')).length, 2);
});

test('GFS rejects non-GRIB HTTP 200 responses, uses fallback, and keeps cycle-specific caches', t => {
  const f = fixture(t);
  f.write(path.join(f.bin, 'curl'), `#!/usr/bin/env python3
import pathlib, sys, os
args = sys.argv[1:]
out = pathlib.Path(args[args.index("-o") + 1])
url = args[-1]
with open(os.environ["TRACE"], "a") as trace: trace.write(url + "\\n")
out.write_bytes(b"not GRIB: NOMADS error" if "nomads" in url else b"GRIBfixture7777")
print("200", end="")
`, true);
  const script = Download.generate(f.state);
  let result = f.execute('download_gfs.sh', script);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /AWS full-file fallback/);
  const firstTrace = fs.readFileSync(f.env.TRACE, 'utf8');
  assert.equal(firstTrace.trim().split('\n').length, 4);
  result = f.execute('download_gfs.sh', script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(f.env.TRACE, 'utf8'), firstTrace);
  result = f.execute('download_gfs.sh', Download.generate({ ...f.state, startDateStr: '2025-01-02' }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readdirSync(path.join(f.base, 'data')).length, 2);
});

test('ERA5 executable requests both overnight dates and fails on ecCodes conversion errors', t => {
  const f = fixture(t, { dataSource: 'ERA5', startDateStr: '2025-12-31', startHour: 23, durationHours: 2 });
  f.write(path.join(f.bin, 'cdsapi.py'), `import json, os, pathlib
class Client:
    def retrieve(self, dataset, request, target):
        with open(os.environ["REQUESTS_TRACE"], "a") as trace:
            trace.write(json.dumps({"dataset": dataset, "request": request}) + "\\n")
        pathlib.Path(target).write_bytes(b"GRIB\\x00\\x00\\x00\\x027777")
`);
  f.write(path.join(f.bin, 'grib_set'), `#!/usr/bin/env python3
import os, pathlib, sys
if os.environ.get("FAIL_GRIB_CONVERT"): sys.exit(1)
data = bytearray(pathlib.Path(sys.argv[-2]).read_bytes())
data[7] = 1
pathlib.Path(sys.argv[-1]).write_bytes(data)
`, true);
  const script = Download.generate(f.state);
  let result = f.execute('download_era5.py', script);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const requests = fs.readFileSync(f.env.REQUESTS_TRACE, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map(r => `${r.request.year}-${r.request.month}-${r.request.day}`),
    ['2025-12-31', '2025-12-31', '2026-01-01', '2026-01-01']);
  assert.deepEqual(requests[0].request.time, ['23:00']);
  assert.deepEqual(requests[2].request.time, ['00:00', '01:00']);
  result = f.execute('download_era5.py', script, { FAIL_GRIB_CONVERT: '1' });
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes('boundary data is ready'));
});
