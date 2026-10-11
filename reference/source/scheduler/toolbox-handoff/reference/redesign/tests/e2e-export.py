"""End-to-end export test in real Chromium (Playwright).
Builds a schedule from the federal template, then exercises the export workspace and checks
every downloaded file: PDF (vector text, embedded brand fonts, page count), PNG, XLSX, CSV.
Usage: python3 tests/e2e-export.py [outdir]
CDN libraries are served from /home/claude/libs (same pinned versions the app loads)."""
import re, asyncio, base64, io, json, os, subprocess, sys, zipfile
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'qa-out')
LIBS = os.environ.get('LIBS', '/home/claude/libs/node_modules')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
os.makedirs(OUT, exist_ok=True)
ROUTES = {
    'jspdf.umd.min.js': LIBS + '/jspdf/dist/jspdf.umd.min.js',
    'xlsx.full.min.js': LIBS + '/xlsx/dist/xlsx.full.min.js',
    'jszip.min.js': LIBS + '/jszip/dist/jszip.min.js',
}
SEED = """async () => {
  const db = await window.claude.use('db');
  await db.doc('projects/p1').set({ number: '2026-014', name: 'Hill AFB Fueling Canopy', client: 'U.S. Air Force', status: 'active', createdBy: 'u_me', createdAt: Date.now(), updatedAt: Date.now() });
}"""
n_ok = 0
fails = []
def ok(cond, msg):
    global n_ok
    if cond: n_ok += 1
    else: fails.append(msg); print('FAIL', msg)

async def saved(pg):
    return await pg.evaluate('window.__mock.saved.map(s => ({ filename: s.filename, b64: s.b64 }))')

async def download(pg, before):
    for _ in range(80):
        s = await saved(pg)
        if len(s) > before: return s[-1]
        await pg.wait_for_timeout(150)
    return None

def write(f, name):
    p = os.path.join(OUT, name)
    open(p, 'wb').write(base64.b64decode(f['b64']))
    return p

def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout

async def open_export(pg, kind):
    await pg.click('#btnExport'); await pg.wait_for_timeout(300)
    await pg.click('#modalRoot .seg [data-kind=%s]' % kind)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1920, 'height': 1080})
        await ctx.add_init_script(path=os.path.join(HERE, 'mock-platform.js'))
        async def route(r):
            for k, v in ROUTES.items():
                if r.request.url.endswith(k):
                    return await r.fulfill(path=v, content_type='application/javascript')
            await r.abort()
        await ctx.route('https://cdnjs.cloudflare.com/**', route)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + ROOT + '/dist/index.html')
        await pg.wait_for_timeout(400)
        await pg.evaluate(SEED); await pg.wait_for_timeout(300)
        await pg.click('.plist tbody tr >> nth=0'); await pg.wait_for_timeout(300)
        await pg.click('#projBody >> text=New schedule'); await pg.wait_for_timeout(300)
        await pg.click('[data-tpl=fed]'); await pg.wait_for_timeout(200)
        await pg.click('text=Create schedule'); await pg.wait_for_timeout(500)
        ok(await pg.is_disabled('#btnSave'), 'a new schedule is saved on creation')
        ok(await pg.locator('#tbody tr').count() >= 10, 'template made a schedule')

        # ----- the workspace -----
        ok(await pg.locator('#exportMenu').count() == 0, 'no export menu on the main screen')
        await pg.click('#btnExport'); await pg.wait_for_timeout(400)
        ok(await pg.get_attribute('#modalRoot .seg [data-kind=pdf]', 'aria-pressed') == 'true', 'Export opens straight into the workspace, on PDF the first time')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        await open_export(pg, 'pdf'); await pg.wait_for_timeout(900)
        ws = pg.locator('#modalRoot .xw')
        ok(await ws.count() == 1, 'export workspace opens')
        ok((await pg.text_content('#xwTitle')) == 'Export', 'title is Export')
        ok(await pg.locator('#modalRoot .xo-prev canvas').count() == 1, 'PDF page preview drawn')
        ok(await pg.get_attribute('#modalRoot .seg [data-kind=pdf]', 'aria-pressed') == 'true', 'PDF format selected')
        tabs = await pg.locator('#modalRoot .xtab-b strong').all_text_contents()
        ok(tabs[:1] == ['Executive summary'] and len(tabs) == 4, 'audience tabs: %s' % tabs)
        summ = await pg.text_content('#modalRoot .xw-sum')
        ok('vector text' in summ and 'page' in summ, 'summary line: ' + summ)
        await pg.screenshot(path=os.path.join(OUT, 'x-01-pdf-internal.png'))

        # executive: phase bands by default, one page
        await pg.click('#modalRoot .xtab-b >> text=Executive summary'); await pg.wait_for_timeout(900)
        ok(await pg.input_value('#xo_style') == 'bands', 'executive preset uses phase bands')
        ok('1 page' in (await pg.text_content('#modalRoot .xw-sum')), 'bands are one page')
        dlt = await pg.text_content('#modalRoot .xw-foot .btn.primary')
        ok(dlt == 'Download Executive summary PDF', 'download label: ' + dlt)
        await pg.screenshot(path=os.path.join(OUT, 'x-02-pdf-exec-bands.png'))
        before = len(await saved(pg))
        await pg.click('#modalRoot .xw-foot .btn.primary')
        f = await download(pg, before)
        ok(f and f['filename'].endswith('.pdf') and 'Executive summary' in f['filename'], 'executive PDF saved')
        ok(await pg.locator('#modalRoot .xw').count() == 0, 'workspace closes on download')
        if f:
            pth = write(f, 'exec-bands.pdf')
            info = sh('pdfinfo', pth); fonts = sh('pdffonts', pth); text = sh('pdftotext', '-layout', pth, '-')
            ok(re.search(r'Pages:\s+1\b', info), 'exec PDF is 1 page')
            ok('Lato' in fonts and 'RobotoCondensed' in fonts and fonts.count(' yes ') >= 2, 'brand fonts embedded:\n' + fonts)
            ok('CONCEPT DESIGN' in text.upper() and 'CONSTRUCTION' in text.upper(), 'phase names are real text')
            sh('pdftoppm', '-png', '-r', '80', pth, os.path.join(OUT, 'exec-bands'))

        # internal bars PDF, multi page check and vector text
        await open_export(pg, 'pdf'); await pg.wait_for_timeout(700)
        await pg.click('#modalRoot .xtab-b >> text=Internal'); await pg.wait_for_timeout(700)
        await pg.select_option('#xo_scale', 'days'); await pg.wait_for_timeout(900)
        summ = await pg.text_content('#modalRoot .xw-sum')
        ok('pages' in summ and 'across' in summ, 'days scale tiles across pages: ' + summ)
        nav = pg.locator('#modalRoot .xw-pnav button')
        ok(await nav.count() == 2, 'page navigation shown')
        await nav.nth(1).click(); await pg.wait_for_timeout(700)
        ok('Page 2 of' in (await pg.text_content('#modalRoot .xw-pnav')), 'next page')
        await pg.select_option('#xo_scale', 'auto'); await pg.wait_for_timeout(700)
        await pg.uncheck('#xo_arrows'); await pg.wait_for_timeout(500)
        before = len(await saved(pg))
        await pg.click('#modalRoot .xw-foot .btn.primary')
        f = await download(pg, before)
        ok(f and 'Internal' in f['filename'], 'internal PDF saved')
        if f:
            pth = write(f, 'internal-bars.pdf')
            text = sh('pdftotext', '-layout', pth, '-'); fonts = sh('pdffonts', pth)
            ok('Design charrette' in text and '35% concept design' in text, 'activity names are vector text')
            ok('Lato' in fonts, 'Lato embedded')
            sh('pdftoppm', '-png', '-r', '80', '-f', '1', '-l', '1', pth, os.path.join(OUT, 'internal-bars'))

        # options remembered per audience (xo3 key)
        xo = await pg.evaluate("JSON.parse(localStorage.getItem('schedsheet:xo3:internal') || 'null')")
        ok(xo and xo.get('arrows') is False, 'internal options remembered: %s' % (xo and xo.get('arrows')))
        await open_export(pg, 'pdf'); await pg.wait_for_timeout(700)
        ok(await pg.locator('#modalRoot .xtab.on >> text=Internal').count() == 1, 'reopens on the last audience')
        ok(not await pg.is_checked('#xo_arrows'), 'reopens with saved choices')

        # format switch inside the workspace: image
        await pg.click('#modalRoot .seg [data-kind=png]'); await pg.wait_for_timeout(900)
        ok('PNG image' in (await pg.text_content('#modalRoot .xw-sum')), 'image summary')
        ok(await pg.locator('#xo_paper').count() == 0, 'no paper size for images')
        before = len(await saved(pg))
        await pg.click('#modalRoot .xw-foot .btn.primary')
        f = await download(pg, before)
        ok(f and f['filename'].endswith('.png'), 'PNG saved')
        if f:
            pth = write(f, 'internal.png')
            raw = open(pth, 'rb').read()
            ok(raw[:8] == b'\x89PNG\r\n\x1a\n', 'valid PNG')
        await pg.click('#btnExport'); await pg.wait_for_timeout(500)
        ok(await pg.get_attribute('#modalRoot .seg [data-kind=png]', 'aria-pressed') == 'true', 'reopens on the format used last')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)

        # table formats preview their rows
        await open_export(pg, 'xlsx'); await pg.wait_for_timeout(700)
        ok(await pg.locator('#modalRoot .xw-tbl tbody tr').count() > 5, 'Excel preview shows rows')
        await pg.screenshot(path=os.path.join(OUT, 'x-03-xlsx.png'))
        await pg.click('#modalRoot .xtab-b >> text=Client'); await pg.wait_for_timeout(400)
        before = len(await saved(pg))
        await pg.click('#modalRoot .xw-foot .btn.primary')
        f = await download(pg, before)
        ok(f and f['filename'].endswith('.xlsx') and 'Client' in f['filename'], 'XLSX saved')
        if f:
            pth = write(f, 'client.xlsx')
            z = zipfile.ZipFile(pth)
            ok('xl/worksheets/sheet1.xml' in z.namelist(), 'xlsx has a sheet')
            sheet = z.read('xl/worksheets/sheet1.xml').decode() + z.read('xl/sharedStrings.xml').decode() if 'xl/sharedStrings.xml' in z.namelist() else ''
            ok('Locked' not in sheet and 'Issue' not in sheet, 'client file leaves out locks and issues')

        await open_export(pg, 'csv'); await pg.wait_for_timeout(600)
        ok('CSV' in (await pg.text_content('#modalRoot .xw-sum')), 'CSV summary')
        before = len(await saved(pg))
        await pg.click('#modalRoot .xw-foot .btn.primary')
        f = await download(pg, before)
        ok(f and f['filename'].endswith('.csv'), 'CSV saved')
        if f:
            csv = base64.b64decode(f['b64']).decode('utf-8-sig')
            ok(csv.count('\n') > 5 and 'Activity' in csv.split('\n')[0] or 'Task' in csv.split('\n')[0], 'CSV header: ' + csv.split('\n')[0][:120])

        # Escape closes and returns focus
        await open_export(pg, 'pdf'); await pg.wait_for_timeout(500)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        ok(await pg.locator('#modalRoot .xw').count() == 0, 'Escape closes the workspace')

        # phone width
        await pg.set_viewport_size({'width': 390, 'height': 844})
        await open_export(pg, 'pdf'); await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.path.join(OUT, 'x-04-phone.png'))
        sw = await pg.evaluate('document.documentElement.scrollWidth')
        ok(sw <= 390, 'no horizontal page scroll at 390px: %d' % sw)
        await pg.keyboard.press('Escape')
        ok(not errs, 'no page errors: %s' % errs)
        await b.close()
    print('e2e export checks passed', n_ok, 'failed', len(fails))
    sys.exit(1 if fails else 0)

asyncio.run(main())
