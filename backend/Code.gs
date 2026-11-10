/** JSON Web App entry point and declarative action authorization registry. */

function doGet() {
  return jsonResponse({ ok: true, data: { status: 'ok' }, reqId: null });
}

function doPost(event) {
  var reqId = null;
  try {
    if (!event || !event.postData || typeof event.postData.contents !== 'string' || !event.postData.contents) {
      Utils.fail('VALIDATION', 'A JSON request body is required.');
    }
    if (event.postData.contents.length > 262144) Utils.fail('VALIDATION', 'The request body is too large.');
    var body;
    try { body = JSON.parse(event.postData.contents); } catch (error) { Utils.fail('VALIDATION', 'The request body is not valid JSON.'); }
    Utils.assertObject(body, 'request');
    reqId = body.reqId ? String(body.reqId).slice(0, 128) : Utilities.getUuid();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(reqId)) Utils.fail('VALIDATION', 'reqId has an invalid format.');
    var action = Utils.requireString(body, 'action', { max: 160, pattern: /^[a-z][a-z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/ });
    var payload = body.payload === undefined ? {} : body.payload;
    Utils.assertObject(payload, 'payload');
    var context = makeRequestContext(payload, reqId);
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

function makeRequestContext(payload, reqId) {
  var client = payload.__client && typeof payload.__client === 'object' ? payload.__client : {};
  var userAgent = typeof client.userAgent === 'string' ? client.userAgent.slice(0, 512) : '';
  var hasPepper = Boolean(PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER'));
  return {
    reqId: reqId,
    deviceHash: userAgent && hasPepper ? Utils.hashDevice(userAgent) : '',
    deviceSupplied: Boolean(userAgent)
  };
}

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
    },
    'dashboard.get': {
      write: false, permission: null, fields: [], featureKey: null,
      handler: function (payload, authentication) { return dashboardData(authentication); }
    },
    'profile.get': {
      write: false, permission: 'employee.view', fields: [], featureKey: null, entity: 'Employees',
      resolveTarget: function (payload, authentication) {
        var requestedId = payload.employeeId ? Utils.normalizeEmployeeId(payload.employeeId) : authentication.actor.employeeId;
        var employees = Database.getAllCached('Employees');
        for (var i = 0; i < employees.length; i++) {
          if (String(employees[i].employee_id || employees[i].id) === requestedId) return employees[i];
        }
        Utils.fail('NOT_FOUND', 'Employee record not found.');
      },
      handler: function (payload, authentication, context, target) { return profileData(target); }
    }
  };
}

function dispatchAction(action, token, payload, context) {
  var definitions = actionRegistry();
  var definition = definitions[action];
  if (!definition) Utils.fail('NOT_FOUND', 'The requested API action does not exist.');

  var authentication = null;
  var target = null;
  if (!definition.isPublic) {
    authentication = Auth.authenticate(token, context);
    if (authentication.actor.mustChangePassword && !definition.allowPasswordChange) {
      Utils.fail('FORBIDDEN', 'A password change is required before using this action.');
    }
    if (definition.resolveTarget) target = definition.resolveTarget(payload, authentication);
    if (definition.permission) {
      Permissions.check(authentication.actor, definition.permission, target, {
        entity: definition.entity,
        fields: definition.fields,
        write: definition.write,
        featureKey: definition.featureKey,
        makerChecker: Boolean(definition.makerChecker),
        condition: definition.condition ? definition.condition(payload, target) : {},
        context: context
      });
    } else if (definition.featureKey && !Permissions.isFeatureEnabled(definition.featureKey)) {
      Utils.fail('FORBIDDEN', 'This feature is disabled.');
    }
  }
  return definition.handler(payload, authentication, context, target);
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
    background: { type: 'gradient', preset: 'astra', overlayOpacity: 0, blur: 0 }
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

function dashboardData(authentication) {
  var employee = authentication.employee;
  return {
    user: {
      employeeId: authentication.actor.employeeId,
      displayName: employee.display_name || authentication.actor.employeeId,
      department: employee.department || '',
      designation: employee.designation || '',
      branch: employee.branch || ''
    },
    security: {
      passwordChangedAt: Utils.toIso(authentication.user.password_changed_at),
      permissionCount: authentication.effective.permissions.length
    },
    session: {
      absoluteExpiresAt: Utils.toIso(authentication.sessionRecord.expires_at),
      lastSeenAt: Utils.toIso(authentication.sessionRecord.last_seen_at)
    }
  };
}

function profileData(employee) {
  return {
    profile: {
      employeeId: String(employee.employee_id || employee.id),
      displayName: employee.display_name || '',
      workEmail: employee.work_email || '',
      mobile: employee.mobile || '',
      department: employee.department || '',
      designation: employee.designation || '',
      branch: employee.branch || '',
      reportingManagerId: employee.reporting_manager_id || '',
      workLocationType: employee.work_location_type || '',
      joiningDate: employee.joining_date || ''
    }
  };
}
