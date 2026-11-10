# Add a breakpoint (debugging starter)

Two breakpoints, one on each side of the wire. Paste `A` into Apps Script, `B` into the browser console. Both are temporary — delete them before a release.

---

## A. Apps Script side — paste into `backend/Code.gs`

**A1 — the breakpoint itself.** In `doPost()`, immediately before the dispatch call, add one line:

```js
    var context = makeRequestContext(payload, reqId, action);
    delete payload.__client;
    debugger; // TEMPORARY — Apps Script debugger stops here on the next request
    var data = dispatchAction(action, body.token, payload, context);
```

Run it: **Deploy → Test deployments** (or open the Web App and send one request), then in the Apps Script editor open **Executions**. The `debugger` statement is where you attach the Apps Script debugger; a plain gutter breakpoint on that same line works too, but Apps Script breakpoints only fire when you start the request from **Run** while the editor is open, so `debugRoundTrip()` below is usually easier to iterate with.

**A2 — a callable probe.** Paste this at the bottom of `backend/Code.gs` and press **Run** with `debugRoundTrip` selected. It round-trips a real request through `doPost` without a browser, so you can see the exact JSON envelope and the `reqId` match:

```js
/** TEMPORARY DEBUG PROBE — delete before release. */
function debugRoundTrip() {
  var reqId = 'debug-' + Date.now();
  var action = 'public.config';
  var body = {
    action: action,
    token: null,
    payload: { __client: { userAgent: 'apps-script-editor' } },
    reqId: reqId
  };

  var response = doPost({ postData: { contents: JSON.stringify(body) } });
  // ContentService output exposes the JSON string as .text (there is no getContent()).
  var envelope = JSON.parse(response.text);

  Logger.log('action:            ' + action);
  Logger.log('ok:                ' + envelope.ok);
  Logger.log('reqId echoes back: ' + (envelope.reqId === reqId) + ' (' + envelope.reqId + ')');
  Logger.log('error:             ' + (envelope.error ? envelope.error.code + ' — ' + envelope.error.message : 'none'));
  Logger.log('body:              ' + JSON.stringify(envelope, null, 2).slice(0, 4000));
  return envelope;
}
```

Useful variations: change `action` to `'auth.login'` with `payload = { employeeId: '…', password: '…' }` and `token: null` to test sign-in, or set `token` to a real session token to test an authenticated action. Add `debugger;` as the first line of `dispatchAction` in `backend/Code.gs` if you want to stop before permission checks:

```js
function dispatchAction(action, token, payload, context) {
  debugger; // TEMPORARY — stops before the registry lookup and auth
  var definition = registryEntry(action);
```

---

## B. Browser side — paste into the DevTools console

This reproduces the exact transport in `assets/js/api.js` (token from `sessionStorage`, `reqId` echo check, `text/plain` body) and prints one table row per call, so a failure is no longer silent:

```js
/* TEMPORARY DEBUG — paste in DevTools console on the app page. */
const API_URL = 'PASTE_YOUR_DEPLOYMENT_EXEC_URL'; // e.g. https://script.google.com/macros/s/AKfy.../exec
const TOKEN_KEY = 'focuson.session.token';

async function hrmsCall(action, payload = {}) {
  const reqId = crypto.randomUUID();
  const token = sessionStorage.getItem(TOKEN_KEY) || '';
  const body = {
    action,
    token: token || null,
    payload: { ...payload, __client: { userAgent: navigator.userAgent.slice(0, 512) } },
    reqId
  };

  const started = performance.now();
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'follow',
    referrerPolicy: 'no-referrer'
  });
  const text = await response.text();
  const ms = Math.round(performance.now() - started);

  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    // A non-JSON reply is almost always a Google sign-in redirect or a deployment
    // that is not "Anyone" — the app would report this as SERVER/invalidJsonResponse.
    console.error(action + ' returned non-JSON (' + response.status + '):', text.slice(0, 400));
    return { status: response.status, ms, raw: text };
  }

  console.table([{
    action,
    http: response.status,
    ms,
    ok: envelope.ok,
    reqIdMatches: envelope.reqId === reqId,
    code: envelope.error ? envelope.error.code : '—',
    message: envelope.error ? envelope.error.message : 'ok',
    hasToken: Boolean(token)
  }]);
  if (!envelope.ok) console.warn(action + ' failed:', envelope.error);
  return envelope;
}
window.hrmsCall = hrmsCall;
```

Then:

```js
await hrmsCall('public.config');           // no session needed
await hrmsCall('auth.session');            // needs a signed-in session
await hrmsCall('dashboard.get');           // the call the dashboard makes first
await hrmsCall('leave.myLeave', { year: 2026 });
```

Also worth checking before you dig deeper:

```js
sessionStorage.getItem('focuson.session.token');   // empty ⇒ every call fails AUTH_REQUIRED
```

---

## C. Where the two sides usually disagree

| Symptom | Cause | Check |
| --- | --- | --- |
| `ok: false`, `code: SERVER`, "invalidJsonResponse" | `/exec` returns an HTML sign-in or error page | `curl -s -X POST -H 'Content-Type: text/plain' -d '{"action":"public.config","reqId":"debug-12345678"}' "$EXEC_URL" \| head -c 300` |
| `reqIdMatches: false` | response came from a different deployment or a cached script | redeploy a **new version** and update `assets/js/config.js` |
| `AUTH_REQUIRED` on every call | no token in `sessionStorage`, or the session was revoked | `sessionStorage.getItem('focuson.session.token')` |
| `FORBIDDEN` with a clear message | the permission, scope or feature switch denied it | Apps Script **Executions** log shows the same message plus the request ID |
| `NOT_FOUND` | action not in `backend/Actions.gs` | `node tools/ui-check.js` lists any unregistered action the UI calls |

Delete the `debugger;` lines and `debugRoundTrip()` when you are done — `node tools/smoke-test.js`, `node tools/ui-check.js` and `node tools/contract-check.js` must stay green.
