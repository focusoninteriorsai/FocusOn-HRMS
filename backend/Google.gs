/**
 * Google Workspace integrations.
 *
 * Everything here is optional and switchable, uses only Google services inside
 * the same deployment account (no third-party provider, no paid service), and
 * every outbound call is wrapped so a failure can never block a business action:
 *
 *   Gmail      transactional mail to employees (approval requests, payslips,
 *              document issue, password reset notice, daily digest)
 *   Calendar   leave and holiday events on a shared HRMS calendar
 *   Chat       webhook messages to a team space (approvals, payroll, alerts)
 *   Contacts   employee work contact card (People API via advanced service)
 *   Tasks      personal to-dos for approvers
 *   Docs       Google Docs rendering for issued letters, exportable as PDF
 *
 * Delivery is best-effort by contract: every function returns a result object and
 * records failures in the audit trail instead of throwing.
 */
var Google = (function () {
  var BATCH_LIMIT = 60;

  /* --------------------------------------------------------------- settings */
  function enabled(key, fallback) {
    try {
      return Settings.bool(key, fallback === undefined ? false : fallback);
    } catch (error) {
      return Boolean(fallback);
    }
  }

  function companyName() {
    try {
      return Settings.text('COMPANY_NAME', 'FOCUSON HRMS');
    } catch (error) {
      return 'FOCUSON HRMS';
    }
  }

  function fromName() {
    try {
      return Settings.text('MAIL_FROM_NAME', companyName());
    } catch (error) {
      return companyName();
    }
  }

  function replyTo() {
    try {
      return Settings.text('COMPANY_HR_EMAIL', Session.getEffectiveUser().getEmail() || '');
    } catch (error) {
      return '';
    }
  }

  /** Wraps a delivery attempt: never throws, always reports. */
  function attempt(channel, reference, action) {
    try {
      var result = action();
      record(channel, reference, 'SUCCESS', '');
      return { ok: true, channel: channel, result: result || null };
    } catch (error) {
      var message = error && error.message ? error.message : String(error);
      record(channel, reference, 'FAILED', message);
      return { ok: false, channel: channel, error: message };
    }
  }

  function record(channel, reference, outcome, message) {
    try {
      Audit.logEvent('GOOGLE_' + channel, 'SYSTEM', 'Integrations', String(reference || '').slice(0, 120), outcome,
        { channel: channel, message: String(message || '').slice(0, 400) }, {});
    } catch (error) {
      // Logging must never fail a delivery.
    }
  }

  /* ------------------------------------------------------------------- mail */
  function mailEnabled() {
    return enabled('MAIL_NOTIFICATIONS_ENABLED', false);
  }

  /** Sends one plain-text mail. Returns {ok, messageId|error}. */
  function sendMail(to, subject, body, options) {
    options = options || {};
    if (!mailEnabled() && !options.force) return { ok: false, channel: 'MAIL', skipped: true };
    var recipient = String(to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) return { ok: false, channel: 'MAIL', skipped: true };
    return attempt('MAIL', recipient, function () {
      var message = {
        to: recipient,
        subject: (options.prefix || '') + String(subject || '').slice(0, 240),
        body: String(body || ''),
        name: fromName()
      };
      var reply = replyTo();
      if (reply) message.replyTo = reply;
      if (options.cc) message.cc = String(options.cc).slice(0, 500);
      if (options.htmlBody) {
        message.htmlBody = String(options.htmlBody);
        message.body = String(body || '');
      }
      if (options.attachments && options.attachments.length) message.attachments = options.attachments;
      var sent = MailApp.sendEmail(message);
      return sent && sent.getMessageId ? sent.getMessageId() : 'sent';
    });
  }

  /** True when the account may send mail at all (quota-independent check). */
  function mailQuota() {
    try {
      return { remaining: MailApp.getRemainingDailyQuota() };
    } catch (error) {
      return { remaining: 0, error: error && error.message };
    }
  }

  /* ------------------------------------------------------------- directory */
  function employeeEmail(employeeId) {
    try {
      var employee = Repo.employee(employeeId) || {};
      var email = String(employee.work_email || employee.personal_email || '').trim();
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
    } catch (error) {
      return '';
    }
  }

  /** Emails a list of employees, de-duplicated, respecting the daily quota. */
  function mailEmployees(employeeIds, subject, body) {
    if (!mailEnabled()) return { ok: false, skipped: true, sent: 0 };
    var sent = 0;
    var failed = 0;
    var quota = mailQuota().remaining;
    Utils.csvUnique(employeeIds || []).slice(0, BATCH_LIMIT).forEach(function (employeeId) {
      if (sent >= quota) return;
      var to = employeeEmail(employeeId);
      if (!to) return;
      var result = sendMail(to, subject, body);
      if (result.ok) sent += 1;
      else failed += 1;
    });
    return { ok: true, sent: sent, failed: failed };
  }

  /** Replaces {{tokens}} in a stored template with values from a map. */
  function renderTokens(text, values) {
    return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
    });
  }

  function appLink(path) {
    try {
      var url = ScriptApp.getService().getUrl();
      if (!url) return '';
      return url + (String(path || '').indexOf('#') === 0 ? '' : '#') + String(path || '');
    } catch (error) {
      return '';
    }
  }

  /* --------------------------------------------------------------- calendar */
  function calendarId() {
    try {
      return Settings.text('CALENDAR_ID', 'primary');
    } catch (error) {
      return 'primary';
    }
  }

  function calendarEnabled() {
    return enabled('CALENDAR_SYNC_ENABLED', false);
  }

  function calendar() {
    return CalendarApp.getCalendarById(calendarId()) || CalendarApp.getDefaultCalendar();
  }

  /** Parses an ISO date (YYYY-MM-DD or full ISO) into a midnight Date. */
  function allDay(value) {
    var text = String(value || '').slice(0, 10);
    var parts = text.split('-');
    if (parts.length === 3) {
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
    }
    return new Date();
  }

  /** Creates an all-day event. Returns the event id. */
  function createAllDayEvent(title, startDate, endDate, description, guestEmails) {
    if (!calendarEnabled()) return { ok: false, skipped: true };
    return attempt('CALENDAR', title, function () {
      var start = allDay(startDate);
      var options = { description: String(description || '').slice(0, 1000) };
      var guests = (guestEmails || []).filter(Boolean);
      if (guests.length) options.guests = guests.join(',');
      var event = calendar().createAllDayEvent(String(title).slice(0, 200), start, options);
      // Multi-day leave: extend the event so the calendar block spans every day.
      var end = endDate ? allDay(endDate) : null;
      if (end && event && event.setAllDayDates && end.getTime() > start.getTime()) {
        event.setAllDayDates(start, end);
      }
      return event && event.getId ? event.getId() : 'created';
    });
  }

  function deleteEvent(eventId) {
    if (!calendarEnabled() || !eventId) return { ok: false, skipped: true };
    return attempt('CALENDAR', eventId, function () {
      var event = calendar().getEventById(eventId);
      if (event) event.deleteEvent();
      return 'deleted';
    });
  }

  /* ------------------------------------------------------------------- chat */
  function chatWebhook() {
    try {
      return Settings.text('GOOGLE_CHAT_WEBHOOK_URL', '');
    } catch (error) {
      return '';
    }
  }

  function chatEnabled() {
    return enabled('GOOGLE_CHAT_ENABLED', false) && Boolean(chatWebhook());
  }

  /** Posts a plain-text or card message to the configured Google Chat space. */
  function chatSend(text, options) {
    options = options || {};
    if (!chatEnabled() && !options.force) return { ok: false, channel: 'CHAT', skipped: true };
    var url = options.webhook || chatWebhook();
    if (!url) return { ok: false, channel: 'CHAT', skipped: true };
    return attempt('CHAT', options.threadKey || 'message', function () {
      var payload = { text: String(text || '').slice(0, 4000) };
      if (options.cards) payload.cards = options.cards;
      var response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json; charset=UTF-8',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      var code = response.getResponseCode();
      if (code < 200 || code >= 300) throw new Error('Chat returned HTTP ' + code);
      return code;
    });
  }

  /** Rich approval card: title, facts, and a link back to the approval inbox. */
  function chatApprovalCard(title, facts, path) {
    var widgets = [{ textParagraph: { text: String(title || '').slice(0, 500) } }];
    if (facts && facts.length) {
      widgets.push({
        keyValue: {
          topLabel: String(facts[0].label || '').slice(0, 60),
          content: String(facts[0].value || '').slice(0, 200)
        }
      });
    }
    var link = appLink(path || '/workflow');
    if (link) widgets.push({ buttonList: { buttons: [{ text: 'Open in HRMS', onClick: { openLink: { url: link } } }] } });
    return [{ sections: [{ widgets: widgets }] }];
  }

  /* --------------------------------------------------------------- contacts */
  function contactsEnabled() {
    return enabled('CONTACTS_SYNC_ENABLED', false);
  }

  /** Creates or updates the employee's Google Contact card (People API). */
  function syncContact(employeeId) {
    if (!contactsEnabled()) return { ok: false, skipped: true };
    return attempt('CONTACTS', employeeId, function () {
      if (typeof People === 'undefined') throw new Error('The People advanced service is not enabled in appsscript.json.');
      var employee = Repo.requireRecord('Employees', employeeId, 'Employee');
      var email = String(employee.work_email || '').trim();
      if (!email) throw new Error('The employee has no work email.');
      var body = {
        names: [{ givenName: String(employee.display_name || employee.employee_id).slice(0, 120) }],
        emailAddresses: [{ value: email, type: 'work' }],
        organizations: [{ name: companyName(), title: String(employee.designation || ''), department: String(employee.department || '') }],
        phoneNumbers: employee.mobile ? [{ value: String(employee.mobile), type: 'work' }] : []
      };
      var existing = employee.google_contact_id;
      if (existing) {
        People.People.updateContact({ personFields: 'names,emailAddresses,organizations,phoneNumbers', updatePersonFields: 'names,emailAddresses,organizations,phoneNumbers' },
          'people/' + existing, body);
        return existing;
      }
      var created = People.People.createContact(body);
      var id = String(created.resourceName || '').split('/').pop();
      if (id) Database.update('Employees', employee.id, { google_contact_id: id }, 'SYSTEM');
      return id;
    });
  }

  /* ------------------------------------------------------------------ tasks */
  function tasksEnabled() {
    return enabled('TASKS_SYNC_ENABLED', false);
  }

  /** Adds a task to the deployment account's default task list. */
  function addTask(title, notes, dueDate) {
    if (!tasksEnabled()) return { ok: false, skipped: true };
    return attempt('TASKS', title, function () {
      var list = Tasks.Tasklists.list({ maxResults: 1 }).items;
      var listId = list && list.length ? list[0].id : '@default';
      var task = { title: String(title || '').slice(0, 200), notes: String(notes || '').slice(0, 2000) };
      if (dueDate) task.due = Utils.toIso(dueDate).slice(0, 10) + 'T00:00:00.000Z';
      var created = Tasks.Tasks.insert(task, listId);
      return created && created.id ? created.id : 'created';
    });
  }

  /* ------------------------------------------------------------------- docs */
  /** Renders a letter into a Google Doc and returns {docId, url, pdf}. */
  function renderDocument(title, bodyText, employeeName) {
    return attempt('DOCS', title, function () {
      var doc = DocumentApp.create(String(title || 'Document').slice(0, 200));
      var body = doc.getBody();
      var header = body.appendParagraph(companyName());
      header.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      if (employeeName) body.appendParagraph(String(employeeName)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      String(bodyText || '').split('\n').forEach(function (line) {
        body.appendParagraph(line);
      });
      body.appendParagraph('').appendHorizontalRule();
      body.appendParagraph('Generated on ' + Utils.toIso(new Date()).slice(0, 19).replace('T', ' ') + ' by ' + fromName());
      doc.saveAndClose();
      var name = String(title || 'Document');
      try {
        name = DriveApp.getFileById(doc.getId()).getName() || name;
      } catch (ignored) {
        // The Drive file can lag behind the document; the doc itself is the record.
      }
      return { docId: doc.getId(), url: doc.getUrl(), name: name };
    });
  }

  /** Converts a Google Doc to PDF bytes, ready for a Drive attachment. */
  function documentPdf(docId) {
    return attempt('DOCS_PDF', docId, function () {
      var blob = DriveApp.getFileById(docId).getAs('application/pdf');
      return { blob: blob };
    });
  }

  /* --------------------------------------------------------------- identity */
  /** Features this deployment can actually use, for the Settings screen. */
  function status() {
    var output = {
      mail: { enabled: mailEnabled(), configured: Boolean(Session.getEffectiveUser && Session.getEffectiveUser().getEmail()), quota: mailQuota().remaining },
      calendar: { enabled: calendarEnabled(), calendarId: calendarId() },
      chat: { enabled: chatEnabled(), configured: Boolean(chatWebhook()) },
      contacts: { enabled: contactsEnabled(), available: typeof People !== 'undefined' },
      tasks: { enabled: tasksEnabled(), available: typeof Tasks !== 'undefined' },
      docs: { available: typeof DocumentApp !== 'undefined' },
      account: ''
    };
    try {
      output.account = Session.getEffectiveUser().getEmail() || '';
    } catch (error) {
      output.account = '';
    }
    return output;
  }

  return {
    status: status,
    sendMail: sendMail,
    mailEmployees: mailEmployees,
    mailQuota: mailQuota,
    mailEnabled: mailEnabled,
    renderTokens: renderTokens,
    appLink: appLink,
    calendarEnabled: calendarEnabled,
    createAllDayEvent: createAllDayEvent,
    deleteEvent: deleteEvent,
    chatEnabled: chatEnabled,
    chatSend: chatSend,
    chatApprovalCard: chatApprovalCard,
    contactsEnabled: contactsEnabled,
    syncContact: syncContact,
    tasksEnabled: tasksEnabled,
    addTask: addTask,
    renderDocument: renderDocument,
    documentPdf: documentPdf,
    employeeEmail: employeeEmail
  };
})();
