/* Shared project records are immutable revisions in the existing storage bucket.
   Each save adds a revision; it does not overwrite another project's document. */
(() => {
  'use strict';
  const TEAM = ['Ben', 'Jeff', 'Peter', 'Monette'];
  const STAGES = { planned: 'Planned', in_progress: 'In progress', blocked: 'Blocked', completed: 'Completed' };
  const FUNCTIONS = ['Cross-role', 'PATS', 'ATE', 'RAI', 'ASAP'];
  const ROOT = 'ai-projects-v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { tab: 'roles', view: 'active', projects: [], loaded: false, loading: false, error: '', editing: null, baseVersion: null, milestones: [], dirty: false, saving: false, editToken: 0 };
  let refreshDone = Promise.resolve(), finishRefresh = () => {};
  const canEdit = () => typeof currentUser !== 'undefined' && currentUser && TEAM.includes(currentUser.name) && !(typeof isGuestMode !== 'undefined' && isGuestMode);
  const actor = () => canEdit() ? currentUser.name : 'Guest';
  const store = () => {
    if (typeof sb === 'undefined') throw new Error('The shared connection is unavailable. Refresh the dashboard and try again.');
    return sb.storage.from('research-files');
  };
  const progress = p => p.status === 'completed' ? 100 : p.milestones.length ? Math.round(p.milestones.filter(m => m.done).length * 100 / p.milestones.length) : Math.max(0, Math.min(100, Number(p.progress) || 0));
  const dateText = value => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No target date';
  const safeLink = value => {
    if (!value) return '';
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch (_) { return ''; }
  };
  const message = error => error?.message || String(error || 'Something went wrong. Please try again.');
  function normalize(raw, id) {
    if (!raw || raw.schema !== 1 || raw.id !== id || !UUID.test(id) || typeof raw.title !== 'string' || !raw.title.trim() || !TEAM.includes(raw.owner) || !Object.hasOwn(STAGES, raw.status)) throw new Error('A project record could not be read. Please contact the project owner.');
    return { ...raw, title: raw.title.slice(0, 120), summary: String(raw.summary || '').slice(0, 2000), kind: raw.kind === 'team' ? 'team' : 'individual', contributors: Array.isArray(raw.contributors) ? raw.contributors.filter(n => TEAM.includes(n)) : [], function: FUNCTIONS.includes(raw.function) ? raw.function : 'Cross-role', milestones: Array.isArray(raw.milestones) ? raw.milestones.slice(0, 80).map(m => ({ title: String(m.title || '').slice(0, 240), done: m.done === true })).filter(m => m.title.trim()) : [], blocker: String(raw.blocker || '').slice(0, 1000), updateNote: String(raw.updateNote || '').slice(0, 2000), link: safeLink(raw.link), dueDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate || '') ? raw.dueDate : '' };
  }
  async function listVersions(id, limit = 1) {
    const { data, error } = await store().list(`${ROOT}/${id}`, { limit, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;
    return (data || []).filter(f => f.id && /^\d{13}-[0-9a-f-]+\.json$/i.test(f.name));
  }
  async function readVersion(id, version) {
    const { data, error } = await store().download(`${ROOT}/${id}/${version}`);
    if (error) throw error;
    const project = normalize(JSON.parse(await data.text()), id);
    return { ...project, _version: version };
  }
  async function latest(id) {
    const versions = await listVersions(id, 2);
    if (!versions.length) return null;
    const project = await readVersion(id, versions[0].name);
    if (versions.length > 1 && project.parentVersion !== versions[1].name) {
      const previous = await readVersion(id, versions[1].name);
      project._concurrent = project.parentVersion === previous.parentVersion;
    }
    return project;
  }
  async function readProjects() {
    const folders = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await store().list(ROOT, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      folders.push(...(data || []).filter(f => !f.id && UUID.test(f.name)).map(f => f.name));
      if (!data || data.length < 100) break;
    }
    const output = [];
    // Bound concurrent downloads for larger team portfolios.
    for (let i = 0; i < folders.length; i += 4) output.push(...await Promise.all(folders.slice(i, i + 4).map(latest)));
    return output.filter(Boolean);
  }
  function notice(text) {
    $('ai-project-notice').textContent = text;
    $('ai-project-notice').className = text ? 'ai-project-warning' : '';
  }
  function render() {
    const active = state.projects.filter(p => p.status !== 'completed');
    const blocked = active.filter(p => p.status === 'blocked');
    const completed = state.projects.filter(p => p.status === 'completed');
    $('ai-add-project').hidden = !canEdit();
    $('ai-project-stats').innerHTML = [['Active projects', active.length, 'Planned and ongoing'], ['Blocked', blocked.length, 'Help or a decision needed'], ['Completed', completed.length, 'Delivered work stays visible']].map(([label, count, sub]) => `<div class="ai-project-stat"><span>${label}</span><strong>${state.loaded ? count : '—'}</strong><small>${sub}</small></div>`).join('');
    document.querySelectorAll('[data-ai-view]').forEach(b => { const on = b.dataset.aiView === state.view; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('ai-refresh-projects').disabled = state.loading;
    if (!state.loaded) {
      $('ai-project-list').innerHTML = `<div class="ai-empty"><h2>${state.error ? 'Projects could not be loaded' : 'Loading shared projects…'}</h2><p>${state.error ? 'Use Refresh to reconnect. No empty portfolio is assumed when the connection fails.' : 'Getting the latest updates for the team.'}</p></div>`;
      return;
    }
    const search = $('ai-project-search').value.trim().toLowerCase();
    const kind = $('ai-project-type-filter').value;
    const owner = $('ai-project-owner-filter').value;
    const filtered = state.projects.filter(p => (state.view === 'all' || (state.view === 'completed' ? p.status === 'completed' : p.status !== 'completed')) && (!kind || p.kind === kind) && (!owner || p.owner === owner) && (!search || [p.title, p.summary, p.owner, p.blocker, ...p.contributors].join(' ').toLowerCase().includes(search))).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (!filtered.length) {
      const empty = state.projects.length === 0;
      $('ai-project-list').innerHTML = `<div class="ai-empty"><h2>${empty ? 'Your next project starts here.' : state.view === 'completed' && !search && !kind && !owner ? 'Completed work will live here.' : 'No matching projects'}</h2><p>${empty ? 'Add an individual or team project, define its milestones, and make the next step visible.' : 'Try another view or adjust the filters.'}</p>${empty && canEdit() ? '<button class="btn-sm btn-accent" data-ai-add>+ Add your first project</button>' : ''}</div>`;
      return;
    }
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    $('ai-project-list').innerHTML = filtered.map(p => {
      const percent = progress(p);
      const done = p.milestones.filter(m => m.done).length;
      const next = p.milestones.find(m => !m.done);
      const overdue = p.dueDate && p.dueDate < localToday && p.status !== 'completed';
      return `<article class="ai-project-card" data-stage="${p.status}"><div class="ai-project-card-top"><span class="ai-project-card-type">${p.kind === 'team' ? 'TEAM' : 'INDIVIDUAL'} · ${esc(p.function)}</span><span class="ai-stage">${STAGES[p.status]}</span></div><h2>${esc(p.title)}</h2>${p._concurrent ? '<div class="ai-project-warning">Concurrent updates detected. Review recent revisions in project details.</div>' : ''}${p.summary ? `<p class="ai-project-description">${esc(p.summary)}</p>` : ''}<div class="ai-project-people"><strong>${esc(p.owner)}</strong> · Owner${p.kind === 'team' ? `<br>Team: ${esc([...new Set([p.owner, ...p.contributors])].join(', '))}` : ''}</div><div class="ai-project-progress-label"><span>Progress</span><strong>${percent}%</strong></div><div class="ai-project-progress" role="progressbar" aria-label="${esc(p.title)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div><div class="ai-project-progress-note">${p.milestones.length ? `${done} of ${p.milestones.length} milestones completed` : p.status === 'completed' ? 'Project completed' : 'Progress reported by the project team'}</div>${p.milestones.length ? `<details class="ai-project-milestones"><summary>View milestones</summary><ul>${p.milestones.map(m => `<li class="${m.done ? 'done' : ''}">${m.done ? '✓' : '○'} ${esc(m.title)}</li>`).join('')}</ul></details>` : ''}<div class="ai-project-next"><strong>${p.status === 'completed' ? 'COMPLETED' : 'NEXT MILESTONE'}</strong>${p.status === 'completed' ? dateText((p.completedAt || p.updatedAt || '').slice(0, 10)) : esc(next?.title || (p.milestones.length ? 'All milestones done — update the project status when ready.' : 'Add milestones to define the next deliverable.'))}</div>${p.status === 'blocked' && p.blocker ? `<div class="ai-project-blocker"><strong>Help needed</strong><br>${esc(p.blocker)}</div>` : ''}${p.updateNote ? `<div class="ai-project-result"><strong>${p.status === 'completed' ? 'Outcome / latest update' : 'Latest update'}</strong><br>${esc(p.updateNote)}</div>` : ''}<footer><span class="ai-project-due${overdue ? ' overdue' : ''}">${overdue ? 'Overdue · ' : 'Target · '}${dateText(p.dueDate)}</span><div class="ai-project-card-actions">${p.link ? `<a class="btn-sm btn-sec" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">Open project ↗</a>` : ''}<button type="button" class="btn-sm btn-sec" data-ai-edit="${p.id}">${canEdit() ? 'Update project' : 'View details'}</button></div></footer></article>`;
    }).join('');
  }
  async function loadProjects() {
    if (state.loading) return refreshDone;
    state.loading = true;
    refreshDone = new Promise(resolve => { finishRefresh = resolve; });
    render();
    $('ai-project-sync').textContent = 'Refreshing shared projects…';
    try {
      state.projects = await readProjects();
      state.loaded = true;
      state.error = '';
      notice('');
      $('ai-project-sync').textContent = `Shared with the team · Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (e) {
      state.error = message(e);
      notice(`Unable to refresh projects: ${state.error}`);
      $('ai-project-sync').textContent = state.loaded ? 'Showing the last successfully loaded project list.' : 'Shared connection unavailable.';
    } finally { state.loading = false; render(); finishRefresh(); }
  }
  async function refreshAfterSave() {
    if (state.loading) await refreshDone;
    await loadProjects();
  }
  function setTab(name) {
    state.tab = name === 'status' ? 'status' : 'roles';
    for (const tab of ['roles', 'status']) {
      const on = tab === state.tab;
      $(`ai-pane-${tab}`).hidden = !on;
      $(`ai-tab-${tab}`).classList.toggle('active', on);
      $(`ai-tab-${tab}`).setAttribute('aria-selected', String(on));
      $(`ai-tab-${tab}`).tabIndex = on ? 0 : -1;
    }
    if (state.tab === 'status') { render(); loadProjects(); }
  }
  let imageZoom = 1, imageBase = 0;
  function resizeImage() {
    const image = $('ai-image-full'), stage = $('ai-image-stage');
    if (!image.naturalWidth) return;
    imageBase = Math.min(stage.clientWidth - 40, (stage.clientHeight - 40) * image.naturalWidth / image.naturalHeight, image.naturalWidth);
    image.style.width = `${Math.max(30, imageBase) * imageZoom}px`;
    image.style.height = 'auto';
    $('ai-image-zoom-label').textContent = imageZoom === 1 ? 'Fit' : `${Math.round(imageZoom * 100)}%`;
  }
  function openImage(src, title) {
    if (!/^\/external\/team\/[a-z0-9-]+\.png$/.test(src)) return;
    const dialog = $('ai-image-dialog'), image = $('ai-image-full');
    imageZoom = 1;
    $('ai-image-title').textContent = title || 'Team reference';
    $('ai-image-error').hidden = true;
    image.hidden = false;
    image.alt = title || 'Team reference image';
    image.onload = () => { resizeImage(); $('ai-image-stage').scrollTo(0, 0); };
    image.onerror = () => { image.hidden = true; $('ai-image-error').hidden = false; };
    image.src = src;
    if (!dialog.open) dialog.showModal();
    resizeImage();
  }
  function renderMilestones() {
    $('ai-p-milestone-list').innerHTML = state.milestones.map((m, i) => `<div class="ai-milestone-row"><input type="checkbox" data-ai-milestone-check="${i}" aria-label="Complete milestone ${i + 1}" ${m.done ? 'checked' : ''}><input type="text" class="finp" maxlength="240" value="${esc(m.title)}" data-ai-milestone-title="${i}" aria-label="Milestone ${i + 1}"><button type="button" data-ai-milestone-remove="${i}" aria-label="Remove milestone ${i + 1}">✕</button></div>`).join('');
    syncProgress();
  }
  function syncProgress() {
    const completed = $('ai-p-status').value === 'completed';
    const hasMilestones = state.milestones.length > 0;
    $('ai-p-progress').readOnly = hasMilestones || completed;
    if (completed) $('ai-p-progress').value = '100';
    else if (hasMilestones) $('ai-p-progress').value = String(Math.round(state.milestones.filter(m => m.done).length * 100 / state.milestones.length));
    $('ai-progress-help').textContent = completed ? 'Completed projects are shown at 100%.' : hasMilestones ? 'Calculated from completed milestones.' : 'Set manually, or add milestones to calculate it.';
    $('ai-p-members-field').hidden = $('ai-p-kind').value !== 'team';
    $('ai-p-blocker').required = $('ai-p-status').value === 'blocked';
  }
  async function showHistory(id, token) {
    $('ai-project-history').textContent = id ? 'Loading recent updates…' : 'History will appear after the first save.';
    if (!id) return;
    try {
      const versions = await listVersions(id, 8);
      const history = await Promise.all(versions.map(v => readVersion(id, v.name)));
      if (token !== state.editToken) return;
      $('ai-project-history').innerHTML = history.map(p => `<div class="ai-history-entry"><strong>${STAGES[p.status]} · ${progress(p)}%</strong><small>${esc(p.updatedBy || 'Team')} · ${esc(new Date(p.updatedAt).toLocaleString())}</small>${esc(p.updateNote || (p.parentVersion ? 'Project details updated.' : 'Project created.'))}<details><summary>View this revision</summary><div><strong>${esc(p.title)}</strong><br>${esc(p.owner)} · ${esc(p.summary)}${p.milestones.length ? `<ul>${p.milestones.map(m => `<li>${m.done ? '✓' : '○'} ${esc(m.title)}</li>`).join('')}</ul>` : ''}${p.blocker ? `<p>Blocker: ${esc(p.blocker)}</p>` : ''}</div></details></div>`).join('');
    } catch (e) { if (token === state.editToken) $('ai-project-history').textContent = `History could not be loaded: ${message(e)}`; }
  }
  function setFormDisabled(disabled) {
    $('ai-project-form').querySelectorAll('input,textarea,select,button').forEach(el => {
      if (disabled) { el.dataset.aiWasDisabled = String(el.disabled); el.disabled = true; }
      else { el.disabled = el.dataset.aiWasDisabled === 'true'; delete el.dataset.aiWasDisabled; }
    });
  }
  function openProject(id) {
    if (!id && !canEdit()) return;
    const project = id ? state.projects.find(p => p.id === id) : null;
    if (id && !project) return;
    state.editing = project;
    state.baseVersion = project?._version || null;
    state.milestones = (project?.milestones || []).map(m => ({ ...m }));
    state.dirty = false;
    state.editToken++;
    const form = $('ai-project-form');
    form.reset();
    form.querySelectorAll('[disabled]').forEach(el => { el.disabled = false; });
    $('ai-project-dialog-title').textContent = project ? (canEdit() ? 'Update project' : 'Project details') : 'Add project';
    $('ai-p-title').value = project?.title || '';
    $('ai-p-summary').value = project?.summary || '';
    $('ai-p-kind').value = project?.kind || 'individual';
    $('ai-p-owner').value = project?.owner || (canEdit() ? actor() : '');
    $('ai-p-function').value = project?.function || 'Cross-role';
    $('ai-p-status').value = project?.status || 'planned';
    $('ai-p-due').value = project?.dueDate || '';
    $('ai-p-progress').value = project ? String(progress(project)) : '0';
    $('ai-p-blocker').value = project?.blocker || '';
    $('ai-p-link').value = project?.link || '';
    $('ai-p-note').value = project?.updateNote || '';
    form.querySelectorAll('[name=ai-member]').forEach(el => { el.checked = project?.contributors?.includes(el.value) || el.value === (project?.owner || actor()); });
    $('ai-project-save-error').textContent = '';
    $('ai-project-save').textContent = 'Save project';
    $('ai-project-save-info').textContent = !canEdit() ? 'Guest view · Project details are read-only.' : project?._concurrent ? 'Concurrent updates found. Review recent revisions before saving.' : 'Updates are shared with the team.';
    document.querySelector('.ai-project-history').open = !!project?._concurrent;
    renderMilestones();
    if (!canEdit()) form.querySelectorAll('input,textarea,select,button:not(#ai-project-close):not(#ai-project-cancel)').forEach(el => { el.disabled = true; });
    $('ai-project-save').hidden = !canEdit();
    showHistory(project?.id, state.editToken);
    $('ai-project-dialog').showModal();
  }
  function closeEditor() {
    if (state.saving) return;
    if (state.dirty && !confirm('Discard unsaved project changes?')) return;
    $('ai-project-dialog').close();
    state.editToken++;
    state.dirty = false;
  }
  function addMilestone() {
    const title = $('ai-p-milestone-new').value.trim();
    if (!title || !canEdit() || state.saving) return;
    if (state.milestones.length >= 80) { $('ai-project-save-error').textContent = 'Keep each project to 80 milestones or fewer.'; return; }
    state.milestones.push({ title, done: $('ai-p-status').value === 'completed' });
    $('ai-p-milestone-new').value = '';
    state.dirty = true;
    renderMilestones();
    $('ai-p-milestone-new').focus();
  }
  async function saveProject(event) {
    event.preventDefault();
    if (!canEdit() || state.saving) return;
    const form = $('ai-project-form');
    if (!form.reportValidity()) return;
    if ($('ai-p-milestone-new').value.trim()) addMilestone();
    const title = $('ai-p-title').value.trim();
    const owner = $('ai-p-owner').value;
    const status = $('ai-p-status').value;
    const blocker = $('ai-p-blocker').value.trim();
    const milestones = state.milestones.map(m => ({ title: m.title.trim(), done: m.done })).filter(m => m.title);
    if (!title || !TEAM.includes(owner) || !Object.hasOwn(STAGES, status)) { $('ai-project-save-error').textContent = 'Enter a project name, owner, and valid status.'; return; }
    if (status === 'blocked' && !blocker) { $('ai-project-save-error').textContent = 'Describe the blocker so the team knows where help is needed.'; return; }
    const rawLink = $('ai-p-link').value.trim();
    if (rawLink && !safeLink(rawLink)) { $('ai-project-save-error').textContent = 'Use an http or https project link.'; return; }
    if (status === 'completed') milestones.forEach(m => { m.done = true; });
    const id = state.editing?.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const project = { schema: 1, id, title, summary: $('ai-p-summary').value.trim(), kind: $('ai-p-kind').value, owner, contributors: $('ai-p-kind').value === 'team' ? [...new Set([owner, ...Array.from(form.querySelectorAll('[name=ai-member]:checked')).map(el => el.value)])] : [owner], function: $('ai-p-function').value, status, progress: Number($('ai-p-progress').value), milestones, blocker, dueDate: $('ai-p-due').value, link: safeLink(rawLink), updateNote: $('ai-p-note').value.trim(), createdAt: state.editing?.createdAt || now, createdBy: state.editing?.createdBy || actor(), updatedAt: now, updatedBy: actor(), completedAt: status === 'completed' ? state.editing?.completedAt || now : null, parentVersion: state.baseVersion };
    project.progress = progress(project);
    state.saving = true;
    $('ai-project-save-error').textContent = '';
    $('ai-project-save').textContent = 'Saving…';
    setFormDisabled(true);
    let saved = false;
    try {
      const current = await latest(id);
      if ((current?._version || null) !== state.baseVersion) throw new Error('Another teammate updated this project. Close the editor, refresh the list, and reopen it before saving. Your unsaved changes remain here.');
      const version = `${Date.now()}-${crypto.randomUUID()}.json`;
      const { error } = await store().upload(`${ROOT}/${id}/${version}`, new Blob([JSON.stringify(project)], { type: 'application/json' }), { contentType: 'application/json', cacheControl: '0', upsert: false });
      if (error) throw error;
      saved = true;
      state.dirty = false;
      const check = await latest(id);
      const concurrent = check?._version !== version;
      $('ai-project-dialog').close();
      state.editToken++;
      if (status === 'completed') state.view = 'completed';
      else if (state.view === 'completed') state.view = 'active';
      await refreshAfterSave();
      if (concurrent) notice('Your update was saved, but another update also arrived. Review the latest project details and recent updates before making further changes.');
      if (typeof showToast === 'function') showToast(concurrent ? 'Project update saved — review latest details' : 'Project saved for the team');
    } catch (e) {
      if (saved) {
        // The upload succeeded; a failed confirmation must not invite a duplicate save.
        $('ai-project-dialog').close();
        state.editToken++;
        await refreshAfterSave();
        notice('Your update was saved, but its latest version could not be confirmed. Refresh before editing again.');
      } else $('ai-project-save-error').textContent = `Project was not saved: ${message(e)}`;
    } finally {
      state.saving = false;
      setFormDisabled(false);
      $('ai-project-save').textContent = 'Save project';
    }
  }
  function bind() {
    const page = $('page-aiprojects');
    if (!page) return;
    page.addEventListener('click', event => {
      const image = event.target.closest('[data-ai-image]');
      if (image) { event.preventDefault(); openImage(image.dataset.aiImage, image.dataset.aiImageTitle); return; }
      const tab = event.target.closest('[data-ai-tab]');
      if (tab) { setTab(tab.dataset.aiTab); return; }
      const view = event.target.closest('[data-ai-view]');
      if (view) { state.view = view.dataset.aiView; render(); return; }
      const edit = event.target.closest('[data-ai-edit]');
      if (edit) { openProject(edit.dataset.aiEdit); return; }
      if (event.target.closest('[data-ai-add]')) openProject();
    });
    page.querySelector('.ai-section-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const name = event.key === 'Home' ? 'roles' : event.key === 'End' ? 'status' : state.tab === 'roles' ? 'status' : 'roles';
      setTab(name);
      $(`ai-tab-${name}`).focus();
    });
    $('ai-add-project').addEventListener('click', () => openProject());
    $('ai-refresh-projects').addEventListener('click', loadProjects);
    ['ai-project-search', 'ai-project-type-filter', 'ai-project-owner-filter'].forEach(id => $(id).addEventListener(id.includes('search') ? 'input' : 'change', render));
    $('ai-image-close').addEventListener('click', () => $('ai-image-dialog').close());
    $('ai-image-dialog').addEventListener('click', event => {
      const zoom = event.target.closest('[data-ai-zoom]');
      if (zoom) { imageZoom = zoom.dataset.aiZoom === 'reset' ? 1 : Math.min(4, Math.max(0.5, imageZoom + (zoom.dataset.aiZoom === 'in' ? 0.5 : -0.5))); resizeImage(); }
      if (event.target === $('ai-image-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); }
    });
    window.addEventListener('resize', () => { if ($('ai-image-dialog').open) resizeImage(); });
    $('ai-project-form').addEventListener('submit', saveProject);
    $('ai-project-form').addEventListener('input', event => {
      state.dirty = true;
      if (event.target.dataset.aiMilestoneTitle !== undefined) state.milestones[Number(event.target.dataset.aiMilestoneTitle)].title = event.target.value;
    });
    $('ai-project-form').addEventListener('change', event => {
      if (event.target.dataset.aiMilestoneCheck !== undefined) { state.milestones[Number(event.target.dataset.aiMilestoneCheck)].done = event.target.checked; syncProgress(); }
      if (event.target.id === 'ai-p-status' && event.target.value === 'completed') { state.milestones.forEach(m => { m.done = true; }); renderMilestones(); }
      syncProgress();
    });
    $('ai-project-form').addEventListener('click', event => {
      const remove = event.target.closest('[data-ai-milestone-remove]');
      if (remove && !state.saving && canEdit()) { state.milestones.splice(Number(remove.dataset.aiMilestoneRemove), 1); state.dirty = true; renderMilestones(); }
    });
    $('ai-p-milestone-add').addEventListener('click', addMilestone);
    $('ai-p-milestone-new').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addMilestone(); } });
    $('ai-project-close').addEventListener('click', closeEditor);
    $('ai-project-cancel').addEventListener('click', closeEditor);
    $('ai-project-dialog').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
    window.addEventListener('beforeunload', event => { if (state.dirty && $('ai-project-dialog').open) { event.preventDefault(); event.returnValue = ''; } });
    setInterval(() => { if (document.visibilityState === 'visible' && page.classList.contains('active') && state.tab === 'status' && !$('ai-project-dialog').open && !state.saving) loadProjects(); }, 60000);
    window.initAiProjects = () => { $('ai-add-project').hidden = !canEdit(); if (state.tab === 'status') loadProjects(); };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
