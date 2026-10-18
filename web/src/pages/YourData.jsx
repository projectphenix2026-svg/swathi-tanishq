// Owner-only: download everything (customers, offers, sales codes) as one Excel file.
// Pulls the data in chunks of 2,000 rows, then builds the file in the browser.
import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Pic, Spinner, useToast } from '../components/ui.jsx';
import { dateOnly, dateTime } from '../lib/format.js';

async function all(path, onProgress) {
  let rows = [];
  let after = 0;
  for (;;) {
    const r = await api(`/api/export/${path}?after=${after}&limit=2000`);
    rows = rows.concat(r.rows);
    onProgress(rows.length);
    if (!r.next) return rows;
    after = r.next;
  }
}

const yes = (v) => (v ? 'Yes' : 'No');
const day = (v) => (v ? String(v).slice(0, 10) : '');

export function YourData({ lastExportAt, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);

  async function download() {
    setBusy(true);
    setCount(0);
    try {
      const XLSX = await import('xlsx');
      const customers = await all('customers', setCount);
      const offers = await all('offers', () => {});
      const codes = await all('bill-codes', () => {});
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customers.map((c) => ({
        Name: c.name || '', Phone: c.phone, City: c.city || '', Birthday: day(c.birthday), Anniversary: day(c.anniversary),
        'Last purchase': c.last_purchase || '', Interests: c.interests || '', Tags: (c.tags || []).join(', '),
        'Agreed to WhatsApp': yes(c.whatsapp_opt_in && !c.opted_out_at), 'Agreed on': day(c.opt_in_at), 'How they agreed': c.opt_in_source || '',
        'Agreed to SMS': yes(c.sms_opt_in), 'Said STOP on': day(c.opted_out_at), Added: day(c.created_at),
      }))), 'Customers');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(offers.map((o) => ({
        Offer: o.name, Message: o.message, Status: o.status, Started: day(o.started_at || o.created_at),
        Customers: o.total, Sent: o.sent, 'Reached phone': o.reached, Read: o.read, "Couldn't reach": o.failed, 'WhatsApp charge (₹)': o.cost,
      }))), 'Offers');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(codes.length ? codes.map((r) => ({
        Code: r.code, Customer: r.customer || '', Phone: r.phone, Offer: r.offer || '', 'Bill amount (₹)': r.amount, Date: day(r.redeemed_at), 'Entered by': r.entered_by || '', Note: r.note || '',
      })) : [{ Code: 'No sales codes used yet' }]), 'Sales codes');
      const stamp = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
      XLSX.writeFile(wb, `Swathi Tanishq data ${stamp}.xlsx`);
      await api('/api/export/done', { method: 'POST' }).catch(() => {});
      onDone?.();
      toast(`Downloaded ${customers.length} customers, ${offers.length} offers and ${codes.length} sales codes`);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" id="your-data">
      <div className="card-head">
        <div className="row" style={{ gap: 12 }}>
          <Pic name="chart" size={40} />
          <div>
            <h2>Your data</h2>
            <p className="subtle" style={{ margin: 0 }}>The shop owns its data. Keep a copy on your computer.</p>
          </div>
        </div>
      </div>
      <div className="stack" style={{ padding: 20 }}>
        <div className="row between wrap" style={{ gap: 12 }}>
          <span>
            <b>Download everything as Excel</b>
            <span className="subtle" style={{ display: 'block' }}>
              Customers, offers and sales codes in one file.{' '}
              {lastExportAt ? `Last downloaded ${dateTime(lastExportAt)}.` : 'Not downloaded yet.'}
            </span>
          </span>
          <button className="btn primary" onClick={download} disabled={busy}>
            {busy ? <><Spinner />{count ? `${count} customers…` : 'Preparing…'}</> : <><Download size={18} />Download (Excel)</>}
          </button>
        </div>
        <Alert tone="info">
          <b>Automatic safety copy:</b> Cloudflare also keeps the database restorable to any minute of the last 7 days. If something is deleted by mistake, ask the app’s maker to restore it. A weekly download is still your own copy{lastExportAt ? ` (last: ${dateOnly(lastExportAt)})` : ''}.
        </Alert>
      </div>
    </div>
  );
}
