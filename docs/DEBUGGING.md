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

The hosted app talks to the server through `google.script.run`, so there is no URL, no CORS and no fetch to reproduce. This snippet replays the exact envelope the app sends and prints one table row per call plus the full error object:

```js
/* TEMPORARY DEBUG — paste in DevTools console on the /exec page. */
const TOKEN_KEY = 'focuson.session.token';

async function hrmsCall(action, payload = {}) {
  const reqId = crypto.randomUUID();
  const token = sessionStorage.getItem(TOKEN_KEY) || '';
  const body = JSON.stringify({
    action,
    token: token || null,
    payload: { ...payload, __client: { userAgent: navigator.userAgent.slice(0, 512) } },
    reqId
  });

  const started = performance.now();
  let raw;
  try {
    raw = await new Promise((resolve, reject) => {
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).api(body);
    });
  } catch (error) {
    // A thrown failure is the server function itself failing (syntax error,
    // authorisation problem, quota) — not an application error envelope.
    console.error(action + ' threw:', error && (error.message || error));
    return { threw: true, error };
  }
  const ms = Math.round(performance.now() - started);

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    // Empty or non-JSON means doPost returned nothing; api() reports VALIDATION.
    console.error(action + ' returned non-JSON:', String(raw).slice(0, 400));
    return { ms, raw };
  }

  console.table([{
    action, reqId, ok: envelope.ok, ms,
    code: envelope.error ? envelope.error.code : '',
    message: envelope.error ? envelope.error.message : '',
    reqIdMatches: envelope.reqId === reqId
  }]);
  return envelope;
}

hrmsCall('public.config');
```

To debug the *real* page rather than a replay, keep the Network panel open (Apps Script posts to `script.google.com`), or read the matching row in **Apps Script → Executions**, which is keyed by the same `reqId`.

## C. Where the two sides usually disagree

| Symptom | Cause | Check |
| --- | --- | --- |
| Page loads but every call fails | the `Index` HTML file name does not match `createTemplateFromFile('Index')`, or the deployment was not republished | open `/exec?health=1`; if that answers JSON, the backend is fine and the shell is stale |
| `reqIdMatches: false` | the page is old, or the reply came from a different deployment | redeploy a **new version**, then hard-reload `/exec` |
| `AUTH_REQUIRED` on every call | no token in `sessionStorage`, or the session was revoked | `sessionStorage.getItem('focuson.session.token')` |
| `FORBIDDEN` with a clear message | the permission, scope or feature switch denied it | Apps Script **Executions** log shows the same message plus the request ID |
| `NOT_FOUND` | action not in `backend/Actions.gs` | `node tools/ui-check.js` lists any unregistered action the UI calls |

Delete the `debugger;` lines and `debugRoundTrip()` when you are done — `node tools/smoke-test.js`, `node tools/ui-check.js` and `node tools/contract-check.js` must stay green.
