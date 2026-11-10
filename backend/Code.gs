/** JSON Web App entry point, rate limiting and declarative authorization dispatch. */

function doPost(event) {
  var reqId = null;
  try {
    if (!event || !event.postData || typeof event.postData.contents !== 'string' || !event.postData.contents) {
      Utils.fail('VALIDATION', 'A JSON request body is required.');
    }
    if (event.postData.contents.length > 524288) Utils.fail('VALIDATION', 'The request body is too large. Split large files.');
    var body;
    try { body = JSON.parse(event.postData.contents); } catch (error) { Utils.fail('VALIDATION', 'The request body is not valid JSON.'); }
    Utils.assertObject(body, 'request');
    reqId = body.reqId ? String(body.reqId).slice(0, 128) : Utilities.getUuid();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(reqId)) Utils.fail('VALIDATION', 'reqId has an invalid format.');
    var action = Utils.requireString(body, 'action', { max: 160, pattern: /^[a-z][a-z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/ });
    var payload = body.payload === undefined ? {} : body.payload;
    Utils.assertObject(payload, 'payload');
    var context = makeRequestContext(payload, reqId, action);
    delete payload.__client;
    var data = dispatchAction(action, body.token, payload, context);
    return jsonResponse(Utils.okResponse(data, reqId));
  } catch (error) {
    var exposed = error && error.expose === true;
    if (!exposed) console.error('FOCUSON request failure [' + (reqId || 'none') + ']: ' + (error && error.stack ? error.stack : error));
    return jsonResponse(Utils.errorResponse(
      exposed ? error.code : 'SERVER',
      exposed ? error.message : 'The request could not be completed. Contact the administrator with the request ID.',
      reqId,
      exposed ? error.details : undefined
    ));
  }
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function makeRequestContext(payload, reqId, action) {
  var client = payload.__client && typeof payload.__client === 'object' ? payload.__client : {};
  var userAgent = typeof client.userAgent === 'string' ? client.userAgent.slice(0, 512) : '';
  var hasPepper = Boolean(PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER'));
  return {
    reqId: reqId,
    action: action || '',
    deviceHash: userAgent && hasPepper ? Utils.hashDevice(userAgent) : '',
    deviceSupplied: Boolean(userAgent)
  };
}

/** Legacy registry entries kept for backwards compatibility with Phase 1 clients. */
function actionRegistry() {
  return {
    'public.config': {
      isPublic: true, write: false, permission: null, fields: [], featureKey: null,
      handler: function () { return publicConfig(); }
    },
    'auth.login': {
      isPublic: true, write: true, permission: null, fields: [], featureKey: null,
      handler: function (payload, authentication, context) { return Auth.login(payload, context); }
    },
    'auth.session': {
      write: false, permission: null, fields: [], featureKey: null, allowPasswordChange: true,
      handler: function (payload, authentication) { return Auth.sessionResponse(authentication); }
    },
    'auth.changePassword': {
      write: true, permission: null, fields: [], featureKey: null, allowPasswordChange: true,
      handler: function (payload, authentication, context) { return Auth.changePassword(authentication, payload, context); }
    },
    'auth.logout': {
      write: true, permission: null, fields: [], featureKey: null, allowPasswordChange: true,
      handler: function (payload, authentication, context) { return Auth.logout(authentication, context); }
    },
    'auth.logoutAll': {
      write: true, permission: null, fields: [], featureKey: null, allowPasswordChange: true,
      handler: function (payload, authentication, context) { return Auth.logoutAll(authentication, context); }
    },
    'auth.updatePreferences': {
      write: true, permission: null, fields: [], featureKey: null, allowPasswordChange: true,
      handler: function (payload, authentication, context) { return Auth.updatePreferences(authentication, payload, context); }
    }
  };
}

function registryEntry(action) {
  var legacy = actionRegistry();
  if (legacy[action]) return legacy[action];
  if (typeof Actions === 'undefined') return null;
  var entry = Actions.registry[action];
  if (!entry) return null;
  var definition = {
    write: Boolean(entry.write),
    permission: entry.permission || null,
    fields: entry.fields || [],
    featureKey: entry.featureKey || null,
    entity: entry.entity || '',
    makerChecker: Boolean(entry.makerChecker),
    collection: Boolean(entry.collection),
    superAdminOnly: Boolean(entry.superAdminOnly),
    handler: entry.handler
  };
  return definition;
}

function dispatchAction(action, token, payload, context) {
  var definition = registryEntry(action);
  if (!definition) Utils.fail('NOT_FOUND', 'The requested API action does not exist.');

  var authentication = null;
  if (!definition.isPublic) {
    authentication = Auth.authenticate(token, context);
    enforceRequestThrottle(authentication.actor.employeeId, action);
    if (authentication.actor.mustChangePassword && !definition.allowPasswordChange) {
      Utils.fail('FORBIDDEN', 'A password change is required before using this action.');
    }
    if (Settings.bool('MAINTENANCE_MODE', false) && !authentication.actor.isSuperAdmin) {
      Utils.fail('LOCKED', 'The system is in maintenance mode. Try again later.', { retryAfterSeconds: 300 });
    }
    if (definition.superAdminOnly && !authentication.actor.isSuperAdmin) {
      Utils.fail('FORBIDDEN', 'Only a Super Admin can perform this action.');
    }
    if (definition.permission) {
      Permissions.check(authentication.actor, definition.permission, null, {
        collection: definition.collection,
        entity: definition.entity,
        fields: definition.fields,
        write: definition.write,
        featureKey: definition.featureKey,
        makerChecker: definition.makerChecker,
        context: context
      });
    } else if (definition.featureKey && !Permissions.isFeatureEnabled(definition.featureKey, authentication.actor)) {
      Utils.fail('FORBIDDEN', 'This feature is disabled by the administrator.');
    }
    return definition.handler(payload, authentication, context);
  }
  return definition.handler(payload, authentication, context);
}

/** Per-user request ceiling protects the shared Apps Script quota. */
function enforceRequestThrottle(employeeId, action) {
  var limit = Settings.number('API_REQUESTS_PER_MINUTE', 180);
  var cache = CacheService.getScriptCache();
  var minute = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmm');
  var key = 'REQ_V1_' + Utils.sha256(employeeId) + '_' + minute;
  var current = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(current), 120);
  if (current > limit) {
    Utils.fail('RATE_LIMITED', 'Too many requests. Please slow down.', { retryAfterSeconds: 30 });
  }
  if (current === 1) {
    // First request in the minute: opportunistically prune stale API_Requests rows.
    try { pruneApiRequests(); } catch (error) { /* housekeeping is best effort */ }
  }
}

function pruneApiRequests() {
  var cutoff = Utils.addSeconds(new Date(), -3600);
  Database.updateMany('API_Requests', function (row) {
    return String(row.status).toUpperCase() === 'ACTIVE' && Utils.toIso(row.created_at) < cutoff;
  }, { status: 'DELETED' }, 'SYSTEM');
}

function publicConfig() {
  var config = {
    companyName: 'FOCUSON HRMS',
    tagline: '',
    logoUrl: '',
    loginNotice: '',
    featureHighlights: [],
    defaultLanguage: 'en',
    defaultTheme: 'light',
    themeTokens: {
      primaryColor: '#3157d5', accentColor: '#08756f', cornerRadius: 18,
      cardStyle: 'soft', density: 'comfortable', font: 'system'
    },
    background: { type: 'gradient', preset: 'astra', overlayOpacity: 0, blur: 0 },
    maintenanceMode: false,
    version: HRMS_SCHEMA_VERSION
  };
  if (!PropertiesService.getScriptProperties().getProperty('HRMS_CORE_DB_ID')) return config;
  var settings = Database.getSettingsMap();
  function text(key, maximum) {
    return settings[key] ? Utils.cleanString(settings[key]).slice(0, maximum) : '';
  }
  config.companyName = text('COMPANY_NAME', 120) || config.companyName;
  config.tagline = text('COMPANY_TAGLINE', 240);
  config.logoUrl = text('COMPANY_LOGO_URL', 2048);
  config.loginNotice = text('LOGIN_NOTICE', 1000);
  config.defaultLanguage = ['en', 'hi'].indexOf(settings.DEFAULT_LANGUAGE) >= 0 ? settings.DEFAULT_LANGUAGE : 'en';
  config.defaultTheme = ['light', 'dark'].indexOf(settings.DEFAULT_THEME) >= 0 ? settings.DEFAULT_THEME : 'light';
  config.maintenanceMode = String(settings.MAINTENANCE_MODE || '').toUpperCase() === 'TRUE';

  var highlights = Utils.safeParseJson(settings.PUBLIC_FEATURE_HIGHLIGHTS, []);
  if (Array.isArray(highlights)) {
    config.featureHighlights = highlights.slice(0, 4).filter(function (item) { return typeof item === 'string'; }).map(function (item) {
      return Utils.cleanString(item).slice(0, 160);
    }).filter(Boolean);
  }
  if (/^#[0-9a-fA-F]{6}$/.test(settings.BRAND_PRIMARY_COLOR || '')) config.themeTokens.primaryColor = settings.BRAND_PRIMARY_COLOR;
  if (/^#[0-9a-fA-F]{6}$/.test(settings.BRAND_ACCENT_COLOR || '')) config.themeTokens.accentColor = settings.BRAND_ACCENT_COLOR;
  var radius = Utils.asNumber(settings.BRAND_CORNER_RADIUS, 18);
  config.themeTokens.cornerRadius = Math.min(24, Math.max(8, radius));
  if (['flat', 'soft', 'glass'].indexOf(settings.BRAND_CARD_STYLE) >= 0) config.themeTokens.cardStyle = settings.BRAND_CARD_STYLE;
  if (['comfortable', 'compact'].indexOf(settings.BRAND_DENSITY) >= 0) config.themeTokens.density = settings.BRAND_DENSITY;
  if (['system', 'humanist', 'readable'].indexOf(settings.BRAND_FONT) >= 0) config.themeTokens.font = settings.BRAND_FONT;
  if (['solid', 'gradient', 'animated'].indexOf(settings.LOGIN_BACKGROUND_TYPE) >= 0) config.background.type = settings.LOGIN_BACKGROUND_TYPE;
  if (['astra', 'dawn', 'mono'].indexOf(settings.LOGIN_BACKGROUND_PRESET) >= 0) config.background.preset = settings.LOGIN_BACKGROUND_PRESET;
  config.background.overlayOpacity = Math.min(0.9, Math.max(0, Utils.asNumber(settings.LOGIN_BACKGROUND_OVERLAY_OPACITY, 0)));
  config.background.blur = Math.min(20, Math.max(0, Utils.asNumber(settings.LOGIN_BACKGROUND_BLUR, 0)));
  return config;
}

/** Kept for external triggers and manual menu use. */
function onOpen() {
  try {
    var menu = SpreadsheetApp.getUi().createMenu('FOCUSON HRMS');
    menu.addItem('Run setup / migration', 'setupSystem');
    menu.addItem('Run daily maintenance', 'runDailyFoundationMaintenance');
    menu.addToUi();
  } catch (error) {
    // Container-bound menus are unavailable in a standalone Web App project.
  }
}
