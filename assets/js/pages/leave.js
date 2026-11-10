import { apiRequest } from '../api.js';
import { t, translateError } from '../i18n.js';
import {
  button, can, confirmDialog, dataTable, dateCell, element, emptyState, formDialog, humanize, icon, load,
  pageHeader, setVar, stateBadge, tabs
} from './_kit.js';

export async function renderLeave(container) {
  const state = { tab: 'mine', month: new Date().toISOString().slice(0, 7), filter: 'all' };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('leave.title', 'leave.subtitle', [], 'calendar'), tabHost, body);
  tabHost.append(tabs([
    { id: 'mine', labelKey: 'leave.tabMine' },
    { id: 'calendar', labelKey: 'leave.tabCalendar' },
    { id: 'register', labelKey: 'leave.tabRegister' },
    { id: 'types', labelKey: 'leave.tabTypes' }
  ], async (id) => { state.tab = id; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      if (state.tab === 'mine') await drawMine();
      else if (state.tab === 'calendar') await drawCalendar();
      else if (state.tab === 'register') await drawRegister();
      else await drawTypes();
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  /* ----------------------------------------------------------------- Mine */
  async function drawMine() {
    const data = await load('leave.myLeave', {});
    const applyButton = can('leave.apply') ? button('leave.apply', {
      variant: 'primary', iconName: 'plus',
      onClick: () => formDialog({
        title: 'leave.apply',
        fields: [
          { name: 'leaveTypeId', labelKey: 'leave.leaveType', type: 'select', required: true, options: data.leaveTypes.filter((type) => type.active).map((type) => ({ value: type.id, label: `${type.name} (${type.code})` })) },
          { name: 'startDate', labelKey: 'leave.startDate', type: 'date', required: true },
          { name: 'endDate', labelKey: 'leave.endDate', type: 'date', required: true },
          { name: 'halfDayPeriod', labelKey: 'leave.halfDay', type: 'select', options: [{ value: 'FIRST_HALF', label: t('leave.firstHalf') }, { value: 'SECOND_HALF', label: t('leave.secondHalf') }] },
          { name: 'handoverTo', labelKey: 'leave.handoverTo', type: 'text', placeholder: 'EMP0002' },
          { name: 'contactDuringLeave', labelKey: 'leave.contact', type: 'text' },
          { name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full' }
        ],
        onSubmit: async (values) => {
          await apiRequest('leave.apply', values);
          await draw();
        }
      })
    }) : null;

    const balanceCards = element('div', { className: 'grid grid-4' }, data.balances.map((balance) => setVar(element('article', { className: 'stat-card accent' }, [
      element('span', { className: 'stat-label', text: `${balance.name} (${balance.code})` }),
      element('strong', { className: 'stat-value', text: String(balance.balance) }),
      element('span', { className: 'stat-hint', text: t('leave.usedOfQuota', { used: balance.used, quota: balance.annualQuota }) }),
      balance.maxPerApplication ? element('span', { className: 'muted-small', text: t('leave.maxPerApplication', { days: balance.maxPerApplication }) }) : null
    ].filter(Boolean)), '--accent-bar', balance.color)));

    const upstream = element('article', { className: 'card pad-1 mt-1', }, [
      element('h2', { text: t('leave.upcoming') }),
      data.upcoming.length
        ? element('ul', { className: 'timeline' }, data.upcoming.map((item) => element('li', {}, [
          element('strong', { text: item.leaveTypeName }),
          element('div', { text: `${item.startDate} → ${item.endDate} · ${item.days} ${t('leave.days')}` }),
          stateBadge(item.state)
        ])))
        : element('p', { className: 'muted-small', text: t('leave.noUpcoming') })
    ]);

    body.replaceChildren(
      element('div', { className: 'page-actions mb-1', }, [
        applyButton,
        element('span', { className: 'muted-small', text: t('leave.policyHint', { days: data.policy.maxConsecutiveDays }) })
      ].filter(Boolean)),
      balanceCards,
      element('h3', { className: 'mt-2', text: t('leave.myApplications') }),
      dataTable([
        { labelKey: 'leave.leaveType', render: (row) => row.leaveTypeName },
        { labelKey: 'leave.period', render: (row) => `${row.startDate} → ${row.endDate}` },
        { labelKey: 'leave.days', align: 'right', render: (row) => String(row.days) },
        { labelKey: 'common.reason', render: (row) => row.reason.slice(0, 60) },
        { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
        {
          labelKey: 'common.actions',
          render: (row) => (['PENDING', 'APPROVED'].includes(row.state) ? element('button', { className: 'button button-secondary', type: 'button', text: t('common.cancel'),
            onclick: () => confirmDialog({
              titleKey: 'leave.cancelLeave', message: t('leave.cancelConfirm'),
              onConfirm: async () => { await apiRequest('leave.cancel', { applicationId: row.id }); await draw(); }
            })
          }) : '—')
        }
      ], data.applications, { emptyKey: 'leave.noApplications' }),
      upstream
    );
  }

  /* ------------------------------------------------------------- Calendar */
  async function drawCalendar() {
    const data = await load('leave.calendar', { month: state.month });
    const monthField = element('input', { className: 'form-input', type: 'month', value: state.month });
    monthField.addEventListener('change', () => { state.month = monthField.value; draw(); });

    const [year, month] = state.month.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const startOffset = first.getUTCDay();
    const grid = element('div', { className: 'calendar-grid' });
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((label) => grid.append(element('div', { className: 'calendar-weekday', text: label })));
    for (let i = 0; i < startOffset; i += 1) grid.append(element('div', { className: 'calendar-cell is-faded' }));
    data.days.forEach((day) => {
      const classes = ['calendar-cell'];
      if (day.weekend) classes.push('is-weekend');
      if (day.holiday) classes.push('is-holiday');
      if (day.myLeave) classes.push('is-leave');
      if (day.date === new Date().toISOString().slice(0, 10)) classes.push('is-today');
      const cell = element('div', { className: classes.join(' ') }, [
        element('header', {}, [
          element('span', { text: String(Number(day.date.slice(8, 10))) }),
          day.leaveCount ? element('span', { className: 'badge badge-info', text: String(day.leaveCount) }) : element('span')
        ]),
        day.holiday ? element('span', { className: 'calendar-tag holiday', text: day.holiday, title: day.holiday }) : null,
        day.myLeave ? element('span', { className: 'calendar-tag', text: t('leave.youAreOnLeave') }) : null,
        !day.myLeave && day.leaveNames.length ? element('span', { className: 'muted-small', text: day.leaveNames.join(', ') }) : null
      ].filter(Boolean));
      grid.append(cell);
    });

    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field narrow' }, [element('label', { text: t('attendance.month') }), monthField])
      ]),
      grid,
      element('article', { className: 'card pad-1 mt-1', }, [
        element('h2', { text: t('leave.holidays') }),
        data.holidays.length
          ? element('div', { className: 'chip-row' }, data.holidays.map((holiday) => element('span', { className: 'badge badge-info', text: `${holiday.date.slice(5)} · ${holiday.name}` })))
          : element('p', { className: 'muted-small', text: t('leave.noHolidays') })
      ])
    );
  }

  /* ------------------------------------------------------------- Register */
  async function drawRegister() {
    const data = await load('leave.register', { filter: state.filter, pageSize: 200 });
    const filterField = element('select', { className: 'form-input' }, [
      { value: 'all', label: t('common.all') },
      { value: 'pending', label: t('leave.pending') },
      { value: 'approved', label: t('leave.approved') },
      { value: 'rejected', label: t('leave.rejected') }
    ].map((item) => element('option', { value: item.value, text: item.label, selected: item.value === state.filter })));
    filterField.addEventListener('change', () => { state.filter = filterField.value; draw(); });

    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field narrow' }, [element('label', { text: t('leave.filter') }), filterField])
      ]),
      element('div', { className: 'grid grid-4' }, [
        statCard('leave.pending', data.summary.pending),
        statCard('leave.approved', data.summary.approved),
        statCard('leave.rejected', data.summary.rejected),
        statCard('leave.approvedDays', data.summary.days)
      ]),
      element('div', { className: 'mt-1', }, [
        dataTable([
          { labelKey: 'access.employee', render: (row) => element('div', {}, [
            element('strong', { text: row.employeeName }),
            element('div', { className: 'muted-small', text: row.employeeId })
          ]) },
          { labelKey: 'leave.leaveType', render: (row) => row.leaveTypeName },
          { labelKey: 'leave.period', render: (row) => `${row.startDate} → ${row.endDate}` },
          { labelKey: 'leave.days', align: 'right', render: (row) => String(row.days) },
          { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
          { labelKey: 'leave.appliedOn', render: (row) => dateCell(row.appliedAt) },
          {
            labelKey: 'common.actions',
            render: (row) => element('button', { className: 'button button-secondary', type: 'button', text: t('common.view'),
              onclick: () => import('./_kit.js').then(({ detailDialog }) => detailDialog({
                title: `${row.employeeName} · ${row.leaveTypeName}`,
                content: element('div', {}, [
                  element('p', { text: `${row.startDate} → ${row.endDate} (${row.days} ${t('leave.days')})` }),
                  element('p', { text: row.reason }),
                  element('p', { className: 'muted-small', text: t('leave.contact') + ': ' + (row.contactDuringLeave || '—') }),
                  element('p', { className: 'muted-small', text: t('leave.handoverTo') + ': ' + (row.handoverName || '—') })
                ])
              }))
            })
          }
        ], data.items, { emptyKey: 'leave.noApplications' })
      ]),
      can('leave.manage') ? element('div', { className: 'page-actions mt-1', }, [
        button('leave.adjustBalance', {
          variant: 'secondary', iconName: 'plus',
          onClick: () => load('employees.picker', {}).then((employees) => formDialog({
            title: 'leave.adjustBalance',
            fields: [
              { name: 'employeeId', labelKey: 'access.employee', type: 'select', required: true, options: employees.items.map((item) => ({ value: item.employeeId, label: `${item.displayName} (${item.employeeId})` })) },
              { name: 'leaveTypeId', labelKey: 'leave.leaveType', type: 'select', required: true, options: data.leaveTypes.map((type) => ({ value: type.id, label: type.name })) },
              { name: 'days', labelKey: 'leave.days', type: 'number', step: '0.5', required: true, help: 'leave.adjustHelp' },
              { name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full' }
            ],
            onSubmit: async (values) => { await apiRequest('leave.adjustBalance', values); await draw(); }
          }))
        })
      ]) : null
    );
  }

  /* ---------------------------------------------------------------- Types */
  async function drawTypes() {
    const data = await load('leave.myLeave', {});
    body.replaceChildren(
      can('leave.manage') ? element('div', { className: 'page-actions mb-1', }, [
        button('leave.newType', {
          variant: 'primary', iconName: 'plus',
          onClick: () => typeForm(null)
        })
      ]) : null,
      dataTable([
        { labelKey: 'leave.leaveType', render: (row) => element('div', {}, [
          element('strong', { text: row.name }),
          element('div', { className: 'muted-small', text: row.description })
        ]) },
        { labelKey: 'org.code', render: (row) => row.code },
        { labelKey: 'leave.annualQuota', align: 'right', render: (row) => String(row.rules.annualQuota) },
        { labelKey: 'leave.accrual', render: (row) => humanize(row.rules.accrual) },
        { labelKey: 'leave.carryForward', align: 'right', render: (row) => String(row.rules.carryForward) },
        { labelKey: 'leave.maxPerApplication', align: 'right', render: (row) => String(row.rules.maxPerApplication || '—') },
        { labelKey: 'leave.documentRequired', render: (row) => (row.rules.documentRequired ? t('common.yes') : t('common.no')) },
        { labelKey: 'access.colStatus', render: (row) => stateBadge(row.active ? 'ACTIVE' : 'INACTIVE') },
        can('leave.manage') ? { labelKey: 'common.actions', render: (row) => element('button', { className: 'button button-secondary', type: 'button', text: t('common.edit'), onclick: () => typeForm(row) }) } : { labelKey: 'common.actions', render: () => '—' }
      ], data.leaveTypes)
    );
  }

  function typeForm(type) {
    const rules = type?.rules || {};
    formDialog({
      wide: true,
      title: type ? 'leave.editType' : 'leave.newType',
      fields: [
        { name: 'code', labelKey: 'org.code', required: true, value: type?.code || '' },
        { name: 'name', labelKey: 'org.name', required: true, value: type?.name || '' },
        { name: 'description', labelKey: 'common.description', type: 'textarea', value: type?.description || '', span: 'full' },
        { name: 'annualQuota', labelKey: 'leave.annualQuota', type: 'number', min: 0, max: 365, value: rules.annualQuota ?? 12, required: true },
        { name: 'accrual', labelKey: 'leave.accrual', type: 'select', required: true, value: rules.accrual || 'ANNUAL', options: ['ANNUAL', 'MONTHLY', 'QUARTERLY', 'NONE'].map((item) => ({ value: item, label: humanize(item) })) },
        { name: 'carryForward', labelKey: 'leave.carryForward', type: 'number', min: 0, max: 365, value: rules.carryForward ?? 0 },
        { name: 'maxPerApplication', labelKey: 'leave.maxPerApplication', type: 'number', min: 0, max: 365, value: rules.maxPerApplication ?? 0 },
        { name: 'encashable', labelKey: 'leave.encashableDays', type: 'number', min: 0, max: 365, value: rules.encashable ?? 0 },
        { name: 'gender', labelKey: 'leave.appliesToGender', type: 'select', value: rules.gender || '', options: ['MALE', 'FEMALE'].map((item) => ({ value: item, label: humanize(item) })) },
        { name: 'allowHalfDay', labelKey: 'leave.allowHalfDay', type: 'checkbox', value: rules.allowHalfDay !== false },
        { name: 'documentRequired', labelKey: 'leave.documentRequired', type: 'checkbox', value: Boolean(rules.documentRequired) },
        { name: 'requiresApproval', labelKey: 'leave.requiresApproval', type: 'checkbox', value: rules.requiresApproval !== false },
        { name: 'color', labelKey: 'leave.color', type: 'color', value: rules.color || '#3157d5' },
        { name: 'active', labelKey: 'org.active', type: 'checkbox', value: type ? type.active : true }
      ],
      onSubmit: async (values) => {
        const { active, ...rest } = values;
        await apiRequest('leave.saveType', {
          id: type?.id, code: rest.code, name: rest.name, description: rest.description, active,
          rules: {
            annualQuota: rest.annualQuota, accrual: rest.accrual, carryForward: rest.carryForward,
            maxPerApplication: rest.maxPerApplication, encashable: rest.encashable, gender: rest.gender,
            allowHalfDay: rest.allowHalfDay, documentRequired: rest.documentRequired,
            requiresApproval: rest.requiresApproval, color: rest.color
          }
        });
        await draw();
      }
    });
  }
}

function statCard(labelKey, value) {
  return element('article', { className: 'stat-card' }, [
    element('span', { className: 'stat-label', text: t(labelKey) }),
    element('strong', { className: 'stat-value', text: String(value) })
  ]);
}
