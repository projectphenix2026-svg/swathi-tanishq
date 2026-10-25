import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Film, Image, MousePointerClick, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { api } from '../lib/api.js';
import { Pic, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { Highlighted } from '../components/PhonePreview.jsx';
import { dateOnly } from '../lib/format.js';
import { toFriendly } from '../lib/friendly.js';
import { READY_MESSAGES, iconFor } from '../lib/ready.js';
import { LANGS, isReadyText, langLabel, readyFor, readyIn } from '../lib/ready-lang.js';
import { useAuth } from '../lib/auth.js';
import { atLeast } from '@shared/roles.js';
import { useT } from '../lib/i18n.jsx';
import { META_BADGE, isApproved, metaState } from '../lib/approval.js';
import { SelectBar, allTicked, toggleIn } from '../components/SelectBar.jsx';
import { SortTh, useSort } from '../components/SortHead.jsx';

const STATUS = { approved: ['ok', 'Ready'], draft: ['neutral', 'Not finished'], rejected: ['bad', 'Needs a change'] };
const READY_NAMES = new Set(READY_MESSAGES.flatMap((m) => LANGS.map((l) => readyIn(m, l.code).name)));

/** Templates: the wording you reuse. Ready-made ones and the shop's own, in one place. */
export default function Templates() {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useAuth();
  const canWrite = atLeast(settings?.role, 'manager');
  const [asking, setAsking] = useState(null);
  // Ticked templates and what to do with them (send for approval, delete).
  const [sel, setSel] = useState(new Set());
  const [askBulk, setAskBulk] = useState(false);
  const [working, setWorking] = useState(false);
  async function bulkSubmit() {
    const picked = (list || []).filter((x) => sel.has(x.id) && metaState(x) !== 'approved' && metaState(x) !== 'waiting');
    if (!picked.length) return toast('The ticked templates are already approved or waiting for Meta.', 'bad');
    setWorking(true);
    let ok = 0;
    const failed = [];
    for (const x of picked) {
      try {
        await api(`/api/templates/${x.id}/submit-meta`, { method: 'POST' });
        ok += 1;
      } catch (e) {
        failed.push(`${x.name}: ${e.message}`);
      }
    }
    setWorking(false);
    toast(`${ok} sent to Meta for approval${failed.length ? `; ${failed.length} not sent (${failed[0]})` : ''}`, failed.length ? 'bad' : undefined);
    setSel(new Set());
    api('/api/templates').then((r) => setList(r.templates)).catch(() => {});
    return undefined;
  }
  async function bulkDelete() {
    setWorking(true);
    let ok = 0;
    const failed = [];
    for (const id of sel) {
      try {
        await api(`/api/templates/${id}`, { method: 'DELETE' });
        ok += 1;
      } catch (e) {
        failed.push(e.message);
      }
    }
    setWorking(false);
    setAskBulk(false);
    toast(`${ok} deleted${failed.length ? `; ${failed.length} kept (${failed[0]})` : ''}`, failed.length ? 'bad' : undefined);
    setSel(new Set());
    api('/api/templates').then((r) => setList(r.templates)).catch(() => {});
  }
  async function removeTemplate(tpl) {
    try {
      await api(`/api/templates/${tpl.id}`, { method: 'DELETE' });
      toast(`${tpl.name} deleted`);
      setList((l) => l.filter((x) => x.id !== tpl.id));
    } catch (e) {
      toast(e.message, 'bad');
    }
    setAsking(null);
  }
  // Ready-made templates are shown in this person's app language.
  const { lang } = useT();
  useEffect(() => {
    api('/api/templates').then((r) => setList(r.templates)).catch(() => setList([]));
  }, []);
  const anyWaiting = (list || []).some((t) => metaState(t) === 'waiting');
  useEffect(() => {
    if (!anyWaiting) return undefined;
    const timer = setInterval(() => api('/api/templates').then((r) => setList(r.templates)).catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [anyWaiting]);

  // A ready-made template is saved the first time it is opened, then edited like any other.
  async function openReady(m) {
    setBusy(m.key);
    try {
      const r = readyFor(m, lang, Boolean(settings?.salesCodes));
      let t = list.find((x) => x.name === r.name);
      if (!t) {
        ({ template: t } = await api('/api/templates', { method: 'POST', body: { name: r.name, body: r.body, sms_body: r.sms, buttons: r.buttons, language: r.language, category: 'marketing', status: 'approved' } }));
      } else if (isReadyText(t.body) && t.body !== r.body) {
        ({ template: t } = await api(`/api/templates/${t.id}`, { method: 'PUT', body: { ...t, body: r.body, sms_body: r.sms } }));
      }
      navigate(`/templates/${t.id}`);
    } catch (e) {
      toast(e.message, 'bad');
      setBusy(null);
    }
  }

  const own = (list || []).filter((t) => !READY_NAMES.has(t.name));
  // With WhatsApp connected, "approved" means approved by Meta: only those can be sent.
  const needsMeta = Boolean(settings?.metaTemplatesReady);
  const ok = (t) => (needsMeta ? isApproved(t) : t.status === 'approved');
  const all = [...own, ...(list || []).filter((t) => READY_NAMES.has(t.name))];
  const nApproved = all.filter(ok).length;
  // Approved ones first, so the ones that can be sent are easy to find.
  const filteredList = all.filter((t) => matches(q, t.name, t.body) && (show === 'all' || (show === 'approved') === ok(t)))
    .sort((a, b) => ok(b) - ok(a));
  // Click a heading to sort by it (otherwise approved first).
  const ORDER = { approved: 0, waiting: 1, not_sent: 2, rejected: 3 };
  const { sorted: shown, sort, toggle } = useSort(filteredList, {
    name: (t) => t.name.toLowerCase(),
    meta: (t) => (needsMeta ? ORDER[metaState(t)] : t.status === 'approved' ? 0 : 1),
    used: (t) => Number(t.used_in || 0),
    updated: (t) => Date.parse(t.updated_at),
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p>The wording you send again and again. Each customer gets their own name and details.</p>
        </div>
        {canWrite && <Link to="/templates/new" className="btn primary"><Plus size={18} />New template</Link>}
      </div>

      {canWrite && !q && show === 'all' && <div className="card card-pad stack" style={{ gap: 12 }}>
        <h2>Ready-made</h2>
        <div className="ready-grid">
          {READY_MESSAGES.map((m) => (
            <button key={m.key} type="button" className="ready-card" onClick={() => openReady(m)} disabled={!list || busy}>
              {busy === m.key ? <Spinner /> : <Pic name={m.pic} size={40} />}
              <b>{m.title}</b>
              <span className="subtle">{m.when}</span>
            </button>
          ))}
        </div>
      </div>}

      <div className="row between wrap" style={{ margin: '20px 0 10px', gap: 8 }}>
        <h2>Your templates</h2>
        {canWrite && <Link to="/templates/new" className="btn sm"><Plus size={16} />New template</Link>}
      </div>
      {!canWrite && <p className="subtle" style={{ marginTop: -4, marginBottom: 12 }}>Only the store manager or owner can add or change templates.</p>}
      {needsMeta && <p className="subtle" style={{ marginTop: -4, marginBottom: 12 }}>Only templates <b>approved by Meta</b> can be sent. Open a template and press “Save and send to Meta”; the status updates by itself.</p>}
      {!list ? (
        <div className="card stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={44} />)}</div>
      ) : list.length === 0 && !canWrite ? (
        <div className="card card-pad subtle">No templates yet.</div>
      ) : (
        <>
        {canWrite && (
          <SelectBar count={sel.size} onClear={() => { setSel(new Set()); setAskBulk(false); }}>
            {askBulk ? (
              <>
                <span>Delete {sel.size} template{sel.size === 1 ? '' : 's'}?</span>
                <button className="btn sm" onClick={() => setAskBulk(false)}>Keep</button>
                <button className="btn sm danger" disabled={working} onClick={bulkDelete}>{working ? <Spinner /> : 'Yes, delete'}</button>
              </>
            ) : (
              <>
                {needsMeta && <button className="btn sm primary" disabled={working} onClick={bulkSubmit}>{working ? <Spinner /> : <><Send size={15} />Send to Meta for approval</>}</button>}
                <button className="btn sm ghost danger" onClick={() => setAskBulk(true)}><Trash2 size={15} />Delete</button>
              </>
            )}
          </SelectBar>
        )}
        <div className="card">
          <div className="list-tools">
            <SearchBox value={q} onChange={setQ} placeholder="Search templates by name or words" style={{ flex: '1 1 260px' }} />
            <div className="chips">
              {[
                ['all', 'All', all.length],
                ['approved', needsMeta ? 'Approved by Meta' : 'Ready', nApproved],
                ['waiting', needsMeta ? 'Not approved yet' : 'Not ready yet', all.length - nApproved],
              ].map(([k, label, n]) => (
                <button key={k} type="button" className={`chip ${show === k ? 'on' : ''}`} onClick={() => setShow(k)}>{label}{list ? ` (${n})` : ''}</button>
              ))}
            </div>
          </div>
          {list.length > 0 && shown.length === 0 && <p className="subtle" style={{ padding: 20 }}>No template matches. Try other words, or make a new one.</p>}
          {list.length === 0 && <p className="subtle" style={{ padding: 20 }}>No templates yet. Make one with “New template”, or start from a ready-made one above.</p>}
          {shown.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {canWrite && <th className="tick-col"><input type="checkbox" aria-label="Select all shown" checked={allTicked(sel, shown.map((x) => x.id))} onChange={(e) => setSel(e.target.checked ? new Set(shown.map((x) => x.id)) : new Set())} /></th>}
                    <SortTh label="Template" k="name" sort={sort} toggle={toggle} />
                    <th>Has</th>
                    <SortTh label={needsMeta ? 'Meta approval' : 'Status'} k="meta" sort={sort} toggle={toggle} />
                    <SortTh label="Used" k="used" sort={sort} toggle={toggle} />
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => {
                    const [tone, label] = needsMeta ? META_BADGE[metaState(t)] : STATUS[t.status] || ['neutral', t.status];
                    return (
                      <tr key={t.id} className={`clickable ${ok(t) ? 'row-ok' : ''} ${sel.has(t.id) ? 'ticked' : ''}`} onClick={() => navigate(`/templates/${t.id}`)}>
                        {canWrite && <td className="tick-col" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.name}`} checked={sel.has(t.id)} onChange={() => setSel((x) => toggleIn(x, t.id))} /></td>}
                        <td className="cell-main">
                          <span className="row" style={{ gap: 8, minWidth: 0 }}><Pic name={iconFor(t.name)} size={26} /><b className="ellipsis">{t.name}</b>{!READY_NAMES.has(t.name) && <span className="badge neutral">{langLabel(t)}</span>}</span>
                          <div className="cell-sub ellipsis">{toFriendly(t.body).replace(/\s*\n+\s*/g, ' ')}</div>
                        </td>
                        <td><div className="tpl-has">
                          {t.video_url && <span title="Video"><Film size={16} />Video</span>}
                          {t.image_url && <span title="Photo"><Image size={16} />Photo</span>}
                          {t.buttons.length > 0 && <span title={t.buttons.map((x) => x.text).join(', ')}><MousePointerClick size={16} />{t.buttons.length === 1 ? t.buttons[0].text : `${t.buttons.length} buttons`}</span>}
                          {!t.video_url && !t.image_url && !t.buttons.length && <span className="subtle">Text only</span>}
                        </div></td>
                        <td>
                          <span className={`badge ${tone}`}>{tone === 'ok' && <Check size={13} />}{label}</span>
                          {needsMeta && metaState(t) === 'waiting' && <div className="subtle cell-sub">Updates by itself</div>}
                          {needsMeta && metaState(t) === 'rejected' && t.provider_reason && <div className="subtle cell-sub">{t.provider_reason}</div>}
                        </td>
                        <td className="subtle nowrap">{t.used_in ? `${t.used_in} time${t.used_in > 1 ? 's' : ''}` : 'Not yet'}<div className="cell-sub">Updated {dateOnly(t.updated_at)}</div></td>
                        <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
                          {asking === t.id ? (
                            <>
                              <span className="subtle">Delete?</span>
                              <button type="button" className="btn sm" onClick={() => setAsking(null)}>Keep</button>
                              <button type="button" className="btn sm danger" onClick={() => removeTemplate(t)}>Yes, delete</button>
                            </>
                          ) : (
                            <>
                              {ok(t) && <Link to={`/campaigns/new?template=${t.id}`} className="btn sm primary"><Send size={14} />Use</Link>}
                              <Link to={`/templates/${t.id}`} className="btn sm ghost"><Pencil size={14} />Edit</Link>
                              {canWrite && <button type="button" className="btn sm ghost danger" onClick={() => setAsking(t.id)} aria-label={`Delete ${t.name}`}><Trash2 size={14} /></button>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
