import markup from './admin.html?raw';
import { adminInput, approvedInput } from './inference.js';
import { publicThemes } from './domain.js';
import { applyStaticI18n, t, sourceLabelI18n } from './i18n.js';
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];

export function createAdmin({ config, services, checkin, setView, tell, refreshAdminI18n = () => {} }) {
  $('admin-view').innerHTML = markup;
  applyStaticI18n($('admin-view'));
  let admin = false, themes = [], questionResult = null, savedDraft = null;
  let questionBusy = false, aggregateBusy = false, adminEpoch = 0;
  function setTab(tab) {
    $$('[data-tab]').forEach(el => { const active = el.dataset.tab === tab; el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1; $('panel-' + el.dataset.tab).hidden = !active; });
  }
  function updateAuth() {
    $('admin-login').hidden = admin; $('sign-out').hidden = !admin;
    $('auth-status').textContent = admin ? (config.demo ? t('authDemoAdmin') : t('authAdmin')) : (config.demo ? t('authDemo') : t('authAnonymous'));
    $('aggregate').disabled = !admin || aggregateBusy;
    $('generate-question').disabled = !admin || questionBusy;
    $('use-question').disabled = !admin || questionBusy || !questionResult || !$('question-draft').value.trim();
  }
  function renderThemes() {
    const safe = publicThemes(themes); const map = $('theme-map'); map.replaceChildren(); map.dataset.count = String(safe.length);
    for (const tTheme of safe) {
      const li = document.createElement('li'); li.className = 'theme-island';
      const title = document.createElement('h2'); title.textContent = tTheme.title;
      const summary = document.createElement('p'); summary.textContent = tTheme.summary;
      const meta = document.createElement('div'); meta.className = 'island-meta';
      meta.textContent = t('adminThemeMeta', { strength: tTheme.band === '9+' ? t('adminStrengthHigh') : t('adminStrengthMedium'), band: tTheme.band });
      const track = document.createElement('div'); track.className = 'band-track'; track.setAttribute('aria-hidden', 'true');
      const level = ['3–5','6–8','9+'].indexOf(tTheme.band) + 1;
      for (let i=1;i<=3;i++) { const span = document.createElement('span'); span.dataset.level = String(i); if(i<=level) span.className='active'; track.append(span); }
      li.append(title, summary, meta, track); map.append(li);
    }
    $('theme-count').textContent = safe.length ? t('adminThemeCount', { count: safe.length }) : t('adminNoThemes');
  }
  async function login() {
    $('admin-login').disabled = true;
    try { await services.loginAdmin(); admin = true; const epoch = ++adminEpoch; updateAuth(); setView('admin'); const loaded = await services.themes(checkin.id); if (!admin || epoch !== adminEpoch) return; themes = loaded; renderThemes(); tell(config.demo ? t('tellAdminDemo') : t('tellAdminReady')); }
    catch { tell(t('tellAdminSignInFail')); }
    finally { $('admin-login').disabled = false; }
  }
  async function aggregate() {
    if (!admin || aggregateBusy) return;
    aggregateBusy = true; const epoch = adminEpoch; updateAuth(); tell(t('tellGrouping'));
    try {
      const { rows, participants } = await services.approved(checkin.id);
      if (!admin || epoch !== adminEpoch) return;
      if (participants.length < 3) { tell(t('tellNeedThree')); return; }
      const result = await services.infer('groupThemes', approvedInput(rows, participants));
      if (!admin || epoch !== adminEpoch) return;
      const saved = await services.saveThemes(checkin.id, result.value);
      if (!admin || epoch !== adminEpoch) return;
      themes = saved; renderThemes(); $('aggregate-source').textContent = sourceLabelI18n(result); tell(t('tellThemesUpdated'));
    } catch { tell(t('tellGroupFail')); }
    finally { aggregateBusy = false; updateAuth(); }
  }
  async function draftQuestion() {
    if (!admin || questionBusy) return;
    const request = $('question-request').value.trim(); if (!request) { tell(t('tellEnterRequest')); return; }
    questionBusy = true; questionResult = null; const epoch = adminEpoch; updateAuth(); $('execution-location').textContent = t('adminPreparingQuestion');
    try {
      const result = await services.infer('draftQuestion', adminInput(request));
      if (!admin || epoch !== adminEpoch) return;
      questionResult = result; $('question-draft').value = result.value; $('execution-location').textContent = sourceLabelI18n(result);
    } catch { $('execution-location').textContent = t('adminDraftFailed'); tell(t('tellDraftFail')); }
    finally { questionBusy = false; updateAuth(); }
  }
  $('admin-view').addEventListener('admin-i18n', () => { renderThemes(); updateAuth(); });
  $$('[data-tab]').forEach((el,index,all) => {
    el.addEventListener('click', () => setTab(el.dataset.tab));
    el.addEventListener('keydown', event => { if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const n = event.key==='Home'?0:event.key==='End'?all.length-1:(index+(event.key==='ArrowRight'?1:-1)+all.length)%all.length; setTab(all[n].dataset.tab); all[n].focus(); });
  });
  $('sign-out').addEventListener('click', async () => {
    admin = false; adminEpoch++; themes=[]; questionResult=null; savedDraft=null; renderThemes();
    $('question-request').value=''; $('question-draft').value=''; $('saved-question').hidden=true; $('no-saved-question').hidden=false;
    $('execution-location').textContent=t('sourceNotRun'); $('aggregate-source').textContent=t('sourceNotRun'); $('adoption-message').hidden=true;
    updateAuth(); setView('respondent');
    try { await services.logoutAdmin(); tell(t('tellSignOut')); } catch { tell(t('tellSignOutFail')); }
  });
  $('back-to-themes').addEventListener('click', () => setTab('themes'));
  $('aggregate').addEventListener('click', aggregate);
  $('generate-question').addEventListener('click', draftQuestion);
  $('question-draft').addEventListener('input', updateAuth);
  $('use-question').addEventListener('click', async () => {
    if(!admin || !questionResult || questionBusy) return;
    $('use-question').disabled=true;
    try {
      const epoch = adminEpoch;
      const draft = await services.saveDraft($('question-draft').value);
      if (!admin || epoch !== adminEpoch) return;
      savedDraft = draft;
      $('saved-question').querySelector('.pill').textContent = t('adminDraftPill');
      $('saved-question-text').textContent=savedDraft.question;
      $('saved-question-location').textContent=t('adminSavedLocation', { source: sourceLabelI18n(questionResult) });
      $('saved-question').hidden=false; $('no-saved-question').hidden=true; $('adoption-message').hidden=false;
      $('open-checkin').hidden=false; $('checkin-link').hidden=true;
      tell(t('tellDraftSaved'));
    } catch { tell(t('tellDraftSaveFail')); }
    finally { updateAuth(); }
  });
  $('open-checkin').addEventListener('click', async () => {
    if(!savedDraft || !admin) return; $('open-checkin').disabled=true;
    const epoch = adminEpoch, id = savedDraft.id;
    try { await services.openDraft(id); if (!admin || epoch !== adminEpoch) return; const link=new URL(location.href); link.search=''; link.searchParams.set('checkin',id); $('checkin-link').href=link.href; $('checkin-link').textContent=link.href; $('checkin-link').hidden=false; $('saved-question').querySelector('.pill').textContent = config.demo ? t('adminDemoOpenPill') : t('adminOpenPill'); $('saved-question-location').textContent=config.demo?t('adminDemoOpenNote'):t('adminOpenNote'); $('open-checkin').hidden=true; }
    catch { tell(t('tellOpenFail')); }
    finally { $('open-checkin').disabled=false; }
  });
  $('export-themes').addEventListener('click', () => {
    if(!admin) return;
    const blob = new Blob([JSON.stringify({ themes: publicThemes(themes) },null,2)], { type: 'application/json' });
    const href=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=href; a.download='themes.local.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(href),1000);
  });

  updateAuth(); renderThemes();
  refreshAdminI18n();
  return {
    async open(signIn = false) {
      setView('admin');
      if (!admin && (signIn || config.demo)) await login();
      else if (!admin) tell(t('tellSignInAdmin'));
    }
  };
}