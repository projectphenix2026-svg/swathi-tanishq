// "Reconnect the shop's WhatsApp number": opens Meta's Embedded Signup pop-up with
// featureType whatsapp_business_app_onboarding (coexistence), so the number works in the
// WhatsApp Business app and in Sandesh. When it finishes, the server re-subscribes our app
// and resumes sending if Meta says the number is connected.
(function () {
  const $ = (id) => document.getElementById(id);
  let setup = null;
  let finished = null; // what Meta's pop-up reported: { phoneNumberId, wabaId, event }
  let busy = false;

  function show(kind, text) {
    const out = $('out');
    out.hidden = false;
    out.className = `msg ${kind}`;
    out.textContent = text;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Meta's pop-up posts its progress to this page.
  window.addEventListener('message', (event) => {
    let host = '';
    try { host = new URL(event.origin).hostname; } catch { return; }
    if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return;
    let data;
    try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;
    const d = data.data || {};
    if (String(data.event || '').startsWith('FINISH')) {
      finished = { phoneNumberId: d.phone_number_id || '', wabaId: d.waba_id || '', event: data.event };
      report();
    } else if (data.event === 'CANCEL') {
      if (d.error_message) {
        show('bad', `Meta stopped with an error:\n${d.error_message}${d.error_id ? `\nError ${d.error_id}` : ''}${d.session_id ? `\nSession ${d.session_id}` : ''}\n\nNothing changed in Sandesh. Send a screenshot of this to the developer.`);
      } else {
        show('info', `The pop-up was closed${d.current_step ? ` at step “${d.current_step}”` : ''}. Nothing changed. Press the button to try again.`);
      }
      done();
    } else if (data.event === 'ERROR') {
      show('bad', `Meta reported an error${d.error_message ? `:\n${d.error_message}` : '.'}\n\nNothing changed in Sandesh.`);
      done();
    }
  });

  function done() {
    busy = false;
    $('go').disabled = !setup?.appId || !setup?.configId;
  }

  async function report() {
    if (!finished) return;
    show('info', 'Meta finished. Checking the number with Meta…');
    try {
      const r = await api('/api/whatsapp/business-app', { method: 'POST', body: JSON.stringify(finished) });
      if (r.connected) {
        show('ok', `Connected. ${setup?.phone || 'The number'} is back on WhatsApp for Sandesh.${r.requeued ? `\n${r.requeued} waiting message(s) are going out now.` : ''}${r.subscribed ? '' : '\nReplies may not reach Sandesh yet: tell the developer.'}\n\nThe WhatsApp Business app on the shop phone keeps working.`);
        $('state').textContent = 'Connected';
      } else {
        show('info', `Meta finished, but says the number is “${(r.status || 'unknown').toLowerCase()}” for now. It can take a few minutes.\nSandesh checks every 5 minutes and starts sending by itself once Meta says connected.`);
      }
    } catch (e) {
      show('bad', e.message);
    }
    done();
  }

  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (window.FB) return resolve();
      window.fbAsyncInit = function () {
        window.FB.init({ appId: setup.appId, autoLogAppEvents: true, xfbml: false, version: setup.graphVersion || 'v25.0' });
        resolve();
      };
      const s = document.createElement('script');
      s.src = 'https://connect.facebook.net/en_US/sdk.js';
      s.async = true;
      s.defer = true;
      s.crossOrigin = 'anonymous';
      s.onerror = () => reject(new Error('Could not load Facebook’s script. Check the internet connection, or turn off any ad blocker for this site.'));
      document.head.appendChild(s);
    });
  }

  function start() {
    if (busy) return;
    busy = true;
    finished = null;
    $('go').disabled = true;
    show('info', 'Meta’s pop-up is open. Follow the steps there.');
    window.FB.login((response) => {
      // The pop-up also sends a FINISH or CANCEL message; this covers it closing without one.
      setTimeout(() => {
        if (finished || !busy) return;
        if (response && response.authResponse) report();
        else { show('info', 'The pop-up was closed. Nothing changed. Press the button to try again.'); done(); }
      }, 1500);
    }, {
      config_id: setup.configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
    });
  }

  async function init() {
    try {
      setup = await api('/api/whatsapp/signup');
    } catch (e) {
      $('loading').hidden = true;
      if (e.status === 401 || e.status === 403) { $('login').hidden = false; return; }
      $('loading').hidden = false;
      $('loading').textContent = e.message;
      return;
    }
    $('loading').hidden = true;
    $('main').hidden = false;
    $('phone').textContent = setup.phone || 'Not connected in Sandesh yet';
    $('pnid').textContent = setup.phoneNumberId || '—';
    $('waba').textContent = setup.wabaId || '—';
    $('waba2').textContent = setup.wabaId || '';
    $('state').textContent = !setup.phoneNumberId ? 'Not connected: add the account in Settings first'
      : setup.paused ? `Disconnected (Meta error #${setup.paused.code}): sending paused` : 'Connected';
    if (!setup.appId || !setup.configId) { $('noconfig').hidden = false; return; }
    try {
      await loadSdk();
      $('go').disabled = false;
      $('go').addEventListener('click', start);
    } catch (e) {
      show('bad', e.message);
    }
  }

  init();
})();
