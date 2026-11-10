import { apiRequest } from '../api.js';
import { t, translateError } from '../i18n.js';
import {
  button, can, dataTable, dateCell, detailDialog, downloadText, element, emptyState, formDialog, humanize,
  icon, load, money, pageHeader, setVar, showToast, stateBadge, statRow, tabs
} from './_kit.js';

/* ========================================================================= Reports */
const REPORTS = [
  { id: 'headcount', labelKey: 'reports.headcount' },
  { id: 'attendance', labelKey: 'reports.attendance' },
  { id: 'leave', labelKey: 'reports.leave' },
  { id: 'payroll', labelKey: 'reports.payroll' },
  { id: 'expiry', labelKey: 'reports.expiry' }
];

export async function renderReports(container) {
  const state = { type: 'headcount', month: new Date().toISOString().slice(0, 7), year: String(new Date().getFullYear()) };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('reports.title', 'reports.subtitle', [], 'chart'), tabHost, body);
  tabHost.append(tabs(REPORTS, async (id) => { state.type = id; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      const payload = state.type === 'leave'
        ? { type: state.type, year: state.year }
        : state.type === 'expiry' ? { type: state.type } : { type: state.type, month: state.month };
      const data = await load('reports.generate', payload);
      body.replaceChildren(
        element('div', { className: 'toolbar' }, [
          state.type === 'leave'
            ? element('div', { className: 'form-field narrow' }, [element('label', { text: t('reports.year') }), monthInput('number', state.year, (value) => { state.year = value; draw(); }, 2000, 2100, 1)])
            : state.type === 'expiry' ? null
              : element('div', { className: 'form-field narrow' }, [element('label', { text: t('attendance.month') }), monthInput('month', state.month, (value) => { state.month = value; draw(); })]),
          can(`report.${state.type}.export`) || can('settings.view') ? button('reports.exportCsv', {
            iconName: 'download',
            onClick: async () => {
              try {
                const file = await apiRequest('reports.export', payload, { isRead: true });
                downloadText(file.fileName, file.csv);
              } catch (error) { showToast(translateError(error), 'error'); }
            }
          }) : null
        ].filter(Boolean)),
        renderReport(data)
      );
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  function renderReport(data) {
    if (state.type === 'headcount') {
      return element('div', {}, [
        statRow([
          { labelKey: 'reports.totalHeadcount', value: String(data.total) },
          { labelKey: 'reports.active', value: String(data.active) },
          { labelKey: 'reports.joiners', value: String(data.joiners) },
          { labelKey: 'reports.exits', value: String(data.exits) },
          { labelKey: 'reports.attrition', value: `${data.attritionPercent}%`, tone: data.attritionPercent > 10 ? 'warning' : '' },
          { labelKey: 'reports.avgTenure', value: `${data.averageTenureYears} y` }
        ]),
        element('div', { className: 'split mt-1', }, [
          seriesCard('reports.byDepartment', data.byDepartment),
          seriesCard('reports.byBranch', data.byBranch)
        ]),
        element('div', { className: 'split mt-1', }, [
          seriesCard('reports.byDesignation', data.byDesignation),
          seriesCard('reports.byEmploymentType', data.byType)
        ])
      ]);
    }
    if (state.type === 'attendance') {
      return element('div', {}, [
        statRow([
          { labelKey: 'attendance.presentDays', value: String(data.totals.present) },
          { labelKey: 'attendance.absentDays', value: String(data.totals.absent) },
          { labelKey: 'attendance.leaveDays', value: String(data.totals.leave) },
          { labelKey: 'attendance.lopDays', value: String(data.totals.lop) },
          { labelKey: 'reports.attendanceRate', value: `${data.attendanceRate}%` },
          { labelKey: 'attendance.lockStatus', value: data.lock.locked ? t('common.yes') : t('common.no') }
        ]),
        element('div', { className: 'mt-1', }, [
          dataTable([
            { labelKey: 'access.employee', render: (row) => row.displayName },
            { labelKey: 'employees.department', render: (row) => row.department || '—' },
            { labelKey: 'attendance.presentDays', align: 'right', render: (row) => String(row.presentDays) },
            { labelKey: 'attendance.absentDays', align: 'right', render: (row) => String(row.absentDays) },
            { labelKey: 'attendance.leaveDays', align: 'right', render: (row) => String(row.leaveDays) },
            { labelKey: 'attendance.lopDays', align: 'right', render: (row) => String(row.lopDays) },
            { labelKey: 'attendance.lateCount', align: 'right', render: (row) => String(row.lateCount) },
            { labelKey: 'attendance.workHours', align: 'right', render: (row) => String(row.workHours) },
            { labelKey: 'attendance.overtime', align: 'right', render: (row) => String(row.overtimeHours) }
          ], data.rows)
        ])
      ]);
    }
    if (state.type === 'leave') {
      return element('div', {}, [
        statRow([
          { labelKey: 'leave.approvedDays', value: String(data.totalApprovedDays) },
          { labelKey: 'leave.noApplications', value: String(data.applications) },
          { labelKey: 'leave.leaveType', value: String(data.byType.length) }
        ]),
        element('div', { className: 'split mt-1', }, [
          seriesCard('reports.byLeaveType', data.byType),
          seriesCard('reports.byMonth', data.byMonth)
        ])
      ]);
    }
    if (state.type === 'payroll') {
      return element('div', {}, [
        statRow([
          { labelKey: 'payroll.employees', value: String(data.totals.employees) },
          { labelKey: 'payroll.gross', value: `₹${data.totals.gross.toLocaleString('en-IN')}` },
          { labelKey: 'payroll.deductions', value: `₹${data.totals.deductions.toLocaleString('en-IN')}` },
          { labelKey: 'payroll.net', value: `₹${data.totals.net.toLocaleString('en-IN')}`, tone: 'accent' }
        ]),
        element('div', { className: 'mt-1', }, [
          dataTable([
            { labelKey: 'access.employee', render: (row) => row.displayName },
            { labelKey: 'employees.department', render: (row) => row.department || '—' },
            { labelKey: 'payroll.gross', align: 'right', render: (row) => money(row.gross) },
            { labelKey: 'payroll.deductions', align: 'right', render: (row) => money(row.deductions) },
            { labelKey: 'payroll.net', align: 'right', render: (row) => money(row.net) }
          ], data.rows, { emptyKey: 'payroll.noRuns' })
        ])
      ]);
    }
    return element('div', { className: 'grid grid-2' }, [
      listCard('reports.probationDue', data.probation, (row) => `${row.displayName} · ${row.date}`),
      listCard('reports.confirmationsDue', data.confirmations, (row) => `${row.displayName} · ${row.date}`),
      listCard('reports.documentsExpiring', data.documents, (row) => `${row.employeeName || row.employeeId} · ${humanize(row.category)} · ${row.expiresAt}`),
      listCard('reports.birthdays', data.birthdays, (row) => `${row.displayName} · ${row.date}`),
      listCard('reports.anniversaries', data.anniversaries, (row) => `${row.displayName} · ${row.years} y · ${row.date}`)
    ]);
  }

  function seriesCard(titleKey, series) {
    const max = Math.max(1, ...series.map((item) => item.value));
    return element('article', { className: 'card pad-1', }, [
      element('h2', { text: t(titleKey) }),
      series.length ? element('div', {}, series.map((item) => element('div', { className: 'mv-sm', }, [
        element('div', { className: 'series-row', }, [
          element('span', { text: item.label }),
          element('strong', { text: String(item.value) })
        ]),
        element('div', { className: 'progress' }, [setVar(element('span'), '--progress', `${Math.round(item.value / max * 100)}%`)])
      ]))) : element('p', { className: 'muted-small', text: t('common.noRecords') })
    ]);
  }

  function listCard(titleKey, rows, formatter) {
    return element('article', { className: 'card pad-1', }, [
      element('h2', { text: t(titleKey) }),
      rows && rows.length
        ? element('ul', { className: 'timeline' }, rows.slice(0, 10).map((row) => element('li', { text: formatter(row) })))
        : element('p', { className: 'muted-small', text: t('common.noRecords') })
    ]);
  }
}

function monthInput(type, value, onChange, min, max, step) {
  const input = element('input', { className: 'form-input', type, value, min, max, step });
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

/* ====================================================================== Workflow */
export async function renderWorkflow(container) {
  const state = { filter: 'pending', view: 'inbox' };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('workflow.title', 'workflow.subtitle', [], 'check'), tabHost, body);
  tabHost.append(tabs([
    { id: 'pending', labelKey: 'workflow.inbox' },
    { id: 'mine', labelKey: 'workflow.mine' },
    { id: 'history', labelKey: 'workflow.history' },
    { id: 'definitions', labelKey: 'workflow.definitions' }
  ], async (id) => { state.view = id; state.filter = id === 'definitions' ? '' : id; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      if (state.view === 'definitions') await drawDefinitions();
      else await drawInbox();
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  async function drawInbox() {
    const data = await load('workflow.inbox', { filter: state.filter, pageSize: 100 });
    body.replaceChildren(
      data.counts ? statRow([
        { labelKey: 'workflow.pending', value: String(data.counts.pending || 0), tone: (data.counts.pending || 0) ? 'warning' : '' },
        { labelKey: 'workflow.mine', value: String(data.counts.mine || 0) },
        { labelKey: 'workflow.history', value: String(data.counts.history || 0) }
      ]) : null,
      element('div', { className: 'mt-1', }, [
        dataTable([
          { labelKey: 'workflow.requestType', render: (row) => element('div', {}, [
            element('strong', { text: row.requestTypeLabel }),
            element('div', { className: 'muted-small', text: row.summary || '' })
          ]) },
          { labelKey: 'workflow.requester', render: (row) => row.requesterName },
          { labelKey: 'workflow.step', align: 'right', render: (row) => String(row.step) },
          { labelKey: 'workflow.due', render: (row) => (row.dueAt ? dateCell(row.dueAt) : '—') },
          { labelKey: 'attendance.state', render: (row) => stateBadge(row.overdue && row.state === 'PENDING' ? 'FAILED' : row.state, row.overdue && row.state === 'PENDING' ? 'workflow.overdue' : undefined) },
          { labelKey: 'attendance.requested', render: (row) => dateCell(row.createdAt) },
          {
            labelKey: 'common.actions',
            render: (row) => element('div', { className: 'row-actions' }, [
              element('button', { className: 'button button-secondary', type: 'button', text: t('common.open'), onclick: () => openApproval(row) })
            ])
          }
        ], data.items, { emptyKey: 'workflow.empty' })
      ])
    );
  }

  async function openApproval(row) {
    const data = await load('workflow.detail', { approvalId: row.approvalId });
    const approval = data.approval;
    const commentField = element('textarea', { className: 'form-input', placeholder: t('workflow.commentPlaceholder'), maxlength: 4000 });
    const reasonField = element('textarea', { className: 'form-input', placeholder: t('workflow.overridePlaceholder'), maxlength: 4000 });
    const act = (action) => async () => {
      try {
        // The backend accepts APPROVE / REJECT / RETURN / CANCEL. An approver who
        // is not on this step decides through the audited override path instead.
        const effective = action === 'OVERRIDE' ? 'APPROVE' : action;
        const payload = { approvalId: approval.approvalId, action: effective, comment: commentField.value };
        if (action === 'OVERRIDE') payload.comment = reasonField.value;
        await apiRequest('workflow.decide', payload);
        showToast(t('workflow.decided', { state: humanize(action) }), 'success');
        await draw();
        document.querySelector('.dialog-backdrop')?.remove();
      } catch (error) {
        showToast(translateError(error), 'error');
      }
    };

    detailDialog({
      title: t('workflow.detailTitle', { type: approval.requestTypeLabel, requester: approval.requesterName }),
      content: element('div', {}, [
        element('div', { className: 'notice-inline' }, [icon('clock'), element('span', { text: approval.summary })]),
        element('h3', { text: t('workflow.trail') }),
        element('ol', { className: 'timeline' }, (approval.steps || []).map((step) => element('li', {}, [
          element('strong', { text: humanize(step.type) }),
          element('div', { className: 'muted-small', text: `${t('workflow.sla')}: ${step.slaHours} h` })
        ]))),
        data.actions.length ? element('div', {}, [
          element('h3', { text: t('workflow.history') }),
          dataTable([
            { labelKey: 'workflow.step', render: (item) => String(item.step) },
            { labelKey: 'workflow.approver', render: (item) => item.approverName },
            { labelKey: 'workflow.action', render: (item) => stateBadge(item.action) },
            { labelKey: 'workflow.comment', render: (item) => item.comment || '—' },
            { labelKey: 'workflow.when', render: (item) => dateCell(item.actedAt) }
          ], data.actions)
        ]) : null,
        approval.canAct ? element('div', { className: 'form-section' }, [
          element('h3', { text: t('workflow.decide') }),
          element('div', { className: 'form-field' }, [element('label', { text: t('workflow.comment') }), commentField]),
          element('div', { className: 'page-actions' }, [
            element('button', { className: 'button button-primary', type: 'button', text: t('workflow.approve'), onclick: act('APPROVE') }),
            element('button', { className: 'button button-secondary', type: 'button', text: t('workflow.reject'), onclick: act('REJECT') }),
            element('button', { className: 'button button-secondary', type: 'button', text: t('workflow.return'), onclick: act('RETURN') })
          ]),
          can('workflow.override') ? element('div', { className: 'form-section' }, [
            element('h3', { text: t('workflow.override') }),
            element('div', { className: 'form-field' }, [element('label', { text: t('workflow.overrideReason') }), reasonField]),
            element('button', { className: 'button button-danger', type: 'button', text: t('workflow.override'), onclick: act('OVERRIDE') })
          ]) : null
        ]) : element('p', { className: 'muted-small', text: t('workflow.notYourTurn') })
      ].filter(Boolean))
    });
  }

  async function drawDefinitions() {
    const data = await load('workflow.definitions', {});
    body.replaceChildren(
      can('workflow.define') ? element('div', { className: 'page-actions mb-1', }, [
        button('workflow.newDefinition', {
          variant: 'primary', iconName: 'plus',
          onClick: () => definitionForm(null, data)
        })
      ]) : null,
      element('div', { className: 'notice-inline' }, [icon('shield'), element('span', { text: t('workflow.definitionsHint') })]),
      dataTable([
        { labelKey: 'workflow.requestType', render: (row) => element('div', {}, [element('strong', { text: humanize(row.requestType) }), element('div', { className: 'muted-small', text: row.name })]) },
        { labelKey: 'workflow.version', align: 'right', render: (row) => String(row.version) },
        { labelKey: 'workflow.steps', align: 'right', render: (row) => String((row.steps || []).length) },
        { labelKey: 'workflow.publishedAt', render: (row) => dateCell(row.publishedAt) },
        { labelKey: 'attendance.state', render: (row) => stateBadge(row.active ? 'ACTIVE' : 'INACTIVE') },
        can('workflow.define') ? {
          labelKey: 'common.actions',
          render: (row) => element('button', { className: 'button button-secondary', type: 'button', text: t('common.edit'),
            onclick: () => definitionForm(row, data)
          })
        } : { labelKey: 'common.actions', render: () => '—' }
      ], data.definitions, { emptyKey: 'workflow.noDefinitions' })
    );
  }

  function definitionForm(definition, data) {
    const steps = (definition?.steps || [{ type: 'APPROVAL', rule: { type: 'reporting_manager', fallbackRole: 'HR_MANAGER' }, slaHours: 48 }]).map((step) => ({
      type: step.type || 'APPROVAL',
      rule: step.rule || { type: 'reporting_manager' },
      slaHours: step.slaHours || 48
    }));
    const host = element('div');
    function render() {
      host.replaceChildren(...steps.map((step, index) => element('div', { className: 'form-section' }, [
        element('h3', { text: `${t('workflow.step')} ${index + 1}` }),
        element('div', { className: 'form-grid' }, [
          selectInline(t('workflow.stepType'), ['APPROVAL', 'REVIEW', 'ACKNOWLEDGE'].map((item) => ({ value: item, label: humanize(item) })), step.type, (value) => { step.type = value; }),
          selectInline(t('workflow.approverRule'), [
            { value: 'reporting_manager', label: t('workflow.reportingManager') },
            { value: 'department_head', label: t('workflow.departmentHead') },
            { value: 'role', label: t('workflow.role') },
            { value: 'permission', label: t('workflow.permission') },
            { value: 'specific_employee', label: t('workflow.specificEmployee') }
          ], step.rule.type || 'reporting_manager', (value) => { step.rule.type = value; }),
          textInline(t('workflow.rolePermission'), step.rule.role || step.rule.permission || step.rule.employeeId || '', (value) => {
            if (step.rule.type === 'role') step.rule.role = value;
            else if (step.rule.type === 'permission') step.rule.permission = value;
            else if (step.rule.type === 'specific_employee') step.rule.employeeId = value;
            else step.rule.fallbackRole = value;
          }),
          numberInline(t('workflow.slaHours'), step.slaHours, (value) => { step.slaHours = value; })
        ]),
        element('button', { className: 'text-button', type: 'button', text: t('common.remove'),
          onclick: () => { steps.splice(index, 1); render(); }
        })
      ])));
      host.append(element('button', { className: 'button button-secondary', type: 'button', text: t('workflow.addStep'),
        onclick: () => { steps.push({ type: 'APPROVAL', rule: { type: 'reporting_manager' }, slaHours: 48 }); render(); }
      }));
    }
    render();
    formDialog({
      wide: true,
      title: definition ? 'workflow.editDefinition' : 'workflow.newDefinition',
      submitLabel: 'workflow.publish',
      fields: [
        { name: 'requestType', labelKey: 'workflow.requestType', type: 'select', required: true, options: data.requestTypes.map((type) => ({ value: type, label: humanize(type) })), value: definition?.requestType || '' },
        { name: 'name', labelKey: 'common.description', required: true, value: definition?.name || '' },
        { name: 'replaceActive', labelKey: 'workflow.replaceVersion', type: 'checkbox', value: !definition }
      ],
      extraNodes: [element('div', { className: 'form-section' }, [element('h3', { text: t('workflow.steps') }), host])],
      onSubmit: async (values) => {
        if (!steps.length) throw new Error(t('workflow.needStep'));
        await apiRequest('workflow.saveDefinition', { ...values, steps });
        await draw();
      }
    });
  }

  function selectInline(label, options, value, onChange) {
    const select = element('select', { className: 'form-input' }, options.map((option) => element('option', { value: option.value, text: option.label, selected: option.value === value })));
    select.addEventListener('change', () => onChange(select.value));
    return element('div', { className: 'form-field' }, [element('label', { text: label }), select]);
  }
  function textInline(label, value, onChange) {
    const input = element('input', { className: 'form-input', value: value || '' });
    input.addEventListener('input', () => onChange(input.value));
    return element('div', { className: 'form-field' }, [element('label', { text: label }), input]);
  }
  function numberInline(label, value, onChange) {
    const input = element('input', { className: 'form-input', type: 'number', min: 1, max: 720, value: value });
    input.addEventListener('input', () => onChange(Number(input.value)));
    return element('div', { className: 'form-field' }, [element('label', { text: label }), input]);
  }
}

/* ================================================================= Notifications */
export async function renderNotifications(container) {
  const body = element('div');
  container.replaceChildren(pageHeader('notifications.title', 'notifications.subtitle', [
    button('notifications.markAll', {
      iconName: 'check',
      onClick: () => apiRequest('notifications.markRead', { all: true }).then(draw).catch((error) => showToast(translateError(error), 'error'))
    })
  ], 'bell'), body);
  await draw();

  async function draw() {
    const data = await load('notifications.list', {});
    body.replaceChildren(
      data.items.length
        ? element('div', { className: 'grid grid-2' }, data.items.map((item) => element('article', { className: `card notification-card${item.read ? '' : ' is-unread'} pad-1`, }, [
          element('div', { className: 'card-heading' }, [
            element('span', { className: 'card-icon' }, icon('bell')),
            element('h2', { text: item.title }),
            item.read ? null : element('span', { className: 'badge badge-info', text: t('notifications.new') })
          ].filter(Boolean)),
          element('p', { text: item.body }),
          element('p', { className: 'muted-small', text: dateCell(item.createdAt).textContent }),
          item.read ? null : element('button', { className: 'text-button', type: 'button', text: t('notifications.markRead'),
            onclick: () => apiRequest('notifications.markRead', { notificationId: item.id }).then(draw).catch((error) => showToast(translateError(error), 'error'))
          })
        ].filter(Boolean))))
        : emptyState(t('notifications.empty'), t('notifications.emptyHint'), 'bell')
    );
  }
}

/* ===================================================================== Settings */
export async function renderSettings(container) {
  const state = { tab: 'company', backup: [] };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('settings.title', 'settings.subtitle', [], 'cog'), tabHost, body);
  tabHost.append(tabs([
    { id: 'company', labelKey: 'settings.company' },
    { id: 'modules', labelKey: 'settings.modules' },
    { id: 'system', labelKey: 'settings.system' }
  ], async (id) => { state.tab = id; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      const data = await load('settings.get', {});
      if (state.tab === 'company') drawCompany(data);
      else if (state.tab === 'modules') drawModules(data);
      else await drawSystem(data);
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  function drawCompany(data) {
    const groups = {};
    data.settings.forEach((setting) => {
      groups[setting.category] = groups[setting.category] || [];
      groups[setting.category].push(setting);
    });
    const host = element('div');
    Object.entries(groups).forEach(([category, settings]) => {
      const section = element('article', { className: 'card pad-1-5 mb-1 mt-1', }, [
        element('h2', { text: humanize(category) })
      ]);
      const form = element('div', { className: 'form-grid' });
      settings.forEach((setting) => form.append(settingField(setting)));
      section.append(form, element('div', { className: 'page-actions', }, [
        button('common.save', {
          variant: 'primary',
          onClick: async (event) => {
            const values = {};
            settings.forEach((setting) => {
              const control = form.querySelector(`#setting-${setting.key}`);
              if (!control) return;
              values[setting.key] = control.type === 'checkbox' ? control.checked : control.value;
            });
            await apiRequest('settings.update', { values }).then(() => {
              showToast(t('common.saved'), 'success');
              draw();
            }).catch((error) => showToast(translateError(error), 'error'));
          }
        })
      ]));
      host.append(section);
    });
    body.replaceChildren(host);
  }

  function settingField(setting) {
    const id = `setting-${setting.key}`;
    let control;
    if (setting.type === 'boolean') control = element('input', { id, type: 'checkbox', checked: setting.value === true || String(setting.value).toUpperCase() === 'TRUE' });
    else if (setting.type === 'select') {
      control = element('select', { id, className: 'form-input' });
      (setting.options || []).forEach((option) => control.append(element('option', { value: option, text: humanize(option), selected: String(setting.value) === String(option) })));
    } else if (setting.type === 'json' || setting.type === 'textarea') {
      control = element('textarea', { id, className: 'form-input', value: typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value) });
    } else {
      control = element('input', {
        id, className: 'form-input',
        type: setting.type === 'number' ? 'number' : setting.type === 'date' ? 'date' : setting.type === 'color' ? 'color' : 'text',
        value: setting.value ?? '', min: setting.min, max: setting.max
      });
    }
    return element('div', { className: 'form-field' }, [
      setting.type === 'boolean' ? element('label', { className: 'checkbox-row', for: id }, [control, element('span', { text: setting.label })]) : element('label', { for: id, text: setting.label }),
      setting.type !== 'boolean' ? control : null,
      setting.help ? element('span', { className: 'field-hint', text: setting.help }) : null
    ].filter(Boolean));
  }

  function drawModules(data) {
    const groups = {};
    data.features.forEach((feature) => {
      groups[feature.module] = groups[feature.module] || [];
      groups[feature.module].push(feature);
    });
    body.replaceChildren(
      element('div', { className: 'notice-inline' }, [icon('shield'), element('span', { text: t('settings.modulesHint') })]),
      ...Object.entries(groups).map(([module, features]) => element('article', { className: 'card pad-1-5 mb-1', }, [
        element('h2', { text: module }),
        ...features.map((feature) => {
          const toggle = element('input', { type: 'checkbox', id: `module-${feature.key}`, checked: feature.enabled });
          toggle.addEventListener('change', async () => {
            try {
              await apiRequest('settings.updateFeatures', { features: { [feature.key]: toggle.checked } });
              showToast(t('common.saved'), 'success');
            } catch (error) {
              toggle.checked = !toggle.checked;
              showToast(translateError(error), 'error');
            }
          });
          return element('div', { className: 'checkbox-row mv-sm', }, [
            toggle,
            element('label', { for: `module-${feature.key}` }, [
              element('strong', { text: feature.label }),
              element('div', { className: 'muted-small', text: feature.description })
            ])
          ]);
        })
      ]))
    );
  }

  async function drawSystem(data) {
    const backup = await load('backup.list', {});
    const selfTestHost = element('div');
    body.replaceChildren(
      element('article', { className: 'card pad-1-5 mb-1', }, [
        element('h2', { text: t('settings.selfTest') }),
        element('p', { className: 'page-subtitle', text: t('settings.selfTestHint') }),
        element('div', { className: 'page-actions' }, [
          button('settings.runSelfTest', {
            variant: 'primary', iconName: 'check',
            onClick: async () => {
              const result = await apiRequest('system.selfTest', {}, { isRead: true });
              selfTestHost.replaceChildren(
                element('p', { text: t('settings.selfTestScore', { score: result.score, passed: result.passed, total: result.total }) }),
                dataTable([
                  { labelKey: 'settings.check', render: (row) => row.name },
                  { labelKey: 'attendance.state', render: (row) => stateBadge(row.passed ? 'APPROVED' : 'FAILED') },
                  { labelKey: 'access.details', render: (row) => row.detail || '—' }
                ], result.checks)
              );
            }
          }),
          can('settings.edit') ? button('settings.runSetup', {
            iconName: 'refresh',
            onClick: () => apiRequest('system.runSetup', {})
              .then((result) => { showToast(t('settings.setupDone'), 'success'); return result; })
              .catch((error) => showToast(translateError(error), 'error'))
          }) : null,
          can('settings.edit') ? button('settings.runMaintenance', {
            iconName: 'clock',
            onClick: () => apiRequest('system.runMaintenance', {})
              .then((result) => showToast(t('settings.maintenanceDone', { marks: JSON.stringify(result).slice(0, 40) }), 'success'))
              .catch((error) => showToast(translateError(error), 'error'))
          }) : null
        ].filter(Boolean)),
        selfTestHost
      ]),
      element('article', { className: 'card pad-1-5 mb-1', }, [
        element('div', { className: 'card-heading' }, [
          element('h2', { text: t('settings.backup') }),
          can('backup.create') ? button('settings.createBackup', {
            variant: 'primary', iconName: 'download',
            onClick: () => apiRequest('backup.create', { type: 'MANUAL' }).then((result) => {
              showToast(t('settings.backupCreated'), 'success');
              draw();
              return result;
            }).catch((error) => showToast(translateError(error), 'error'))
          }) : null
        ].filter(Boolean)),
        element('p', { className: 'page-subtitle', text: t('settings.backupHint') }),
        dataTable([
          { labelKey: 'settings.backupId', render: (row) => row.backupId },
          { labelKey: 'settings.backupType', render: (row) => humanize(row.type || row.backupType) },
          { labelKey: 'settings.createdAt', render: (row) => dateCell(row.createdAt) },
          { labelKey: 'settings.rows', align: 'right', render: (row) => String(row.totalRows || 0) },
          {
            labelKey: 'common.actions',
            render: (row) => element('div', { className: 'row-actions' }, [
              button('settings.verify', {
                onClick: () => apiRequest('backup.verify', { backupId: row.backupId }).then((result) => {
                  showToast(result.checksumMatches ? t('settings.verified') : t('settings.verifyFailed'), result.checksumMatches ? 'success' : 'error');
                  return result;
                }).catch((error) => showToast(translateError(error), 'error'))
              }),
              can('backup.restore') ? button('settings.restore', {
                variant: 'danger',
                onClick: () => formDialog({
                  title: 'settings.restore',
                  intro: t('settings.restoreHint'),
                  fields: [
                    { name: 'confirmation', labelKey: 'settings.restoreConfirm', required: true, placeholder: 'RESTORE' },
                    { name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full' }
                  ],
                  submitLabel: 'settings.restore',
                  onSubmit: async (values) => {
                    await apiRequest('backup.restore', { backupId: row.backupId, confirmation: values.confirmation, reason: values.reason });
                    showToast(t('settings.restored'), 'success');
                  }
                })
              }) : null
            ].filter(Boolean))
          }
        ], backup.items || [], { emptyKey: 'settings.noBackups' })
      ]),
      element('article', { className: 'card pad-1-5', }, [
        element('h2', { text: t('settings.environment') }),
        dataTable([
          { labelKey: 'settings.key', render: (row) => row.key },
          { labelKey: 'settings.value', render: (row) => row.value }
        ], [
          { key: t('settings.version'), value: data.version || '—' },
          { key: t('settings.generatedAt'), value: dateCell(data.generatedAt || new Date().toISOString()).textContent },
          { key: t('settings.security'), value: JSON.stringify(data.security || {}).slice(0, 160) }
        ])
      ])
    );
  }
}
