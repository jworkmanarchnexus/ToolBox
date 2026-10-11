/* ===== Start-up: connect to the host platform, then let the router draw the page =====
   The platform services (db, user, room, downloads) are the seam described in
   docs/PLATFORM-SEAM.md. Production replaces them with the Toolbox API. */
async function boot() {
  setInterval(nagTick, 20000);
  bindShell();
  bindStatic();
  routeRender();
  const c = window.claude;
  if (!c || !c.use) { S.noStore = true; S.schedLoaded = true; routeRender(); return; }
  const [db, room, user, dl] = await Promise.all([c.use('db'), c.use('room'), c.use('user'), c.use('downloads')]);
  S.db = db; S.room = room; S.user = user; S.dl = dl;
  if (!db) { S.noStore = true; S.schedLoaded = true; routeRender(); return; }
  if (user) {
    S.meId = await user.id();
    const cw = await user.can('data.write');
    S.platformRO = S.readonly = cw === false;
    refreshNames([S.meId]).then(renderMe);
    try { S.isOwner = (await user.isOwner()) === true; } catch (e) { S.isOwner = false; }
  }
  renderMe();
  db.collection('projects').onSnapshot(onProjSnap, (e) => fail('Could not load projects', e));
  db.collection('schedules').onSnapshot(onSchedSnap, (e) => fail('Could not load schedules', e));
  db.doc('config/holidays').onSnapshot(onHolSnap, (e) => fail('Could not load holidays', e));
  db.collection('templates').onSnapshot(onTplCompanySnap, (e) => fail('Could not load templates', e));
  db.doc('config/templateManagers').onSnapshot(onTplManagersSnap, () => {});
  if (S.meId) db.collection('data/users/' + S.meId).onSnapshot((s) => { S.tplMineLoaded = true; onTplMineSnap(s); }, () => { S.tplMineLoaded = true; });
  else S.tplMineLoaded = true;
  if (room) room.onPeers(onPeers, () => {});
  routeRender();
}
