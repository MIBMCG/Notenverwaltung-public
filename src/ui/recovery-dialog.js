/** Secret-bearing dialogs are separate from application state and discarded at hard boundaries. */
export function createRecoveryUi({ window, document, Storage, downloadText }) {
  let active = null;
  function el(tag, text, parent, doc = document) {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function erase(node) {
    for (const field of node.querySelectorAll('input,textarea')) field.value = '';
    node.textContent = '';
    if (node.parentNode) node.parentNode.removeChild(node);
  }
  function closePrints(op) {
    for (const popup of op.prints.splice(0)) {
      try { popup.document.body.textContent = ''; popup.close(); } catch (error) {}
    }
  }
  function finish(op, result = op.committed || null) {
    if (!op.alive) return;
    op.alive = false;
    if (op.cancelStep) op.cancelStep();
    if (op.overlay) erase(op.overlay);
    closePrints(op);
    for (const token of op.tokens) Storage.cancelPreparedProtection(token);
    op.tokens.clear();
    if (active === op) active = null;
    op.resolve(result);
  }
  function dispose() { if (active) finish(active); }
  for (const event of ['sessionCleared', 'pagehide']) window.addEventListener(event, dispose);
  function run(work) {
    if (active) return Promise.resolve(null);
    return new Promise(resolve => {
      const op = { alive: true, tokens: new Set(), prints: [], overlay: null, cancelStep: null, resolve };
      active = op;
      Promise.resolve().then(() => work(op)).then(result => finish(op, result || null), async () => {
        if (op.alive) await step(op, 'Vorgang nicht bestätigt', 'Der Abschluss konnte nicht bestätigt werden. Öffne die Anwendung erneut und prüfe den Bestand mit den bisherigen oder den neu bestätigten Zugangsdaten. Bewahre vorhandene Sicherungen auf.', [], 'Schließen');
        if (op.commitFailed) Storage.lockSession();
        finish(op);
      });
    });
  }
  function remember(op, value, key = 'token') {
    if (!op.alive) { if (value && value[key]) Storage.cancelPreparedProtection(value[key]); return false; }
    op.tokens.add(value[key]);
    return true;
  }
  function step(op, title, text, fields = [], action = 'Weiter', extra = null, validate = null) {
    if (!op.alive) return Promise.resolve(null);
    if (op.overlay) erase(op.overlay);
    closePrints(op);
    return new Promise(resolve => {
      const overlay = el('section');
      overlay.dataset.sessionSensitiveOverlay = 'true'; overlay.dataset.recoveryDialog = 'true';
      overlay.__closeForSessionLock = () => finish(op);
      overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', title);
      Object.assign(overlay.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.5)', zIndex: '100200', display: 'flex', alignItems: 'center', justifyContent: 'center' });
      const card = el('div', '', overlay);
      Object.assign(card.style, { background: 'var(--bg-card,white)', color: 'var(--text-main,#222)', padding: '1.2rem', borderRadius: '8px', width: 'min(520px,calc(100vw - 2rem))', boxSizing: 'border-box', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto' });
      el('h2', title, card); el('p', text, card);
      const inputs = fields.map(field => {
        const label = el('label', field.label, card);
        const input = el(field.type === 'textarea' ? 'textarea' : 'input', '', label);
        input.type = field.type || 'text'; input.setAttribute('aria-label', field.label);
        input.autocomplete = field.type === 'password' ? 'new-password' : 'off';
        input.spellcheck = false; input.setAttribute('spellcheck', 'false');
        input.setAttribute('autocorrect', 'off'); input.setAttribute('autocapitalize', 'off');
        if (field.accept) input.accept = field.accept;
        Object.assign(input.style, { display: 'block', width: '100%', boxSizing: 'border-box', margin: '.3rem 0 .8rem', padding: '.4rem' });
        return input;
      });
      const error = el('p', '', card); error.setAttribute('role', 'alert');
      const row = el('div', '', card); Object.assign(row.style, { display: 'flex', gap: '.5rem', flexWrap: 'wrap' });
      let busy = false; let settled = false;
      const complete = value => { if (settled) return; settled = true; window.removeEventListener('keydown', keydown); op.cancelStep = null; resolve(value); };
      const cancel = el('button', op.committed ? 'Schließen' : 'Abbrechen', row); cancel.type = 'button'; cancel.addEventListener('click', () => { if (!op.committing) { complete(null); finish(op); } });
      const submit = el('button', action, row); submit.type = 'button';
      async function proceed() {
        if (busy || !op.alive || settled) return;
        busy = true; submit.disabled = true; error.textContent = '';
        try {
          const values = inputs.map(input => input.type === 'file' ? input.files && input.files[0] : input.value);
          const result = validate ? await validate(values, inputs, {
            beginCommit() {
              op.committing = true; cancel.disabled = true; submit.textContent = 'Speichern…';
              for (const input of inputs) input.disabled = true;
              error.textContent = 'Der bestätigte Schutz wird gespeichert und zurückgelesen. Bitte warten.';
            }
          }) : values;
          op.committing = false;
          if (op.alive && !settled) complete(result);
        } catch (err) {
          if (op.committing) { op.committing = false; op.commitFailed = true; complete(null); return; }
          if (op.alive) error.textContent = err && err.code === 'RECOVERY_TOKEN_INVALID' ? 'Der vorbereitete Zugang ist abgelaufen oder ungültig. Bitte abbrechen und neu beginnen.' : 'Prüfung fehlgeschlagen. Bitte Eingaben prüfen oder den Vorgang neu beginnen.';
        } finally { busy = false; if (op.alive) submit.disabled = false; }
      }
      submit.addEventListener('click', proceed);
      function keydown(event) {
        if (event.key === 'Escape') { event.preventDefault(); if (!op.committing) { complete(null); finish(op); } }
        if (event.key === 'Enter' && inputs.includes(document.activeElement) && document.activeElement.tagName !== 'TEXTAREA') { event.preventDefault(); proceed(); }
        if (event.key === 'Tab') {
          const focusable = Array.from(card.querySelectorAll('input,textarea,button')).filter(node => !node.disabled);
          if (focusable.length === 0) { event.preventDefault(); return; }
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
      op.cancelStep = () => complete(null);
      window.addEventListener('keydown', keydown);
      if (extra) extra(card, row);
      op.overlay = overlay; document.body.appendChild(overlay);
      if (inputs[0]) inputs[0].focus(); else submit.focus();
    });
  }
  async function password(op, title, confirmation, current = false) {
    const fields = [{ label: current ? 'Aktuelles Passwort' : 'Neues Passwort', type: 'password' }];
    if (confirmation) fields.push({ label: 'Neues Passwort wiederholen', type: 'password' });
    const values = await step(op, title, confirmation ? 'Mindestens 6 Zeichen. Das Passwort wird unverändert übernommen.' : 'Bestätige deinen bisherigen Zugang.', fields, 'Weiter', null, values => {
      if (!values[0] || (confirmation && (values[0].length < 6 || values[0] !== values[1]))) throw new Error('PASSWORD');
      return values;
    });
    return values ? values[0] : null;
  }
  function summaryText(summary) {
    const info = summary.metadata || {};
    return 'Authentifizierter Bestand: ' + summary.students + ' Schüler, ' + summary.courses + ' Kurse, ' + summary.assessments + ' Leistungen. Sicherungszeit: ' + (info.savedAt || 'nicht verfügbar') + '. Kennung: ' + (info.datasetId || '') + ' / ' + (info.generationId || '') + '.';
  }
  async function confirmDraft(op, draft, replaceExisting = false) {
    if (!remember(op, draft)) return null;
    const saved = await step(op, 'Wiederherstellungscode sichern', 'Dieser Code ist ein gleichwertiger geheimer Zugang. Bewahre ihn getrennt von Sicherungen auf. Er wird nach Abschluss nicht erneut angezeigt. Bestehende Dateien behalten ihre alten Zugangsdaten.', [], 'Code gesichert – weiter', (card, row) => {
      const code = el('pre', draft.recoveryCode, card); code.dataset.recoveryCode = 'true'; Object.assign(code.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'all' });
      const print = el('button', 'Code drucken', row); print.type = 'button';
      print.addEventListener('click', () => {
        if (!op.alive) return;
        const popup = window.open('', '_blank', 'width=700,height=500');
        if (!popup) return;
        op.prints.push(popup); popup.document.title = 'Notenverwaltung – Wiederherstellungscode'; popup.document.body.textContent = '';
        el('h1', 'Notenverwaltung – Wiederherstellungscode', popup.document.body, popup.document);
        el('pre', draft.recoveryCode, popup.document.body, popup.document);
        el('p', 'Erstellt: ' + (draft.metadata.createdAt || '') + '\nBestand: ' + (draft.metadata.datasetId || '') + '\nGeneration: ' + (draft.metadata.generationId || ''), popup.document.body, popup.document);
        popup.print();
      });
    });
    if (!saved || !op.alive) return null;
    const committed = await step(op, 'Gesicherten Code prüfen', 'Gib den vollständigen Code aus deiner getrennt aufbewahrten Kopie ein. Erst danach wird der neue Schutz gespeichert.', [{ label: 'Wiederherstellungscode vollständig eingeben', type: 'textarea' }], 'Code bestätigen und speichern', null, async (values, inputs, controls) => {
      await Storage.confirmPreparedProtection(draft.token, values[0]);
      if (!op.alive) return null;
      controls.beginCommit();
      return Storage.commitPreparedProtection(draft.token, { replaceExisting });
    });
    if (op.commitFailed) throw new Error('RECOVERY_COMMIT_UNCONFIRMED');
    if (!op.alive || !committed) return null;
    op.tokens.delete(draft.token);
    op.committed = committed;
    return committed;
  }
  async function offerBackup(op) {
    const old = Storage.getRecoveryMigrationBackup();
    await step(op, 'Zugang eingerichtet', 'Passwort und Wiederherstellungscode gelten für den aktuellen Bestand und neue Sicherungen. Erstelle jetzt eine neue Sicherung. Ältere Sicherungen behalten ihre bisherigen Zugangsdaten.', [], 'Fertig', (card, row) => {
      const backup = el('button', 'Neues Backup herunterladen', row); backup.type = 'button';
      backup.addEventListener('click', async () => {
        if (backup.disabled || !op.alive) return;
        backup.disabled = true;
        try { const state = await Storage.loadCurrentSessionState(); if (!op.alive) return; const text = await Storage.encryptForBackup(JSON.stringify(state)); if (op.alive) await downloadText(text, 'notenverwaltung_recovery_backup.json'); }
        catch (error) { if (op.alive) el('p', 'Backup konnte nicht erstellt werden. Bitte später über Backup sichern.', card); }
        finally { if (op.alive) backup.disabled = false; }
      });
      if (old) {
        const previous = el('button', 'Verschlüsselte Alt-Kopie herunterladen', row); previous.type = 'button';
        previous.addEventListener('click', () => { if (op.alive) downloadText(old, 'notenverwaltung_vor_wiederherstellung.json'); });
      }
    });
  }
  function enroll({ password: suppliedPassword, state } = {}) {
    return run(async op => {
      const status = Storage.getRecoveryStatus();
      if (status.hasLocalData && !status.enabled && !await step(op, 'Wiederherstellung nachrüsten', 'Der Bestand erhält ein neues Format. Ältere HTML-Versionen können neue Daten und Sicherungen nicht lesen. Eine vorhandene verschlüsselte Alt-Kopie bleibt erhalten.', [], 'Nachrüstung beginnen')) return null;
      const encrypted = status.hasLocalData && Storage.isEncrypted();
      const pw = suppliedPassword || await password(op, encrypted ? 'Bisheriges Passwort bestätigen' : 'Passwort einrichten', !encrypted, encrypted);
      if (!pw || !op.alive) return null;
      const draft = await Storage.prepareRecoveryEnrollment({ password: pw, state });
      const result = await confirmDraft(op, draft);
      if (result && op.alive) await offerBackup(op);
      return result;
    });
  }
  function rotate({ currentPassword, newPassword, reason = 'password-change' } = {}) {
    return run(async op => {
      if (!Storage.getRecoveryStatus().enabled && !await step(op, 'Wiederherstellung ergänzen', 'Mit dem Passwortwechsel erhält der Bestand einen Wiederherstellungscode und ein neues Format. Ältere HTML-Versionen können neue Daten und Sicherungen nicht lesen. Eine verschlüsselte Alt-Kopie bleibt erhalten.', [], 'Nachrüstung beginnen')) return null;
      const current = currentPassword || await password(op, 'Aktuelles Passwort bestätigen', false, true);
      if (!current || !op.alive) return null;
      const next = newPassword || (reason === 'code-replacement' ? current : await password(op, 'Passwort ändern', true));
      if (!next || !op.alive) return null;
      const draft = await Storage.prepareCredentialRotation({ currentPassword: current, newPassword: next, reason });
      const result = await confirmDraft(op, draft);
      if (result && op.alive) await offerBackup(op);
      return result;
    });
  }
  async function source(op, checking) {
    let selected = 'local';
    const choice = await step(op, checking ? 'Code prüfen' : 'Zugang wiederherstellen', 'Wähle den lokalen Bestand oder eine Sicherungsdatei mit Wiederherstellungscode. Alte Dateien ohne Codezugang benötigen ihr bisheriges Passwort.', [], 'Weiter', (card, row) => {
      const local = el('button', 'Lokalen Bestand wählen', row); local.type = 'button';
      const file = el('button', 'Sicherungsdatei wählen', row); file.type = 'button';
      const hint = el('p', 'Auswahl: lokaler Bestand', card);
      local.addEventListener('click', () => { selected = 'local'; hint.textContent = 'Auswahl: lokaler Bestand'; });
      file.addEventListener('click', () => { selected = 'backup'; hint.textContent = 'Auswahl: Sicherungsdatei'; });
    });
    if (!choice || !op.alive) return null;
    const fields = selected === 'backup' ? [{ label: 'Verschlüsselte Sicherungsdatei', type: 'file', accept: '.json' }] : [];
    fields.push({ label: 'Vorhandenen Wiederherstellungscode eingeben', type: 'textarea' });
    return step(op, 'Bestand öffnen und prüfen', 'Der Code muss zu genau diesem Bestand bzw. dieser Sicherungsdatei gehören.', fields, 'Bestand authentifizieren', null, async values => {
      let text;
      if (selected === 'backup') {
        if (!values[0] || values[0].size > 20 * 1024 * 1024) throw new Error('FILE');
        text = await values[0].text();
      }
      if (!op.alive) return null;
      const args = { source: selected, ...(text === undefined ? {} : { text }), code: values[selected === 'backup' ? 1 : 0] };
      if (checking) return { summary: await Storage.verifyRecoveryCode(args) };
      const opened = await Storage.openRecoverySource(args);
      if (!op.alive) { Storage.cancelPreparedProtection(opened.sourceToken); return null; }
      return { ...opened, source: selected };
    });
  }
  function recover() {
    return run(async op => {
      const opened = await source(op, false);
      if (!opened || !remember(op, opened, 'sourceToken')) return null;
      const replacement = opened.source === 'backup' && Storage.getRecoveryStatus().hasLocalData;
      if (!await step(op, 'Bestand geprüft', summaryText(opened.summary) + (replacement ? ' ACHTUNG: Der vorhandene lokale Bestand wird vollständig ersetzt.' : ''), [], replacement ? 'Vorhandenen Bestand ausdrücklich ersetzen' : 'Diesen Bestand wiederherstellen')) return null;
      const next = await password(op, 'Neues Passwort festlegen', true);
      if (!next || !op.alive) return null;
      const draft = await Storage.prepareRecoveredProtection(opened.sourceToken, { newPassword: next });
      const result = await confirmDraft(op, draft, replacement);
      if (result && op.alive) await offerBackup(op);
      return result;
    });
  }
  function checkCode() {
    return run(async op => { const opened = await source(op, true); if (opened && op.alive) await step(op, 'Code erfolgreich geprüft', summaryText(opened.summary) + ' Der Bestand wurde nicht übernommen oder ersetzt.', [], 'Schließen'); return null; });
  }
  return Object.freeze({ enroll, rotate, recover, checkCode, dispose });
}
