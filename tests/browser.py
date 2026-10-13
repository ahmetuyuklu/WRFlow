"""Optional real-browser regressions. Requires Python Playwright + Chromium."""
import functools
import http.server
import json
import os
import re
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'

try:
    with sync_playwright() as p:
        launch = {'headless': True}
        if os.environ.get('WRFLOW_CHROME'):
            launch['executable_path'] = os.environ['WRFLOW_CHROME']
        browser = p.chromium.launch(**launch)
        context = browser.new_context(viewport={'width': 1600, 'height': 1000}, ignore_https_errors=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url, wait_until='domcontentloaded', timeout=90000)
        page.wait_for_function("typeof WRFApp !== 'undefined' && !!WRFMap.getMap()", timeout=60000)

        def state():
            return page.evaluate('JSON.parse(JSON.stringify(WRFApp.state))')

        def field(selector, value):
            page.locator(selector).fill(str(value))
            page.locator(selector).dispatch_event('change')

        def import_config(config):
            page.locator('#import-json-file').set_input_files({
                'name': 'configuration.json', 'mimeType': 'application/json', 'buffer': json.dumps(config).encode()})
            page.wait_for_timeout(200)

        def outline(domain):
            return page.evaluate('(id) => WRFMap.domainLayers[id].getLatLngs()[0].map(p => [p.lat,p.lng])', domain)

        def same_outline(a, b):
            return len(a) == len(b) and all(abs(x - y) < 1e-8 for p1, p2 in zip(a, b) for x, y in zip(p1, p2))

        def drag(selector, dx, dy):
            rect = page.locator(selector).first.bounding_box()
            assert rect, selector
            x, y = rect['x'] + rect['width']/2, rect['y'] + rect['height']/2
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + dx, y + dy, steps=15)
            page.mouse.up()
            page.wait_for_timeout(300)

        config = state()
        root = config['domains'][0]
        root.update(e_we=301, e_sn=301, ref_lat=39, ref_lon=35, bounds={})
        config.update(startDateStr='2025-01-01', startHour=0, durationHours=25, startForecastHour=24,
                      projectionAuto={'truelat1': False, 'truelat2': False, 'standLon': False}, currentStep=1)
        child = dict(root, id=2, parent_id=1, parent_grid_ratio=3, i_parent_start=81, j_parent_start=81,
                     e_we=91, e_sn=91, dx=3000, dy=3000)
        sibling = dict(child, id=3, i_parent_start=171, j_parent_start=171)
        grandchild = dict(child, id=4, parent_id=3, i_parent_start=21, j_parent_start=21,
                          e_we=31, e_sn=31, dx=1000, dy=1000)
        config['domains'] = [root, child, sibling, grandchild]
        import_config(config)
        assert len(state()['domains']) == 4, errors
        assert page.locator('#start-date').input_value() == '2025-01-01'
        assert '2025-01-03 01:00Z' in page.locator('#computed-end-date').inner_text()
        page.wait_for_timeout(600)
        original = {d: outline(d) for d in [2, 3, 4]}
        page.locator('.wrf-edit-control a').click()
        drag('.wrf-domain-handle:not(.wrf-move-handle)', -40, 30)
        for d in original:
            assert same_outline(original[d], outline(d)), f'd{d} moved during parent resize'
        resized = state()['domains'][0]
        drag('.wrf-move-handle', 15, -10)
        for d in original:
            assert not same_outline(original[d], outline(d)), f'd{d} did not move with its parent'
        assert state()['domains'][0]['e_we'] == resized['e_we']
        page.locator('.wrf-edit-control a').click()
        before = state()
        field('#e-we', 20)
        assert state()['domains'][0]['e_we'] == before['domains'][0]['e_we']
        print('PASS: actual resize preserves nests; parent move moves the group; invalid shrink rolls back')

        page.locator('[data-remove="2"]').click()
        assert [d['id'] for d in state()['domains']] == [1, 2, 3]
        assert state()['domains'][2]['parent_id'] == 2
        assert page.evaluate('Object.keys(WRFMap.domainLayers).join(",")') == '1,2,3'
        assert re.search(r'parent_id\s*= 1, 1, 2,', page.locator('#namelist-wps-output').inner_text())
        print('PASS: domain deletion renumbers map cards and namelist parent references')

        page.evaluate('WRFApp.goToStep(2)')
        field('#start-date', '')
        assert page.locator('#btn-download-all').is_disabled()
        field('#start-date', '2025-01-01')
        field('#run-duration', 1.5)
        assert page.locator('#btn-download-all').is_disabled()
        field('#start-fh', 381)
        field('#run-duration', 4)
        assert page.locator('#btn-download-all').is_disabled()
        assert 'coverage' in page.locator('#namelist-input-output').inner_text()
        page.locator('label.data-source-card').nth(1).click()
        page.locator('#start-hour').select_option('23')
        field('#start-date', '2025-12-31')
        field('#run-duration', 3)
        assert page.locator('#start-hour option').count() == 24
        page.evaluate('WRFApp.goToStep(4)')
        field('#output-dir', './changed output')
        assert "'./changed output/FILE'" in page.locator('#namelist-wps-output').inner_text()
        assert "OUTPUT_DIR='./changed output'" in page.locator('#run-script-output').inner_text()
        page.locator('#btn-advanced-toggle').click()
        page.locator('#adv-sst-update').select_option('1')
        page.locator('[data-adv-tab="adv-timeio"]').click()
        field('#adv-interval-seconds', 7200)
        assert re.search(r'interval_seconds\s*= 7200,', page.locator('#namelist-wps-output').inner_text())
        assert re.search(r'auxinput4_interval\s*= 120,', page.locator('#namelist-input-output').inner_text())
        assert '2026-01-01 03:00Z' in page.locator('#computed-boundary-note').inner_text()
        assert page.locator('#btn-download-all').is_enabled()
        print('PASS: time coverage blocks invalid exports; output paths, intervals, and SST previews refresh together')

        page.evaluate('WRFApp.goToStep(3)')
        page.locator('#bl-pbl-physics').select_option('4')
        assert page.locator('#btn-download-all').is_disabled()
        page.locator('#sf-sfclay-physics').select_option('4')
        assert page.locator('#btn-download-all').is_enabled()
        assert 'QNSE' in page.locator('#bl-pbl-physics option:checked').inner_text()
        print('PASS: corrected QNSE mapping and mandatory physics compatibility validation')

        changed = state()
        changed.update(dataSource='GFS', gfsInterval=1, startDateStr='2024-02-28', startHour=6,
                       startForecastHour=24, durationHours=2, intervalSecondsOverride=None, currentStep=2)
        import_config(changed)
        assert page.locator('input[name="data-source"][value="GFS"]').is_checked()
        assert page.locator('#gfs-interval').input_value() == '1'
        assert page.locator('#start-hour option').count() == 4
        assert page.locator('#start-date').input_value() == '2024-02-28'
        assert page.locator('#start-hour').input_value() == '6'
        assert page.locator('#run-duration').input_value() == '2'
        assert page.locator('#adv-interval-seconds').input_value() == ''
        before = state()
        import_config({'domains': []})
        assert state() == before, 'Rejected import changed the active configuration'
        assert page.locator('#btn-download-all').is_enabled()
        page.reload(wait_until='domcontentloaded', timeout=90000)
        page.wait_for_function("typeof WRFMap !== 'undefined' && !!WRFMap.domainLayers[3]", timeout=60000)
        assert page.locator('#start-hour').input_value() == '6'
        assert state()['domains'][2]['parent_id'] == 2
        print('PASS: import synchronizes all time controls, rejected imports preserve state, and reload retains configuration')

        page.locator('#btn-share').click()
        shared_url = page.locator('#share-url-input').input_value()
        shared = context.new_page()
        shared.on('pageerror', lambda error: errors.append(str(error)))
        shared.goto(shared_url, wait_until='domcontentloaded', timeout=90000)
        shared.wait_for_function("typeof WRFMap !== 'undefined' && !!WRFMap.domainLayers[3]", timeout=60000)
        assert shared.evaluate('WRFApp.state.startForecastHour') == 24
        assert shared.locator('#start-date').input_value() == '2024-02-28'
        assert not errors, errors
        shared.close()
        print('PASS: shared configuration restores consistent timing and nesting with no JavaScript errors')
        browser.close()
finally:
    server.shutdown()
