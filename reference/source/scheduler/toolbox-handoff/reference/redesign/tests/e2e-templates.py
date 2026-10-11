"""Templates module, end to end in Chromium: the library page, Save as template, editing a template
in the full editor, the wizard question per phase, Move to Company templates, starter overrides,
template managers, and what someone who is not a manager can and cannot do.
Usage: python3 tests/e2e-templates.py [outdir]"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'qa-out')
os.makedirs(OUT, exist_ok=True)
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
n_ok, fails = 0, []
def ok(c, m):
    global n_ok
    if c: n_ok += 1
    else: fails.append(m); print('FAIL', m)

async def store(pg, prefix):
    return await pg.evaluate("(p) => Object.fromEntries([...window.__mock.store.entries()].filter(([k]) => k.startsWith(p)))", prefix)
async def dlg_click(pg, text):
    await pg.click('#modalRoot .dlg-act button >> text="%s"' % text); await pg.wait_for_timeout(300)

async def new_page(b, user='u_me'):
    ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
    await ctx.add_init_script(script='window.__mockUser = %s;' % json.dumps(user))
    await ctx.add_init_script(path=os.path.join(HERE, 'mock-platform.js'))
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return pg, errs

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        pg, errs = await new_page(b)
        await pg.goto('file://' + ROOT + '/dist/index.html'); await pg.wait_for_timeout(400)
        await pg.evaluate("async () => { const db = await window.claude.use('db'); await db.doc('projects/p1').set({ number: '2026-014', name: 'Hill AFB Fueling Canopy', client: 'USAF', status: 'active', createdAt: 1, updatedAt: 1 }); }"); await pg.wait_for_timeout(300)

        # ----- library page -----
        ok(await pg.locator('#navTemplates').count() == 1, 'Templates in the side bar')
        await pg.click('#btnHomeTpl'); await pg.wait_for_timeout(300)
        ok(await pg.locator('#pageTemplates').is_visible(), 'Templates page opens')
        ok(await pg.locator('.tcard').count() == 7, 'seven starter company templates: %d' % await pg.locator('.tcard').count())
        ok(await pg.locator('#btnTplMgrs').count() == 1, 'owner sees Template managers')
        await pg.screenshot(path=os.path.join(OUT, 't-01-library.png'))
        await pg.click('[data-tab=mine]'); await pg.wait_for_timeout(200)
        ok('No templates of your own yet' in await pg.text_content('#tplBody'), 'My templates starts empty')

        # ----- a schedule, saved as a template (with a lock that must not carry over) -----
        await pg.click('#navTemplates'); await pg.click('[data-tab=company]'); await pg.wait_for_timeout(200)
        await pg.click('.tcard[data-tpl="company:fed"] >> button:text-is("Use")'); await pg.wait_for_timeout(300)
        ok(await pg.get_attribute('.wiz-list [data-tpl=fed]', 'aria-pressed') == 'true', 'Use opens the wizard on that template')
        await pg.select_option('#nsProj', 'p1')
        await pg.click('text=Create schedule'); await pg.wait_for_timeout(500)
        await pg.click('#tbody tr >> nth=12 >> .lockb'); await pg.wait_for_timeout(200)  # lock "Ready to advertise"
        await pg.click('#btnSave'); await pg.wait_for_timeout(300)
        await pg.click('#btnSchedMenu'); await pg.click('#btnSaveTpl'); await pg.wait_for_timeout(200)
        await pg.fill('#tplName', 'Federal, our way'); await pg.fill('#tplCat', 'Government')
        await dlg_click(pg, 'Save to My templates'); await pg.wait_for_timeout(300)
        mine = await store(pg, 'data/users/u_me/')
        ok(len(mine) == 1, 'saved to My templates (private area)')
        tid, tdoc = list(mine.items())[0] if mine else (None, {})
        tid = tid.split('/')[-1] if tid else None
        ok(tdoc.get('kind') == 'template' and tdoc.get('name') == 'Federal, our way' and tdoc.get('category') == 'Government', 'name and category stored')
        ok(len(tdoc.get('tasks', [])) == 17 and not any('locked' in t for t in tdoc.get('tasks', [])), 'all activities kept; no locks in a template')

        # ----- edit it in the full editor -----
        await pg.goto('file://' + ROOT + '/dist/index.html#/scheduler/templates'); await pg.wait_for_timeout(500)
        await pg.click('[data-tab=mine]'); await pg.wait_for_timeout(200)
        await pg.click('.tcard >> button:text-is("Edit")'); await pg.wait_for_timeout(500)
        ok(await pg.locator('body.tpl-mode').count() == 1, 'template opens in the editor (template mode)')
        ok('Editing your template' in await pg.text_content('#banners'), 'template banner')
        ok(not await pg.is_visible('#schedSel') and await pg.is_visible('#edTplName'), 'template name instead of the schedule switcher')
        ok(not await pg.is_visible('#btnHistory') and not await pg.is_visible('#btnExport'), 'no history or export for templates')
        ok(await pg.locator('#tbody tr').count() == 17, 'all activities in the editor')
        await pg.fill('#tbody tr >> nth=1 >> [data-f=dur]', '12'); await pg.press('#tbody tr >> nth=1 >> [data-f=dur]', 'Tab'); await pg.wait_for_timeout(300)
        await pg.click('#tbody tr >> nth=1 >> [data-act=info]'); await pg.wait_for_timeout(300)
        insp = await pg.text_content('#inspector')
        ok('New-schedule wizard' in insp and 'Commitment' not in insp and 'Date lock' not in insp, 'inspector: wizard question, no commitment or lock')
        await pg.check('#inspector [data-k=tplphase]'); await pg.wait_for_timeout(200)
        await pg.click('#inspector >> text=Done'); await pg.wait_for_timeout(200)
        await pg.click('#btnSettings'); await pg.wait_for_timeout(300)
        ok('Template settings' in await pg.text_content('#modalRoot'), 'Settings opens Template settings')
        await pg.fill('#tplDesc', 'Federal DBB with a two-week charrette.')
        await dlg_click(pg, 'Apply')
        await pg.screenshot(path=os.path.join(OUT, 't-02-editor.png'))
        await pg.click('#btnSave'); await pg.wait_for_timeout(400)
        d = (await store(pg, 'data/users/u_me/' + tid)).get('data/users/u_me/' + tid, {})
        ch = [t for t in d.get('tasks', []) if t['name'] == 'Design charrette']
        ok(ch and ch[0].get('d') == 12 and ch[0].get('phase') is True, 'duration and wizard flag saved: %s' % ch)
        ok(d.get('description') == 'Federal DBB with a two-week charrette.', 'description saved')
        ok('All changes saved' in await pg.text_content('#status'), 'saved state')

        # unsaved changes are protected when leaving
        await pg.fill('#tbody tr >> nth=2 >> [data-f=dur]', '50'); await pg.press('#tbody tr >> nth=2 >> [data-f=dur]', 'Tab'); await pg.wait_for_timeout(200)
        await pg.click('#navTemplates'); await pg.wait_for_timeout(300)
        ok('Discard unsaved changes?' in await pg.text_content('#modalRoot'), 'leaving with unsaved changes asks first')
        await dlg_click(pg, 'Discard')
        ok(await pg.locator('#pageTemplates').is_visible() and not await pg.locator('body.tpl-mode').count(), 'discard leaves template mode')

        # ----- the wizard offers it and asks for the flagged phase -----
        await pg.click('#navTemplates'); await pg.wait_for_timeout(200)
        await pg.click('#pageTemplates >> text=Scheduler'); await pg.wait_for_timeout(200)
        await pg.click('#btnHomeNew'); await pg.wait_for_timeout(300)
        ok('My templates' in await pg.text_content('.wiz-list'), 'wizard lists My templates')
        await pg.click('.wiz-list [data-tpl="mine:%s"]' % tid); await pg.wait_for_timeout(300)
        ok(await pg.locator('[data-ph="%s"]' % ch[0]['k']).count() == 1 if ch else False, 'wizard asks for the charrette length')
        await pg.fill('#newName', 'From my template'); await pg.click('text=Create schedule'); await pg.wait_for_timeout(500)
        ok(await pg.input_value('#tbody tr >> nth=1 >> [data-f=dur]') in ('12', '11', '10'), 'new schedule uses the template lengths')
        locks = await pg.evaluate("[...document.querySelectorAll('#tbody .lockb')].filter(b => b.getAttribute('aria-pressed') === 'true').length")
        ok(locks == 0, 'nothing is locked in a schedule made from a template')

        # ----- move to company templates -----
        await pg.goto('file://' + ROOT + '/dist/index.html#/scheduler/templates'); await pg.wait_for_timeout(500)
        await pg.click('[data-tab=mine]'); await pg.wait_for_timeout(200)
        await pg.click('.tcard [aria-label="Move to Company templates"]'); await pg.wait_for_timeout(200)
        await dlg_click(pg, 'Move to Company templates')
        ok(not await store(pg, 'data/users/u_me/') and ('templates/' + tid) in await store(pg, 'templates/'), 'moved: gone from mine, in company')
        ok(await pg.locator('.tcard').count() == 8, 'company list has 8')

        # ----- a manager edits a starter template, removes one, restores it -----
        await pg.click('.tcard[data-tpl="company:ca"] >> button:text-is("Edit")'); await pg.wait_for_timeout(400)
        ok('Editing a company template' in await pg.text_content('#banners'), 'starter opens editable for a manager')
        await pg.fill('#tbody tr >> nth=4 >> [data-f=dur]', '28'); await pg.press('#tbody tr >> nth=4 >> [data-f=dur]', 'Tab'); await pg.wait_for_timeout(200)
        await pg.click('#btnSave'); await pg.wait_for_timeout(400)
        ok('templates/ca' in await store(pg, 'templates/'), 'editing a starter saves a company copy under its id')
        await pg.click('#navTemplates'); await pg.wait_for_timeout(300)
        await pg.click('.tcard[data-tpl="company:pursuit"] [aria-label="Remove from company templates"]'); await dlg_click(pg, 'Remove')
        ok(await pg.locator('.tcard[data-tpl="company:pursuit"]').count() == 0 and 'Removed starter templates (1)' in await pg.text_content('#tplBody'), 'starter removed, restorable')
        await pg.click('.tpl-hidden summary'); await pg.click('.tpl-hidden >> text=Restore'); await pg.wait_for_timeout(300)
        ok(await pg.locator('.tcard[data-tpl="company:pursuit"]').count() == 1, 'starter restored')

        # ----- template managers -----
        await pg.click('#btnTplMgrs'); await pg.wait_for_timeout(200)
        await pg.fill('#mgrSearch', 'Kent'); await pg.wait_for_timeout(300)
        await pg.click('.mgr-hit >> text=Kent'); await pg.wait_for_timeout(100)
        await dlg_click(pg, 'Save')
        mg = (await store(pg, 'config/templateManagers')).get('config/templateManagers', {})
        ok(mg.get('ids') == ['u_kent'], 'manager list saved: %s' % mg.get('ids'))
        company = await store(pg, 'templates/')
        ok(not errs, 'no page errors (owner): %s' % errs)

        # ----- someone who is not a manager -----
        pg2, errs2 = await new_page(b, 'u_maria')
        await pg2.goto('file://' + ROOT + '/dist/index.html#/scheduler/templates'); await pg2.wait_for_timeout(300)
        await pg2.evaluate("async (docs) => { const db = await window.claude.use('db'); for (const [k, v] of Object.entries(docs)) await db.doc(k).set(v); await db.doc('config/templateManagers').set({ ids: ['u_kent'] }); }", company)
        await pg2.wait_for_timeout(400)
        ok(await pg2.locator('#btnTplMgrs').count() == 0, 'only the owner manages the manager list')
        ok(await pg2.locator('.tcard [aria-label="Remove from company templates"]').count() == 0, 'no remove for non-managers')
        ok(await pg2.locator('.tcard[data-tpl="company:%s"] >> button:text-is("View")' % tid).count() == 1, 'company templates open as View')
        await pg2.click('.tcard[data-tpl="company:%s"] >> button:text-is("View")' % tid); await pg2.wait_for_timeout(400)
        ok('view only' in await pg2.text_content('#banners'), 'view-only banner')
        ok(await pg2.is_disabled('#btnSave') and await pg2.is_disabled('#btnAdd'), 'cannot edit a company template')
        await pg2.click('#banners >> text=Duplicate to My templates'); await pg2.wait_for_timeout(200)
        await dlg_click(pg2, 'Duplicate')
        m2 = await store(pg2, 'data/users/u_maria/')
        ok(len(m2) == 1 and list(m2.values())[0].get('basedOn') == 'Federal, our way', 'duplicated into her own templates')
        await pg2.goto('file://' + ROOT + '/dist/index.html#/scheduler/templates'); await pg2.wait_for_timeout(400)
        await pg2.click('[data-tab=mine]'); await pg2.wait_for_timeout(200)
        ok(await pg2.locator('.tcard [aria-label="Move to Company templates"]').count() == 0, 'non-managers cannot move to company')
        await pg2.screenshot(path=os.path.join(OUT, 't-03-nonmanager.png'))
        ok(not errs2, 'no page errors (non-manager): %s' % errs2)
        await b.close()
    print('e2e templates checks passed', n_ok, 'failed', len(fails)); sys.exit(1 if fails else 0)
asyncio.run(main())
