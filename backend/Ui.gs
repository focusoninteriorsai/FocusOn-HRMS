/**
 * Google-only UI host.
 *
 * The same HTML application that runs on static hosting is served from Apps
 * Script through HtmlService. `frontend/Index.html` is generated from the
 * repository by tools/build-apps-script-ui.js (inline bundle, baked i18n, inline
 * manifest), so this file only assembles the page and exposes `api()`.
 *
 * Transport: the browser calls google.script.run.api(requestJson); this endpoint
 * feeds the request through the exact same doPost() used by the JSON Web App, so
 * authentication, permissions, maker-checker and audit behaviour are identical
 * whether the UI is served by Apps Script or by GitHub Pages.
 */

/** HtmlService entry point: renders the application shell. */
function doGet(event) {
  var parameters = (event && event.parameter) || {};
  // JSON health check, kept for monitoring and for the web-app deployment.
  if (parameters.health) {
    return jsonResponse({ ok: true, data: { status: 'ok', schema: HRMS_SCHEMA_VERSION }, reqId: null });
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('FOCUSON HRMS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * google.script.run endpoint used by the bundled UI.
 *
 * Returns the JSON envelope as a string, exactly like the Web App does, so the
 * client parses one format in both transports. Failures are returned, not
 * thrown, except for a malformed request, which is also returned as an envelope.
 *
 * @param {string} requestJson JSON: {action, token, payload, reqId}
 * @return {string} JSON: {ok, data|error, reqId}
 */
function api(requestJson) {
  try {
    if (typeof requestJson !== 'string' || !requestJson) {
      return JSON.stringify({ ok: false, error: { code: 'VALIDATION', message: 'A JSON request body is required.' }, reqId: null });
    }
    var response = doPost({ postData: { contents: requestJson } });
    return String(response && response.text !== undefined ? response.text : '');
  } catch (error) {
    console.error('FOCUSON UI request failure: ' + (error && error.stack ? error.stack : error));
    return JSON.stringify({
      ok: false,
      error: { code: 'SERVER', message: 'The request could not be completed. Contact the administrator.' },
      reqId: null
    });
  }
}

/** Lets the generated shell include other Apps Script HTML partials if needed. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
