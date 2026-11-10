import { apiRequest } from '../api.js';
import { t, translateError } from '../i18n.js';
import {
  button, can, confirmDialog, dataTable, dateCell, downloadText, element, emptyState, formDialog, humanize,
  icon, load, money, pageHeader, stateBadge, statRow, tabs, showToast
} from './_kit.js';

export async function renderPayroll(container) {
  const state = { tab: 'runs', period: suggestedPeriod(), structureFor: '' };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('payroll.title', 'payroll.subtitle', [
    can('salary.create') ? button('payroll.salaryIndex', { iconName: 'money', onClick: () => { state.tab = 'salaries'; setTabs(); } }) : null
  ].filter(Boolean), 'money'), tabHost, body);
  setTabs();
  await draw();

  function setTabs() {
    tabHost.replaceChildren(tabs([
      { id: 'runs', labelKey: 'payroll.tabRuns' },
      { id: 'salaries', labelKey: 'payroll.tabSalaries' },
      { id: 'payslips', labelKey: 'payroll.tabPayslips' },
      { id: 'statutory', labelKey: 'payroll.tabStatutory' }
    ], async (id) => { state.tab = id; await draw(); }));
  }

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      if (state.tab === 'runs') await drawRuns();
      else if (state.tab === 'salaries') await drawSalaries();
      else if (state.tab === 'payslips') await drawPayslips();
      else await drawStatutory();
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  /* ----------------------------------------------------------------- Runs */
  async function drawRuns() {
    const data = await load('payroll.runs', {});
    const periodField = element('input', { className: 'form-input', type: 'month', value: data.suggestedPeriod });
    const runHost = element('div');
    const stats = data.stats;

    async function openRun(runId) {
      const detail = await apiRequest('payroll.runDetail', { runId });
      showRun(detail, runHost, () => draw());
    }

    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field narrow' }, [element('label', { text: t('payroll.period') }), periodField]),
        data.canPrepare ? button('payroll.prepare', {
          variant: 'primary', iconName: 'plus',
          onClick: (event) => prepare(periodField.value, event.currentTarget)
        }) : null,
        element('span', { className: 'muted-small', text: data.attendanceLocked ? t('payroll.priorMonthLocked') : t('payroll.lockHint') })
      ].filter(Boolean)),
      statRow([
        { labelKey: 'payroll.runsTotal', value: String(stats.runs) },
        { labelKey: 'payroll.runsReleased', value: String(stats.released) },
        { labelKey: 'payroll.caVerified', value: data.statutory.caVerified ? t('common.yes') : t('common.no'), tone: data.statutory.caVerified ? '' : 'warning' }
      ]),
      element('div', { className: 'mt-1', }, [
        dataTable([
          { labelKey: 'payroll.period', render: (row) => element('strong', { text: row.period }) },
          { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
          { labelKey: 'payroll.employees', align: 'right', render: (row) => String(row.employeeCount) },
          { labelKey: 'payroll.gross', align: 'right', render: (row) => money(row.gross) },
          { labelKey: 'payroll.net', align: 'right', render: (row) => money(row.net) },
          { labelKey: 'payroll.preparedBy', render: (row) => row.preparedName || row.preparedBy || '—' },
          { labelKey: 'payroll.verifiedBy', render: (row) => row.verifiedName || row.verifiedBy || '—' },
          {
            labelKey: 'common.actions',
            render: (row) => element('div', { className: 'row-actions' }, [
              element('button', { className: 'button button-secondary', type: 'button', text: t('common.open'), onclick: () => openRun(row.id) }),
              transitionButton(row, 'VERIFIED', 'payroll.verify'),
              transitionButton(row, 'APPROVED', 'payroll.approve'),
              transitionButton(row, 'RELEASED', 'payroll.release'),
              transitionButton(row, 'CLOSED', 'payroll.close'),
              ['RELEASED', 'CLOSED'].indexOf(row.state) >= 0 && (data.canRelease || can('payroll.reopen')) ? element('button', { className: 'button button-danger', type: 'button', text: t('payroll.reopen'),
                onclick: () => formDialog({
                  title: 'payroll.reopen',
                  fields: [{ name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full', min: 10 }],
                  submitLabel: 'payroll.reopen',
                  onSubmit: async (values) => { await apiRequest('payroll.reopen', { runId: row.id, reason: values.reason }); await draw(); }
                })
              }) : null
            ].filter(Boolean))
          }
        ], data.items, { emptyKey: 'payroll.noRuns' })
      ]),
      runHost
    );
  }

  /** One button per legal next state. The server re-checks the permission, so an
   *  unauthorised click is refused with a translated error instead of a dead button. */
  function transitionButton(row, target, labelKey) {
    const map = { VERIFIED: 'PREPARED', APPROVED: 'VERIFIED', RELEASED: 'APPROVED', CLOSED: 'RELEASED' };
    const actions = { VERIFIED: 'payroll.verify', APPROVED: 'payroll.approve', RELEASED: 'payroll.release', CLOSED: 'payroll.close' };
    if (row.state !== map[target]) return null;
    return element('button', { className: 'button button-secondary', type: 'button', text: t(labelKey),
      onclick: () => apiRequest(actions[target], { runId: row.id })
        .then(() => { showToast(t('common.saved'), 'success'); return draw(); })
        .catch((error) => showToast(translateError(error), 'error'))
    });
  }

  async function prepare(period, trigger) {
    if (!/^\d{4}-\d{2}$/.test(period)) { showToast(t('payroll.invalidPeriod'), 'error'); return; }
    trigger.disabled = true;
    try {
      const result = await apiRequest('payroll.prepare', { period });
      showToast(t('payroll.preparedToast', { count: result.employeeCount || result.items?.length || 0 }), 'success');
      await draw();
    } catch (error) {
      showToast(translateError(error), 'error');
    } finally {
      trigger.disabled = false;
    }
  }

  function showRun(detail, host, refresh) {
    const lines = detail.items.map((item) => ({ ...item }));
    host.replaceChildren(element('article', { className: 'card pad-1 mt-2', }, [
      element('div', { className: 'card-heading' }, [
        element('h2', { text: `${t('payroll.runFor', { period: detail.run.period })}` }),
        stateBadge(detail.run.state)
      ]),
      statRow([
        { labelKey: 'payroll.gross', value: `₹${detail.totals.gross.toLocaleString('en-IN')}` },
        { labelKey: 'payroll.deductions', value: `₹${detail.totals.deductions.toLocaleString('en-IN')}` },
        { labelKey: 'payroll.net', value: `₹${detail.totals.net.toLocaleString('en-IN')}` },
        { labelKey: 'payroll.employerCost', value: `₹${detail.totals.employerCost.toLocaleString('en-IN')}` }
      ]),
      detail.run.reopenReason ? element('p', { className: 'muted-small', text: `${t('payroll.reopenReason')}: ${detail.run.reopenReason}` }) : null,
      Object.keys(detail.flags).length ? element('p', { className: 'muted-small', text: `${t('payroll.flags')}: ${Object.entries(detail.flags).map(([flag, count]) => `${flag} ×${count}`).join(', ')}` }) : null,
      dataTable([
        { labelKey: 'access.employee', render: (row) => element('div', {}, [
          element('strong', { text: row.employeeName }),
          element('div', { className: 'muted-small', text: row.employeeId })
        ]) },
        { labelKey: 'payroll.paidDays', align: 'right', render: (row) => String(row.paidDays) },
        { labelKey: 'payroll.lopDays', align: 'right', render: (row) => String(row.lopDays) },
        { labelKey: 'payroll.gross', align: 'right', render: (row) => money(row.gross) },
        { labelKey: 'payroll.deductions', align: 'right', render: (row) => money(row.deductions) },
        { labelKey: 'payroll.net', align: 'right', render: (row) => money(row.net) },
        {
          labelKey: 'common.actions',
          render: (row) => element('button', { className: 'button button-secondary', type: 'button', text: t('common.view'),
            onclick: () => import('./_kit.js').then(({ detailDialog }) => detailDialog({
              title: `${row.employeeName} · ${detail.run.period}`,
              content: breakdown(row)
            }))
          })
        }
      ], lines, { emptyKey: 'payroll.noRecords' })
    ]));
    if (refresh) host.dataset.refresh = 'true';
  }

  function breakdown(row) {
    const earnings = element('table', { className: 'data-table' }, [
      element('thead', {}, [element('tr', {}, [element('th', { text: t('payroll.component') }), element('th', { className: 'numeric', text: t('payroll.amount') })])]),
      element('tbody', {}, row.earnings.map((line) => element('tr', {}, [
        element('td', { text: line.name }), element('td', { className: 'numeric', text: line.amount.toFixed(2) })
      ])))
    ]);
    const deductions = element('table', { className: 'data-table' }, [
      element('thead', {}, [element('tr', {}, [element('th', { text: t('payroll.deduction') }), element('th', { className: 'numeric', text: t('payroll.amount') })])]),
      element('tbody', {}, row.deductionLines.map((line) => element('tr', {}, [
        element('td', { text: line.name }), element('td', { className: 'numeric', text: line.amount.toFixed(2) })
      ])))
    ]);
    return element('div', { className: 'split' }, [
      element('div', {}, [element('h3', { text: t('payroll.earnings') }), earnings]),
      element('div', {}, [element('h3', { text: t('payroll.deductions') }), deductions,
        element('p', { className: 'money', text: `${t('payroll.net')}: ₹${row.net.toFixed(2)}` }),
        row.attendance ? element('p', { className: 'muted-small', text: t('payroll.attendanceBasis', { present: row.attendance.presentDays || 0, paid: row.paidDays }) }) : null
      ])
    ]);
  }

  /* ------------------------------------------------------------- Salaries */
  async function drawSalaries() {
    const data = await load('payroll.salaryIndex', { pageSize: 200 });
    const search = element('input', { className: 'form-input', type: 'search', placeholder: t('common.search') });
    const tableHost = element('div');
    await renderTable();

    async function renderTable() {
      const response = search.value ? await load('payroll.salaryIndex', { search: search.value, pageSize: 200 }) : data;
      tableHost.replaceChildren(dataTable([
        { labelKey: 'access.employee', render: (row) => element('div', {}, [
          element('strong', { text: row.displayName }),
          element('div', { className: 'muted-small', text: `${row.employeeId} · ${row.designation || '—'}` })
        ]) },
        { labelKey: 'payroll.department', render: (row) => row.department || '—' },
        { labelKey: 'payroll.effectiveFrom', render: (row) => (row.effectiveFrom ? dateCell(row.effectiveFrom) : '—') },
        { labelKey: 'payroll.gross', align: 'right', render: (row) => (row.hasStructure ? money(row.gross) : stateBadge('INACTIVE', 'payroll.missingStructure')) },
        { labelKey: 'payroll.ctc', align: 'right', render: (row) => (row.ctcAnnual ? money(row.ctcAnnual) : '—') },
        {
          labelKey: 'common.actions',
          render: (row) => element('div', { className: 'row-actions' }, [
            element('button', { className: 'button button-secondary', type: 'button', text: t('common.view'), onclick: () => structureDialog(row.employeeId) }),
            can('salary.create') ? element('button', { className: 'button button-secondary', type: 'button', text: t('payroll.newStructure'), onclick: () => structureForm(row.employeeId) }) : null
          ].filter(Boolean))
        }
      ], response.items, { emptyKey: 'payroll.noStructures' }));
    }

    search.addEventListener('change', renderTable);
    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field' }, [element('label', { text: t('common.search') }), search])
      ]),
      statRow([
        { labelKey: 'payroll.employees', value: String(data.stats.total) },
        { labelKey: 'payroll.configured', value: String(data.stats.configured) },
        { labelKey: 'payroll.missing', value: String(data.stats.missing), tone: data.stats.missing ? 'warning' : '' },
        { labelKey: 'payroll.monthlyGross', value: `₹${data.stats.monthlyGross.toLocaleString('en-IN')}` }
      ]),
      element('div', { className: 'mt-1', }, [tableHost])
    );
  }

  async function structureDialog(employeeId) {
    const data = await load('payroll.structureDetail', { employeeId });
    const { detailDialog } = await import('./_kit.js');
    detailDialog({
      title: `${data.employee.displayName} · ${t('payroll.salaryStructure')}`,
      content: element('div', {}, data.structures.length ? [
        ...data.structures.map((structure) => element('article', { className: 'form-section' }, [
          element('h3', { text: `${structure.effectiveFrom} → ${structure.effectiveTo || t('payroll.open')}` }),
          dataTable([
            { labelKey: 'payroll.component', render: (line) => line.name },
            { labelKey: 'payroll.kind', render: (line) => humanize(line.kind) },
            { labelKey: 'payroll.amount', align: 'right', render: (line) => money(line.amount) }
          ], structure.components),
          element('p', { className: 'money', text: `${t('payroll.gross')}: ₹${structure.totals.gross.toFixed(2)}` })
        ])),
        can('salary.edit') ? element('div', { className: 'page-actions' }, [
          button('payroll.newStructure', { variant: 'primary', onClick: () => structureForm(employeeId) })
        ]) : null
      ].filter(Boolean) : [element('p', { text: t('payroll.noStructures') })])
    });
  }

  async function structureForm(employeeId) {
    const data = employeeId ? await load('payroll.structureDetail', { employeeId }) : null;
    const current = data?.current;
    const linesHost = element('div', { className: 'form-grid' });
    const rows = [];
    const template = { basicPercent: 50, hraPercent: 40, daPercent: 0 };

    function addRow(component = {}) {
      const index = rows.length;
      const nameField = element('input', { className: 'form-input', value: component.name || '', placeholder: t('payroll.componentName') });
      const amountField = element('input', { className: 'form-input', type: 'number', step: '1', min: '0', value: component.amount ?? '' });
      const kindField = element('select', { className: 'form-input' }, [
        element('option', { value: 'EARNING', text: t('payroll.earnings') }),
        element('option', { value: 'DEDUCTION', text: t('payroll.deductions'), selected: component.kind === 'DEDUCTION' })
      ]);
      const statutoryField = element('input', { type: 'checkbox', checked: Boolean(component.statutoryWage) });
      const row = { nameField, amountField, kindField, statutoryField };
      rows.push(row);
      const wrapper = element('div', { className: 'form-field span-full', data: { row: String(index) } }, [
        element('div', { className: 'form-grid form-grid-actions', }, [
          element('div', { className: 'form-field' }, [element('label', { text: t('payroll.componentName') }), nameField]),
          element('div', { className: 'form-field' }, [element('label', { text: t('payroll.amount') }), amountField]),
          element('div', { className: 'form-field' }, [element('label', { text: t('payroll.kind') }), kindField]),
          element('label', { className: 'checkbox-row' }, [statutoryField, element('span', { text: t('payroll.pfWage') })]),
          element('button', { className: 'button button-danger', type: 'button', text: t('common.remove'), onclick: () => { wrapper.remove(); rows.splice(rows.indexOf(row), 1); } })
        ])
      ]);
      wrapper.__row = row;
      linesHost.append(wrapper);
    }

    (current?.components || [
      { name: 'Basic', amount: 0, kind: 'EARNING', statutoryWage: true },
      { name: 'House Rent Allowance', amount: 0, kind: 'EARNING' },
      { name: 'Provident Fund', amount: 0, kind: 'DEDUCTION' }
    ]).forEach(addRow);

    const grossField = element('input', { className: 'form-input', type: 'number', step: '1', min: '0', placeholder: '50000' });
    const effectiveField = element('input', { className: 'form-input', type: 'date', value: new Date().toISOString().slice(0, 10) });

    const autoButton = element('button', { className: 'button button-secondary', type: 'button', text: t('payroll.autoSplit'),
      onclick: () => {
        const gross = Number(grossField.value || 0);
        if (gross <= 0) { showToast(t('payroll.enterGross'), 'error'); return; }
        const basic = Math.round(gross * (template.basicPercent / 100));
        const hra = Math.round(basic * (template.hraPercent / 100));
        const da = Math.round(basic * (template.daPercent / 100));
        linesHost.replaceChildren();
        rows.length = 0;
        addRow({ name: 'Basic', amount: basic, kind: 'EARNING', statutoryWage: true });
        addRow({ name: 'House Rent Allowance', amount: hra, kind: 'EARNING' });
        if (da) addRow({ name: 'Dearness Allowance', amount: da, kind: 'EARNING' });
        addRow({ name: 'Special Allowance', amount: Math.max(0, gross - basic - hra - da), kind: 'EARNING' });
        addRow({ name: 'Provident Fund', amount: Math.round(basic * 0.12), kind: 'DEDUCTION' });
      }
    });

    const dialog = formDialog({
      wide: true,
      title: 'payroll.newStructure',
      submitLabel: 'common.save',
      fields: [
        { name: 'effectiveFrom', labelKey: 'payroll.effectiveFrom', type: 'date', required: true, value: effectiveField.value },
        { name: 'salaryType', labelKey: 'payroll.salaryType', type: 'select', options: ['MONTHLY', 'ANNUAL_CTC', 'DAILY', 'HOURLY'].map((item) => ({ value: item, label: humanize(item) })) },
        { name: 'payableDaysDivisor', labelKey: 'payroll.payableDaysDivisor', type: 'number', min: 0, max: 31, value: 0, help: 'payroll.divisorHelp' }
      ],
      extraNodes: [
        element('div', { className: 'form-section' }, [
          element('h3', { text: t('payroll.components') }),
          element('div', { className: 'form-field' }, [
            element('label', { text: t('payroll.monthlyGross') }),
            element('div', { className: 'chip-row' }, [grossField, autoButton, element('button', { className: 'button button-secondary', type: 'button', text: t('payroll.addLine'), onclick: () => addRow() })])
          ]),
          linesHost
        ])
      ],
      onSubmit: async (values) => {
        const components = linesHost.children.length
          ? Array.from(linesHost.children).map((wrapper) => ({
            name: wrapper.__row.nameField.value.trim(),
            amount: Number(wrapper.__row.amountField.value || 0),
            kind: wrapper.__row.kindField.value,
            statutoryWage: wrapper.__row.statutoryField.checked
          })).filter((line) => line.name)
          : [];
        if (!components.length) throw new Error(t('payroll.needComponent'));
        await apiRequest('payroll.saveStructure', {
          employeeId, effectiveFrom: values.effectiveFrom, salaryType: values.salaryType,
          payableDaysDivisor: values.payableDaysDivisor, components
        });
        await draw();
      }
    });
    dialog.querySelector('.dialog-body').prepend(element('div', { className: 'form-grid' }, [
      element('div', { className: 'form-field' }, [element('label', { text: t('payroll.gross') }), grossField]),
      element('div', { className: 'form-field' }, [element('label', { text: t('payroll.autoSplit') }), autoButton])
    ]));
  }

  /* ------------------------------------------------------------- Payslips */
  async function drawPayslips() {
    const data = await load('payroll.myPayslips', {});
    body.replaceChildren(
      element('div', { className: 'grid grid-3' }, [
        element('article', { className: 'stat-card' }, [element('span', { className: 'stat-label', text: t('payroll.payslipsCount') }), element('strong', { className: 'stat-value', text: String(data.total) })]),
        element('article', { className: 'stat-card' }, [element('span', { className: 'stat-label', text: t('payroll.ytdGross') }), element('strong', { className: 'stat-value', text: `₹${data.ytd.gross.toLocaleString('en-IN')}` })]),
        element('article', { className: 'stat-card accent' }, [element('span', { className: 'stat-label', text: t('payroll.ytdNet') }), element('strong', { className: 'stat-value', text: `₹${data.ytd.net.toLocaleString('en-IN')}` })])
      ]),
      element('div', { className: 'mt-1', }, [
        dataTable([
          { labelKey: 'payroll.period', render: (row) => element('strong', { text: row.period }) },
          { labelKey: 'payroll.number', render: (row) => row.documentNumber || '—' },
          { labelKey: 'payroll.gross', align: 'right', render: (row) => money(row.gross) },
          { labelKey: 'payroll.net', align: 'right', render: (row) => money(row.net) },
          { labelKey: 'payroll.releasedAt', render: (row) => dateCell(row.releasedAt) },
          {
            labelKey: 'common.actions',
            render: (row) => element('button', { className: 'button button-secondary', type: 'button', text: t('common.view'), onclick: () => showPayslip(row.id) })
          }
        ], data.items, { emptyKey: 'payroll.noPayslips' })
      ])
    );
  }

  async function showPayslip(payslipId) {
    const data = await load('payroll.payslip', { payslipId });
    const slip = data.payslip;
    const { detailDialog } = await import('./_kit.js');
    detailDialog({
      title: `${data.company.name} · ${t('payroll.payslipFor', { period: slip.period })}`,
      content: element('article', { className: 'payslip-sheet' }, [
        element('header', { className: 'payslip-header' }, [
          element('div', {}, [
            element('h2', { text: data.company.name }),
            element('p', { className: 'muted-small', text: data.company.address }),
            element('p', { className: 'muted-small', text: slip.number })
          ]),
          element('div', { className: 'money' }, [
            element('strong', { text: slip.net.toFixed(2) }),
            element('div', { className: 'muted-small', text: t('payroll.netPay') })
          ])
        ]),
        element('div', { className: 'grid grid-2' }, [
          infoBlock(t('access.employee'), [
            [t('profile.displayName'), slip.employee.displayName],
            [t('profile.employeeId'), slip.employee.employeeId],
            [t('profile.designation'), slip.employee.designation],
            [t('profile.department'), slip.employee.department],
            [t('payroll.pan'), slip.employee.panNumber],
            [t('payroll.pfUan'), slip.employee.pfUan],
            [t('payroll.bank'), slip.employee.bankName]
          ]),
          infoBlock(t('payroll.attendance'), [
            [t('payroll.paidDays'), String(slip.paidDays)],
            [t('payroll.lopDays'), String(slip.lopDays)],
            [t('payroll.releasedAt'), slip.releasedAt ? dateCell(slip.releasedAt).textContent : '—'],
            [t('payroll.gross'), slip.gross.toFixed(2)],
            [t('payroll.totalDeductions'), slip.totalDeductions.toFixed(2)]
          ])
        ]),
        element('div', { className: 'split' }, [
          element('div', {}, [element('h3', { text: t('payroll.earnings') }), lineTable(slip.earnings, t('payroll.amount'))]),
          element('div', {}, [element('h3', { text: t('payroll.deductions') }), lineTable(slip.deductions, t('payroll.amount'))])
        ]),
        slip.employerContributions.length ? element('div', {}, [
          element('h3', { text: t('payroll.employerContributions') }),
          lineTable(slip.employerContributions, t('payroll.amount'))
        ]) : null,
        data.company.footerNote ? element('p', { className: 'muted-small', text: data.company.footerNote }) : null
      ].filter(Boolean))
    });
  }

  function infoBlock(title, rows) {
    return element('div', {}, [
      element('h3', { text: title }),
      ...rows.filter(([, value]) => value).map(([label, value]) => element('div', { className: 'definition-row' }, [
        element('dt', { text: label }), element('dd', { text: value })
      ]))
    ]);
  }

  function lineTable(lines, amountLabel) {
    return element('table', { className: 'data-table' }, [
      element('thead', {}, [element('tr', {}, [element('th', { text: t('payroll.component') }), element('th', { className: 'numeric', text: amountLabel })])]),
      element('tbody', {}, lines.map((line) => element('tr', {}, [
        element('td', { text: line.name }), element('td', { className: 'numeric', text: Number(line.amount).toFixed(2) })
      ])))
    ]);
  }

  /* ------------------------------------------------------------ Statutory */
  async function drawStatutory() {
    const runs = await load('payroll.runs', {});
    const host = element('div');
    const runField = element('select', { className: 'form-input' }, runs.items.map((run) => element('option', { value: run.id, text: `${run.period} · ${humanize(run.state)}` })));
    const drawButton = button('payroll.loadReport', {
      variant: 'secondary',
      onClick: async () => {
        const report = await load('payroll.statutoryReport', { runId: runField.value });
        host.replaceChildren(
          statRow([
            { labelKey: 'payroll.pfEmployee', value: `₹${report.totals.pfEmployee.toFixed(2)}` },
            { labelKey: 'payroll.pfEmployer', value: `₹${report.totals.pfEmployer.toFixed(2)}` },
            { labelKey: 'payroll.esi', value: `₹${report.totals.esiEmployee.toFixed(2)}` },
            { labelKey: 'payroll.pt', value: `₹${report.totals.pt.toFixed(2)}` },
            { labelKey: 'payroll.tds', value: `₹${report.totals.tds.toFixed(2)}` }
          ]),
          dataTable([
            { labelKey: 'access.employee', render: (row) => row.employeeName },
            { labelKey: 'payroll.pfUan', render: (row) => row.pfUan || '—' },
            { labelKey: 'payroll.esiNumber', render: (row) => row.esiNumber || '—' },
            { labelKey: 'payroll.pfWage', align: 'right', render: (row) => row.pfWage.toFixed(2) },
            { labelKey: 'payroll.pfEmployee', align: 'right', render: (row) => row.pfEmployee.toFixed(2) },
            { labelKey: 'payroll.pfEmployer', align: 'right', render: (row) => row.pfEmployer.toFixed(2) },
            { labelKey: 'payroll.esi', align: 'right', render: (row) => row.esiEmployee.toFixed(2) },
            { labelKey: 'payroll.pt', align: 'right', render: (row) => row.pt.toFixed(2) },
            { labelKey: 'payroll.tds', align: 'right', render: (row) => row.tds.toFixed(2) }
          ], report.rows),
          element('div', { className: 'page-actions mt-1', }, [
            button('reports.exportCsv', {
              iconName: 'download',
              onClick: () => downloadText(`statutory-${report.period}.csv`, toCsv(report.rows))
            })
          ])
        );
      }
    });
    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field' }, [element('label', { text: t('payroll.period') }), runField]),
        drawButton
      ]),
      host
    );
  }
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(',')].concat(rows.map((row) => headers.map((key) => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
}

function suggestedPeriod() {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return previous.toISOString().slice(0, 7);
}
