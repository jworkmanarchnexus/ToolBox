import sys
R=lambda f:open('src/'+f,encoding='utf8').read()
def L(f): 
    s=R(f); return s if s.endswith('\n') else s+'\n'
out = L('head.html') + '<style>\n' + L('fonts.css') + L('ui.css') + L('sheetscreen.css') + L('mid.part') + L('vendor.part') \
  + '<script>\n' + L('logic.js') + '</script>\n<script>\n' + L('pdf.js') + '</script>\n' + L('sheetcss.part') + L('logopng.part') \
  + '<script>\n' + L('app.js') + '</script>\n\n</body></html>'
open(sys.argv[1] if len(sys.argv)>1 else 'dist.html','w',encoding='utf8').write(out)
