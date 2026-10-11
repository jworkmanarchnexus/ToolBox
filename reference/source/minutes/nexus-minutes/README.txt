Nexus Minutes (v16)

nexus-minutes.html  Self-contained app. Open in a browser. Fonts, jsPDF and logo are inlined; nothing loads from the network.
src/ + build.py     Source. Rebuild with:  python3 build.py nexus-minutes.html

Outside claude.ai:
- Data is stored in that browser only (IndexedDB/localStorage). No sync between users.
- PDF/file saving relies on the artifact "downloads" capability (window.claude); Save buttons may not work without it.
- Toolbox side-bar links point to the claude.ai artifacts.
