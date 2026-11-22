import markup from './admin.html?raw';
import { sourceLabel, adminInput, approvedInput } from './inference.js';
import { publicThemes } from './domain.js';
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];

export function createAdmin({ config, services, checkin, setView, tell }) {
  // Only this bundled, static template is inserted; user and model text use textContent.
  $('admin-view').innerHTML = markup;
  let admin = false, themes = [], questionResult = null, savedDraft = null;
  let questionBusy = false, aggregateBusy = false, adminEpoch = 0;
  function setTab(tab) {
  $$('[data-tab]').forEach(el => { const active = el.dataset.tab === tab; el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1; $('panel-' + el.dataset.tab).hidden = !active; });
}
function updateAuth() {
  $('admin-login').hidden = admin; $('sign-out').hidden = !admin;
  $('auth-status').textContent = admin ? (config.demo ? 'Demo administrator' : 'Administrator signed in') : (config.demo ? 'Fictional data · memory only' : 'Anonymous respondent');
  $('aggregate').disabled = !admin || aggregateBusy;
  $('generate-question').disabled = !admin || questionBusy;
  $('use-question').disabled = !admin || questionBusy || !questionResult || !$('question-draft').value.trim();
}
function renderThemes() {
  const safe = publicThemes(themes); const map = $('theme-map'); map.replaceChildren(); map.dataset.count = String(safe.length);
  for (const t of safe) {
    const li = document.createElement('li'); li.className = 'theme-island';
    const title = document.createElement('h2'); title.textContent = t.title;
    const summary = document.createElement('p'); summary.textContent = t.summary;
    const meta = document.createElement('div'); meta.className = 'island-meta';
    meta.textContent = `Strength: ${t.band === '9+' ? 'High' : 'Medium'} · Respondent band: ${t.band} anonymous sign-ins`;
    const track = document.createElement('div'); track.className = 'band-track'; track.setAttribute('aria-hidden', 'true');
    const level = ['3–5','6–8','9+'].indexOf(t.band) + 1;
    for (let i=1;i<=3;i++) { const span = document.createElement('span'); span.dataset.level = String(i); if(i<=level) span.className='active'; track.append(span); }
    li.append(title, summary, meta, track); map.append(li);
  }
  $('theme-count').textContent = safe.length ? `${safe.length} visible themes` : 'No themes to display';
}
async function login() {
  $('admin-login').disabled = true;
  try { await services.loginAdmin(); admin = true; const epoch = ++adminEpoch; updateAuth(); setView('admin'); const loaded = await services.themes(checkin.id); if (!admin || epoch !== adminEpoch) return; themes = loaded; renderThemes(); tell(config.demo ? 'Fictional themes. Cloud steps are simulated.' : 'Administrator ready. Group approved responses when ready.'); }
  catch { tell('Administrator sign-in failed or this Google account lacks the unsigned_admin claim.'); }
  finally { $('admin-login').disabled = false; }
}
async function aggregate() {
  if (!admin || aggregateBusy) return;
  aggregateBusy = true; const epoch = adminEpoch; updateAuth(); tell('Grouping approved rewrites…');
  try {
    const { rows, participants } = await services.approved(checkin.id);
    if (!admin || epoch !== adminEpoch) return;
    if (participants.length < 3) { tell('At least 3 distinct anonymous sign-ins with approved responses are required. No cloud inference ran.'); return; }
    const result = await services.infer('groupThemes', approvedInput(rows, participants));
    if (!admin || epoch !== adminEpoch) return;
    const saved = await services.saveThemes(checkin.id, result.value);
    if (!admin || epoch !== adminEpoch) return;
    themes = saved; renderThemes(); $('aggregate-source').textContent = sourceLabel(result); tell('Themes updated. Below 3 people: hidden.');
  } catch { tell('Could not group approved responses. No new themes were displayed.'); }
  finally { aggregateBusy = false; updateAuth(); }
}
async function draftQuestion() {
  if (!admin || questionBusy) return;
  const request = $('question-request').value.trim(); if (!request) { tell('Enter your request for next week’s question.'); return; }
  questionBusy = true; questionResult = null; const epoch = adminEpoch; updateAuth(); $('execution-location').textContent = 'Preparing question draft…';
  try {
    const result = await services.infer('draftQuestion', adminInput(request));
    if (!admin || epoch !== adminEpoch) return;
    questionResult = result; $('question-draft').value = result.value; $('execution-location').textContent = sourceLabel(result);
  } catch { $('execution-location').textContent = 'Draft failed · no result'; tell('Could not draft a question. Your request remains editable.'); }
  finally { questionBusy = false; updateAuth(); }
}
  $$('[data-tab]').forEach((el,index,all) => {
    el.addEventListener('click', () => setTab(el.dataset.tab));
    el.addEventListener('keydown', event => { if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const n = event.key==='Home'?0:event.key==='End'?all.length-1:(index+(event.key==='ArrowRight'?1:-1)+all.length)%all.length; setTab(all[n].dataset.tab); all[n].focus(); });
  });
  $('sign-out').addEventListener('click', async () => {
    admin = false; adminEpoch++; themes=[]; questionResult=null; savedDraft=null; renderThemes();
    $('question-request').value=''; $('question-draft').value=''; $('saved-question').hidden=true; $('no-saved-question').hidden=false;
    $('execution-location').textContent='Not run yet'; $('aggregate-source').textContent='Not run yet'; $('adoption-message').hidden=true;
    updateAuth(); setView('respondent');
    try { await services.logoutAdmin(); tell('Administrator signed out.'); } catch { tell('Sign-out could not be confirmed. Close this tab.'); }
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
      $('saved-question').querySelector('.pill').textContent = 'Draft only · Not scheduled'; $('saved-question-text').textContent=savedDraft.question; $('saved-question-location').textContent=sourceLabel(questionResult)+' · Human confirmation required before opening.';
      $('saved-question').hidden=false; $('no-saved-question').hidden=true; $('adoption-message').hidden=false;
      $('open-checkin').hidden=false; $('checkin-link').hidden=true;
      tell('Saved as a draft. Nothing has been scheduled or opened.');
    } catch { tell('Could not save the question draft.'); }
    finally { updateAuth(); }
  });
  $('open-checkin').addEventListener('click', async () => {
    if(!savedDraft || !admin) return; $('open-checkin').disabled=true;
    const epoch = adminEpoch, id = savedDraft.id;
    try { await services.openDraft(id); if (!admin || epoch !== adminEpoch) return; const link=new URL(location.href); link.search=''; link.searchParams.set('checkin',id); $('checkin-link').href=link.href; $('checkin-link').textContent=link.href; $('checkin-link').hidden=false; $('saved-question').querySelector('.pill').textContent = config.demo ? 'Demo open · Simulated' : 'Open for responses'; $('saved-question-location').textContent=config.demo?'Demo opening simulated. Share links are not persisted.':'Open for responses · Share this link with your team.'; $('open-checkin').hidden=true; }
    catch { tell('Could not open this check-in. The draft remains available.'); }
    finally { $('open-checkin').disabled=false; }
  });
  $('export-themes').addEventListener('click', () => {
    if(!admin) return;
    const blob = new Blob([JSON.stringify({ themes: publicThemes(themes) },null,2)], { type: 'application/json' });
    const href=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=href; a.download='themes.local.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(href),1000);
  });

  updateAuth(); renderThemes();
  return {
    async open(signIn = false) {
      setView('admin');
      if (!admin && (signIn || config.demo)) await login();
      else if (!admin) tell('Sign in with an authorized Google administrator account to view themes.');
    }
  };
}
