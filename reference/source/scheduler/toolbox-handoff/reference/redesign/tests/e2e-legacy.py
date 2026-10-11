"""A schedule saved by the v34 prototype (no projectId, old color names, no commitments) must open,
recalculate and save in the redesign without losing anything. Usage: python3 tests/e2e-legacy.py"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
OLD = {'name': 'Old prototype schedule', 'scale': 'weeks', 'execOn': True, 'execColor': 'blue', 'colors': {'client': 'blue', 'design': 'teal', 'internal': 'violet'},
       'tasks': [
         {'id': 'a1', 'name': 'Kickoff', 'kind': 'milestone', 'duration': 0, 'start': '2026-10-12', 'locked': True, 'notBefore': None, 'deps': [], 'ignore': [], 'exec': True},
         {'id': 'a2', 'name': 'Schematic design', 'kind': 'task', 'duration': 28, 'start': None, 'locked': False, 'notBefore': None, 'deps': [{'id': 'a1', 'type': 'FS', 'lag': 0}], 'ignore': [], 'lvl': 'client', 'exec': True, 'exColor': 'teal'},
         {'id': 'a3', 'name': 'QA review', 'kind': 'task', 'duration': 5, 'start': None, 'locked': False, 'notBefore': None, 'deps': [{'id': 'a2', 'type': 'SS', 'lag': 14}], 'ignore': [], 'lvl': 'internal'},
         {'id': 'a4', 'name': 'Owner sign-off', 'kind': 'milestone', 'duration': 0, 'start': None, 'locked': False, 'notBefore': '2026-12-01', 'deps': [{'id': 'a2', 'type': 'FS', 'lag': 3}], 'ignore': []}],
       'sid': 'oldsid1', 'updatedBy': 'u_kent', 'updatedAt': 1791000000000}
n_ok, fails = 0, []
def ok(c, m):
    global n_ok
    if c: n_ok += 1
    else: fails.append(m); print('FAIL', m)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        await ctx.add_init_script(path=os.path.join(HERE, 'mock-platform.js'))
        await ctx.add_init_script(script='window.__seed = ' + json.dumps(OLD) + ';')
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + ROOT + '/dist/index.html'); await pg.wait_for_timeout(300)
        await pg.evaluate("async () => { const db = await window.claude.use('db'); await db.doc('schedules/old').set(window.__seed); }"); await pg.wait_for_timeout(300)
        home = await pg.text_content('body')
        ok('Old prototype schedule' in home, 'unassigned legacy schedule is listed on the home page')
        await pg.goto('file://' + ROOT + '/dist/index.html#/scheduler/s/old'); await pg.wait_for_timeout(200)
        await pg.evaluate("async () => { const db = await window.claude.use('db'); await db.doc('schedules/old').set(window.__seed); }"); await pg.wait_for_timeout(500)
        ok(await pg.locator('#tbody tr').count() == 4, 'all four rows load')
        starts = await pg.evaluate("[...document.querySelectorAll('#tbody tr [data-f=start]')].map(i => i.value)")
        ok(starts[1] == 'Oct 12, 2026' and starts[2] == 'Oct 26, 2026', 'dates recalculate from links: %s' % starts)
        ok(starts[3].startswith('Dec 1'), 'hold date respected: %s' % starts[3])
        await pg.fill('#tbody tr >> nth=1 >> [data-f=dur]', '35'); await pg.press('#tbody tr >> nth=1 >> [data-f=dur]', 'Tab'); await pg.wait_for_timeout(300)
        await pg.click('#btnSave'); await pg.wait_for_timeout(500)
        d = await pg.evaluate("window.__mock.store.get('schedules/old')")
        t = {x['id']: x for x in d['tasks']}
        ok(t['a2']['duration'] == 35 and t['a2']['exColor'] == 'teal' and t['a3']['deps'][0]['type'] == 'SS' and t['a4']['notBefore'] == '2026-12-01', 'saved without losing fields')
        ok(d.get('projectId') in (None,) and t['a1']['locked'] is True, 'stays unassigned; lock kept')
        ok(not errs, 'no page errors: %s' % errs)
        await b.close()
    print('e2e legacy checks passed', n_ok, 'failed', len(fails)); sys.exit(1 if fails else 0)
asyncio.run(main())
