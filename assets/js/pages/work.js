import { apiRequest } from '../api.js';
import { t, translateError } from '../i18n.js';
import {
  button, can, dataTable, dateCell, detailDialog, element, emptyState, formDialog, humanize, icon, load,
  money, pageHeader, stateBadge, statRow, tabs, showToast
} from './_kit.js';

/* ======================================================================= Documents */
export async function renderDocuments(container) {
  const state = { tab: 'register', employeeId: '' };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('documents.title', 'documents.subtitle', [], 'file'), tabHost, body);
  tabHost.append(tabs([
    { id: 'register', labelKey: 'documents.tabRegister' },
    { id: 'templates', labelKey: 'documents.tabTemplates' }
  ], async (id) => { state.tab = id; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      if (state.tab === 'register') await drawRegister();
      else await drawTemplates();
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  async function drawRegister() {
    const scope = can('document.view') ? 'all' : 'mine';
    const data = await load('documents.list', { scope, pageSize: 200, employeeId: state.employeeId || undefined });
    const categoryField = element('select', { className: 'form-input' }, [
      element('option', { value: '', text: t('common.all') }),
      ...data.categories.map((category) => element('option', { value: category, text: humanize(category) }))
    ]);
    const searchField = element('input', { className: 'form-input', type: 'search', placeholder: t('common.search') });
    let rows = data.items;
    function applyFilter() {
      const category = categoryField.value;
      const search = searchField.value.toLowerCase();
      const filtered = rows.filter((row) => (
        (!category || row.category === category) &&
        (!search || [row.employeeName, row.documentNumber, row.title].some((value) => String(value || '').toLowerCase().includes(search)))
      ));
      tableHost.replaceChildren(documentTable(filtered));
    }
    categoryField.addEventListener('change', applyFilter);
    searchField.addEventListener('input', applyFilter);
    const tableHost = element('div', { className: 'mt-1' });

    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field' }, [element('label', { text: t('money.category') }), categoryField]),
        element('div', { className: 'form-field' }, [element('label', { text: t('common.search') }), searchField]),
        data.canGenerate ? button('documents.generate', { variant: 'primary', iconName: 'plus', onClick: () => generateForm(data) }) : null
      ].filter(Boolean)),
      data.watermark ? element('div', { className: 'notice-inline warning' }, [icon('alert'), element('span', { text: t('documents.watermarkNotice', { text: data.watermark }) })]) : null,
      tableHost
    );
    tableHost.replaceChildren(documentTable(rows));
  }

  function documentTable(rows) {
    return dataTable([
      { labelKey: 'documents.number', render: (row) => element('div', {}, [
        element('strong', { text: row.documentNumber || '—' }),
        element('div', { className: 'muted-small', text: humanize(row.category) })
      ]) },
      { labelKey: 'access.employee', render: (row) => row.employeeName },
      { labelKey: 'documents.title', render: (row) => row.title || '—' },
      { labelKey: 'documents.issued', render: (row) => dateCell(row.issuedAt) },
      { labelKey: 'documents.expires', render: (row) => (row.expiresAt ? dateCell(row.expiresAt) : t('documents.noExpiry')) },
      { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
      {
        labelKey: 'common.actions',
        render: (row) => element('div', { className: 'row-actions' }, [
          element('button', { className: 'button button-secondary', type: 'button', text: t('common.view'),
            onclick: () => load('documents.detail', { documentId: row.id }).then((detail) => detailDialog({
              title: `${row.documentNumber} · ${row.employeeName}`,
              content: element('div', {}, [
                element('p', { className: 'muted-small', text: `${humanize(row.category)} · v${row.version}` }),
                element('pre', { className: 'document-body', text: detail.body || t('documents.noBody') }),
                row.templateId ? element('p', { className: 'muted-small', text: t('documents.generatedFrom', { name: (data.templates || []).find((template) => template.id === row.templateId)?.name || row.templateId }) }) : null,
                detail.document.watermark ? element('p', { className: 'muted-small', text: t('documents.watermarkNotice', { text: detail.document.watermark }) }) : null
              ].filter(Boolean))
            })).catch((error) => showToast(translateError(error), 'error'))
          }),
          row.hasFile ? element('button', { className: 'button button-secondary', type: 'button', text: t('documents.download'),
            onclick: () => load('documents.download', { documentId: row.id }).then((link) => {
              if (link.url) window.open(link.url, '_blank', 'noopener');
              else showToast(link.message || t('documents.downloadUnavailable'), 'info');
            }).catch((error) => showToast(translateError(error), 'error'))
          }) : null
        ].filter(Boolean))
      }
    ], rows, { emptyKey: 'documents.noDocuments' });
  }

  async function generateForm(data) {
    const employees = await load('employees.picker', {});
    formDialog({
      wide: true,
      title: 'documents.generate',
      intro: t('documents.generateHint'),
      fields: [
        { name: 'employeeId', labelKey: 'access.employee', type: 'select', required: true, options: employees.items.map((row) => ({ value: row.employeeId, label: `${row.displayName} (${row.employeeId})` })), value: state.employeeId },
        { name: 'category', labelKey: 'money.category', type: 'select', required: true, options: data.categories.map((category) => ({ value: category, label: humanize(category) })) },
        { name: 'templateId', labelKey: 'documents.template', type: 'select', options: (data.templates || []).map((template) => ({ value: template.id, label: template.name })), span: 'full', help: 'documents.templateHint' },
        { name: 'title', labelKey: 'documents.title' },
        { name: 'expiresAt', labelKey: 'documents.expires', type: 'date' },
        { name: 'body', labelKey: 'documents.body', type: 'textarea', span: 'full', max: 20000, help: 'documents.bodyHint' },
        { name: 'note', labelKey: 'common.notes', type: 'textarea', span: 'full' }
      ],
      onSubmit: async (values) => {
        await apiRequest('documents.generate', values);
        await draw();
      }
    });
  }

  async function drawTemplates() {
    const data = await load('documents.list', { scope: 'all', pageSize: 1 });
    body.replaceChildren(
      can('document.template.manage') ? element('div', { className: 'page-actions mb-1', }, [
        button('documents.newTemplate', { variant: 'primary', iconName: 'plus', onClick: () => templateForm(null) })
      ]) : null,
      dataTable([
        { labelKey: 'documents.template', render: (row) => element('div', {}, [
          element('strong', { text: row.name }),
          element('div', { className: 'muted-small', text: humanize(row.category) })
        ]) },
        { labelKey: 'documents.placeholders', render: (row) => (row.placeholders || []).join(', ') || '—' },
        { labelKey: 'access.colStatus', render: (row) => stateBadge(row.active ? 'ACTIVE' : 'INACTIVE') },
        can('document.template.manage') ? {
          labelKey: 'common.actions',
          render: (row) => element('button', { className: 'button button-secondary', type: 'button', text: t('common.edit'), onclick: () => templateForm(row) })
        } : { labelKey: 'common.actions', render: () => '—' }
      ], data.templates || [], { emptyKey: 'documents.noTemplates' })
    );
  }

  function templateForm(template) {
    formDialog({
      wide: true,
      title: template ? 'documents.editTemplate' : 'documents.newTemplate',
      fields: [
        { name: 'name', labelKey: 'documents.template', required: true, value: template?.name || '' },
        { name: 'category', labelKey: 'money.category', type: 'select', required: true, options: ['OFFER_LETTER', 'APPOINTMENT_LETTER', 'CONFIRMATION_LETTER', 'EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'SALARY_CERTIFICATE', 'BONAFIDE_LETTER', 'WARNING_LETTER', 'POLICY_ACKNOWLEDGEMENT', 'OTHER'].map((category) => ({ value: category, label: humanize(category) })), value: template?.category || 'OTHER' },
        { name: 'body', labelKey: 'documents.body', type: 'textarea', required: true, span: 'full', max: 20000, value: template?.body || '', help: 'documents.bodyHint' },
        { name: 'signatoryEmployeeId', labelKey: 'documents.signatory', type: 'text', value: template?.signatoryEmployeeId || '' },
        { name: 'sensitive', labelKey: 'documents.sensitive', type: 'checkbox', value: Boolean(template?.sensitive) },
        { name: 'active', labelKey: 'org.active', type: 'checkbox', value: template ? template.active !== false : true }
      ],
      onSubmit: async (values) => {
        await apiRequest('documents.saveTemplate', { ...values, id: template?.id });
        await draw();
      }
    });
  }
}

/* ===================================================================== Performance */
export async function renderPerformance(container) {
  const state = { tab: 'mine', scope: 'mine' };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('performance.title', 'performance.subtitle', [], 'target'), tabHost, body);
  tabHost.append(tabs([
    { id: 'mine', labelKey: 'performance.tabMine', scope: 'mine' },
    { id: 'team', labelKey: 'performance.tabTeam', scope: 'review' },
    { id: 'all', labelKey: 'performance.tabAll', scope: 'all' }
  ], async (id, extra) => { state.tab = id; state.scope = extra || 'mine'; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      const data = await load('performance.list', { scope: state.scope, pageSize: 200 });
      const cycleName = element('input', { className: 'form-input', placeholder: 'FY2026' });
      body.replaceChildren(
        statRow([
          { labelKey: 'performance.total', value: String(data.stats.total) },
          { labelKey: 'performance.goalsSet', value: String(data.stats.goalsSet) },
          { labelKey: 'performance.selfDone', value: String(data.stats.selfDone) },
          { labelKey: 'performance.managerDone', value: String(data.stats.managerDone) },
          { labelKey: 'performance.completed', value: String(data.stats.completed), tone: 'accent' }
        ]),
        element('div', { className: 'toolbar mt-1', }, [
          element('div', { className: 'form-field' }, [element('label', { text: 'performance.cycleName' }), cycleName]),
          can('performance.create') ? button('performance.openCycle', {
            variant: 'primary', iconName: 'plus',
            onClick: () => formDialog({
              title: 'performance.openCycle',
              fields: [
                { name: 'cycleName', labelKey: 'performance.cycleName', required: true, value: cycleName.value || '' },
                { name: 'employeeIds', labelKey: 'performance.employees', type: 'textarea', span: 'full', help: 'performance.employeeIdsHelp' }
              ],
              onSubmit: async (values) => {
                const employeeIds = String(values.employeeIds || '').split(/[,\s]+/).filter(Boolean);
                await apiRequest('performance.openCycle', { cycleName: values.cycleName, employeeIds });
                await draw();
              }
            })
          }) : null
        ].filter(Boolean)),
        dataTable([
          { labelKey: 'access.employee', render: (row) => element('div', {}, [
            element('strong', { text: row.employeeName }),
            element('div', { className: 'muted-small', text: `${row.employeeId} · ${row.department || '—'}` })
          ]) },
          { labelKey: 'performance.cycleName', render: (row) => row.cycleName },
          { labelKey: 'performance.reviewer', render: (row) => row.reviewerName || '—' },
          { labelKey: 'performance.goals', align: 'right', render: (row) => String(row.goals.length) },
          { labelKey: 'performance.selfRating', align: 'right', render: (row) => (row.selfRating ? row.selfRating.toFixed(1) : '—') },
          { labelKey: 'performance.managerRating', align: 'right', render: (row) => (row.managerRating ? row.managerRating.toFixed(1) : '—') },
          { labelKey: 'performance.finalRating', align: 'right', render: (row) => (row.finalRating ? row.finalRating.toFixed(2) : '—') },
          { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
          {
            labelKey: 'common.actions',
            render: (row) => element('button', { className: 'button button-secondary', type: 'button', text: t('common.open'), onclick: () => openReview(row.id) })
          }
        ], data.items, { emptyKey: 'performance.noReviews' })
      );
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  async function openReview(id) {
    const data = await load('performance.detail', { id });
    const review = data.review;
    detailDialog({
      title: `${review.employeeName} · ${review.cycleName}`,
      content: element('div', {}, [
        stateBadge(review.state),
        element('h3', { text: t('performance.goals') }),
        dataTable([
          { labelKey: 'performance.goal', render: (row) => element('div', {}, [element('strong', { text: row.title }), element('div', { className: 'muted-small', text: row.description })]) },
          { labelKey: 'performance.weight', align: 'right', render: (row) => `${row.weight}%` },
          { labelKey: 'performance.target', render: (row) => row.target || '—' },
          { labelKey: 'performance.achievement', render: (row) => row.achievement || '—' },
          { labelKey: 'performance.selfRating', align: 'right', render: (row) => (row.selfRating ? row.selfRating.toFixed(1) : '—') },
          { labelKey: 'performance.managerRating', align: 'right', render: (row) => (row.managerRating ? row.managerRating.toFixed(1) : '—') }
        ], review.goals, { emptyKey: 'performance.noGoals' }),
        element('div', { className: 'page-actions mt-1', }, [
          (data.isOwner || data.canReview) ? button('performance.goals', { onClick: () => goalsForm(review, data.scale) }) : null,
          data.isOwner ? button('performance.selfReview', { variant: 'primary', onClick: () => selfForm(review, data.scale) }) : null,
          data.canReview ? button('performance.managerReview', { variant: 'primary', onClick: () => managerForm(review, data.scale) }) : null
        ].filter(Boolean))
      ])
    });
  }

  function goalsForm(review, scale) {
    const host = element('div');
    const goals = review.goals.length ? review.goals.map((goal) => ({ ...goal })) : [{ title: '', weight: 100, target: '', description: '' }];
    function render() {
      host.replaceChildren(...goals.map((goal, index) => element('div', { className: 'form-section' }, [
        element('div', { className: 'form-grid' }, [
          fieldInput('performance.goal', goal.title, (value) => { goal.title = value; }),
          fieldInput('performance.weight', goal.weight, (value) => { goal.weight = Number(value); }, 'number'),
          fieldInput('performance.target', goal.target, (value) => { goal.target = value; })
        ]),
        element('button', { className: 'text-button', type: 'button', text: t('common.remove'),
          onclick: () => { goals.splice(index, 1); render(); }
        })
      ])));
      host.append(element('button', { className: 'button button-secondary', type: 'button', text: t('performance.addGoal'),
        onclick: () => { goals.push({ title: '', weight: 0, target: '', description: '' }); render(); }
      }));
    }
    render();
    const save = element('button', { className: 'button button-primary', type: 'button', text: t('common.save') });
    save.addEventListener('click', async () => {
      try {
        await apiRequest('performance.saveGoals', { id: review.id, goals });
        showToast(t('common.saved'), 'success');
        await draw();
      } catch (error) { showToast(translateError(error), 'error'); }
    });
    detailDialog({ title: t('performance.goals'), content: element('div', {}, [host, element('div', { className: 'page-actions mt-1', }, [save])]) });
  }

  function selfForm(review, scale) {
    formDialog({
      title: 'performance.selfReview',
      fields: [
        { name: 'rating', labelKey: 'performance.overallRating', type: 'number', min: 1, max: scale, step: '0.5', required: true },
        { name: 'strengths', labelKey: 'performance.strengths', type: 'textarea', span: 'full' },
        { name: 'improvements', labelKey: 'performance.improvements', type: 'textarea', span: 'full' },
        { name: 'achievements', labelKey: 'performance.achievements', type: 'textarea', span: 'full' }
      ],
      onSubmit: async (values) => { await apiRequest('performance.selfReview', { id: review.id, ...values }); await draw(); }
    });
  }

  function managerForm(review, scale) {
    formDialog({
      wide: true,
      title: 'performance.managerReview',
      fields: [
        { name: 'rating', labelKey: 'performance.overallRating', type: 'number', min: 1, max: scale, step: '0.5', required: true },
        { name: 'recommendedForPromotion', labelKey: 'performance.promotion', type: 'checkbox' },
        { name: 'complete', labelKey: 'performance.markComplete', type: 'checkbox', value: true },
        { name: 'strengths', labelKey: 'performance.strengths', type: 'textarea', span: 'full' },
        { name: 'improvements', labelKey: 'performance.improvements', type: 'textarea', span: 'full' },
        { name: 'comments', labelKey: 'performance.comments', type: 'textarea', span: 'full' }
      ],
      onSubmit: async (values) => { await apiRequest('performance.managerReview', { id: review.id, ...values }); await draw(); }
    });
  }
}

/* ============================================================================ Exit */
export async function renderExit(container) {
  const state = { scope: 'all' };
  const body = element('div');
  container.replaceChildren(pageHeader('exit.title', 'exit.subtitle', [
    button('exit.submit', {
      variant: 'primary', iconName: 'logout',
      onClick: () => load('employees.picker', {}).then((employees) => formDialog({
        title: 'exit.submit',
        fields: [
          { name: 'employeeId', labelKey: 'access.employee', type: 'select', options: employees.items.map((row) => ({ value: row.employeeId, label: `${row.displayName} (${row.employeeId})` })) },
          { name: 'exitType', labelKey: 'exit.type', type: 'select', options: ['RESIGNATION', 'TERMINATION', 'RETIREMENT', 'ABSCONDING', 'END_OF_CONTRACT'].map((item) => ({ value: item, label: humanize(item) })) },
          { name: 'resignationDate', labelKey: 'exit.resignationDate', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
          { name: 'lastWorkingDate', labelKey: 'exit.lastWorkingDate', type: 'date' },
          { name: 'noticeDays', labelKey: 'exit.noticeDays', type: 'number', min: 0, max: 365 },
          { name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full', min: 10 }
        ],
        onSubmit: async (values) => { await apiRequest('exit.submit', values); await draw(); }
      }))
    })
  ], 'logout'), body);
  await draw();

  async function draw() {
    const data = await load('exit.list', { scope: can('exit.view') ? 'all' : 'mine', pageSize: 200 });
    body.replaceChildren(
      statRow([
        { labelKey: 'exit.pending', value: String(data.stats.pending) },
        { labelKey: 'exit.approved', value: String(data.stats.approved) },
        { labelKey: 'exit.clearancePending', value: String(data.stats.clearancePending), tone: 'warning' },
        { labelKey: 'exit.completed', value: String(data.stats.completed) }
      ]),
      element('div', { className: 'mt-1', }, [
        dataTable([
          { labelKey: 'access.employee', render: (row) => element('div', {}, [element('strong', { text: row.employeeName }), element('div', { className: 'muted-small', text: `${row.employeeId} · ${row.department || '—'}` })]) },
          { labelKey: 'exit.type', render: (row) => humanize(row.exitType) },
          { labelKey: 'exit.resignationDate', render: (row) => dateCell(row.resignationDate) },
          { labelKey: 'exit.lastWorkingDate', render: (row) => dateCell(row.lastWorkingDate) },
          { labelKey: 'exit.clearance', render: (row) => `${(row.clearance || []).filter((item) => item.cleared).length}/${(row.clearance || []).length}` },
          { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
          {
            labelKey: 'common.actions',
            render: (row) => element('div', { className: 'row-actions' }, [
              element('button', { className: 'button button-secondary', type: 'button', text: t('exit.clearance'), onclick: () => clearanceDialog(row) }),
              can('exit.approve') ? element('button', { className: 'button button-secondary', type: 'button', text: t('exit.settlement'), onclick: () => settlementDialog(row) }) : null,
              can('exit.edit') && ['APPROVED', 'CLEARANCE'].includes(row.state) ? element('button', { className: 'button button-primary', type: 'button', text: t('exit.complete'),
                onclick: () => apiRequest('exit.complete', { exitId: row.id })
                  .then(() => { showToast(t('exit.completedToast'), 'success'); return draw(); })
                  .catch((error) => showToast(translateError(error), 'error'))
              }) : null
            ].filter(Boolean))
          }
        ], data.items, { emptyKey: 'exit.noRecords' })
      ])
    );
  }

  function clearanceDialog(row) {
    const items = (row.clearance || []).map((item) => ({ ...item }));
    const host = element('div');
    function render() {
      host.replaceChildren(...items.map((item) => {
        const checkbox = element('input', { type: 'checkbox', checked: item.cleared });
        checkbox.addEventListener('change', async () => {
          try {
            await apiRequest('exit.updateClearance', { exitId: row.id, key: item.key, cleared: checkbox.checked, note: item.note || '' });
            item.cleared = checkbox.checked;
            draw();
          } catch (error) { showToast(translateError(error), 'error'); }
        });
        return element('div', { className: 'checkbox-row mv-sm', }, [
          checkbox,
          element('label', {}, [
            element('strong', { text: item.label }),
            item.clearedBy ? element('div', { className: 'muted-small', text: `${item.clearedBy} · ${formatDate(item.clearedAt)}` }) : null
          ].filter(Boolean))
        ]);
      }));
    }
    render();
    detailDialog({ title: `${t('exit.clearance')} · ${row.employeeName}`, content: host });
  }

  async function settlementDialog(row) {
    try {
      const data = await apiRequest('exit.settlement', { exitId: row.id });
      detailDialog({
        title: `${t('exit.settlement')} · ${row.employeeName}`,
        content: element('div', {}, [
          dataTable([
            { labelKey: 'exit.line', render: (line) => line.name },
            { labelKey: 'payroll.amount', align: 'right', render: (line) => money(line.amount) }
          ], [...data.earnings.map((line) => ({ ...line, kind: 'E' })), ...data.deductions.map((line) => ({ ...line, kind: 'D' }))]),
          element('p', { className: 'money', text: `${t('exit.netSettlement')}: ₹${data.netSettlement.toFixed(2)}` }),
          element('p', { className: 'muted-small', text: data.disclaimer })
        ])
      });
    } catch (error) {
      showToast(translateError(error), 'error');
    }
  }
}

/* ========================================================================== Assets */
export async function renderAssets(container) {
  const body = element('div');
  container.replaceChildren(pageHeader('assets.title', 'assets.subtitle', [
    can('asset.manage') ? button('assets.add', { variant: 'primary', iconName: 'plus', onClick: () => assetForm() }) : null
  ].filter(Boolean), 'box'), body);
  await draw();

  async function draw() {
    const data = await load('assets.list', { pageSize: 300 });
    body.replaceChildren(
      statRow([
        { labelKey: 'assets.total', value: String(data.stats?.total || 0) },
        { labelKey: 'assets.assigned', value: String(data.stats?.assigned || 0) },
        { labelKey: 'assets.available', value: String(data.stats?.available || 0), tone: 'accent' },
        { labelKey: 'assets.value', value: `₹${Number(data.stats?.value || 0).toLocaleString('en-IN')}` }
      ]),
      element('div', { className: 'mt-1', }, [
        dataTable([
          { labelKey: 'assets.code', render: (row) => element('div', {}, [element('strong', { text: row.code }), element('div', { className: 'muted-small', text: row.serialNumber || '—' })]) },
          { labelKey: 'assets.name', render: (row) => row.name },
          { labelKey: 'assets.category', render: (row) => humanize(row.category) },
          { labelKey: 'assets.assignedTo', render: (row) => (row.assignedEmployeeName || row.assignedEmployeeId ? `${row.assignedEmployeeName || row.assignedEmployeeId}` : t('assets.unassigned')) },
          { labelKey: 'assets.purchaseValue', align: 'right', render: (row) => money(row.purchaseValue) },
          { labelKey: 'assets.condition', render: (row) => humanize(row.condition || 'GOOD') },
          { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
          {
            labelKey: 'common.actions',
            render: (row) => element('div', { className: 'row-actions' }, [
              can('asset.manage') && !row.assignedEmployeeId ? element('button', { className: 'button button-secondary', type: 'button', text: t('assets.assign'),
                onclick: () => load('employees.picker', {}).then((employees) => formDialog({
                  title: 'assets.assign',
                  fields: [{ name: 'employeeId', labelKey: 'access.employee', type: 'select', required: true, options: employees.items.map((item) => ({ value: item.employeeId, label: item.displayName })) }],
                  submitLabel: 'assets.assign',
                  onSubmit: async (values) => { await apiRequest('assets.assign', { assetId: row.id, ...values }); await draw(); }
                }))
              }) : null,
              can('asset.manage') && row.assignedEmployeeId ? element('button', { className: 'button button-secondary', type: 'button', text: t('assets.return'),
                onclick: () => formDialog({
                  title: 'assets.return',
                  fields: [
                    { name: 'condition', labelKey: 'assets.condition', type: 'select', options: ['GOOD', 'DAMAGED', 'LOST'].map((item) => ({ value: item, label: humanize(item) })) },
                    { name: 'note', labelKey: 'common.notes', type: 'textarea', span: 'full' }
                  ],
                  submitLabel: 'assets.return',
                  onSubmit: async (values) => { await apiRequest('assets.return', { assetId: row.id, ...values }); await draw(); }
                })
              }) : null
            ].filter(Boolean))
          }
        ], data.items || [], { emptyKey: 'assets.noAssets' })
      ])
    );
  }

  function assetForm() {
    formDialog({
      title: 'assets.add',
      fields: [
        { name: 'code', labelKey: 'assets.code', required: true },
        { name: 'name', labelKey: 'assets.name', required: true },
        { name: 'category', labelKey: 'assets.category', type: 'select', options: ['LAPTOP', 'MOBILE', 'FURNITURE', 'VEHICLE', 'ACCESS_CARD', 'OTHER'].map((item) => ({ value: item, label: humanize(item) })) },
        { name: 'serialNumber', labelKey: 'assets.serial' },
        { name: 'purchaseDate', labelKey: 'assets.purchaseDate', type: 'date' },
        { name: 'purchaseValue', labelKey: 'assets.purchaseValue', type: 'number', min: 0, step: '0.01' },
        { name: 'notes', labelKey: 'common.notes', type: 'textarea', span: 'full' }
      ],
      onSubmit: async (values) => { await apiRequest('assets.save', values); await draw(); }
    });
  }
}

/* ================================================================= Announcements */
export async function renderAnnouncements(container) {
  const body = element('div');
  container.replaceChildren(pageHeader('announcements.title', 'announcements.subtitle', [
    can('announcement.manage') ? button('announcements.new', {
      variant: 'primary', iconName: 'plus',
      onClick: () => formDialog({
        title: 'announcements.new',
        fields: [
          { name: 'title', labelKey: 'announcements.headline', required: true },
          { name: 'body', labelKey: 'announcements.body', type: 'textarea', required: true, span: 'full', max: 8000 },
          { name: 'expiresAt', labelKey: 'documents.expires', type: 'date' },
          { name: 'pinned', labelKey: 'announcements.pinned', type: 'checkbox' }
        ],
        onSubmit: async (values) => {
          await apiRequest('announcements.save', {
            ...values,
            expiresAt: values.expiresAt ? new Date(`${values.expiresAt}T23:59:59`).toISOString() : ''
          });
          await draw();
        }
      })
    }) : null
  ].filter(Boolean), 'megaphone'), body);
  await draw();

  async function draw() {
    const data = await load('announcements.list', { pageSize: 200 });
    body.replaceChildren(
      data.items.length ? element('div', { className: 'grid grid-2' }, data.items.map((item) => element('article', { className: 'card pad-1-5', }, [
        element('div', { className: 'card-heading' }, [
          element('h2', { text: item.title }),
          item.pinned ? stateBadge('PENDING', 'announcements.pinned') : null
        ].filter(Boolean)),
        element('p', { text: item.body }),
        element('p', { className: 'muted-small', text: `${formatDate(item.publishedAt)}${item.expiresAt ? ' · ' + t('documents.expires') + ': ' + formatDate(item.expiresAt) : ''}` }),
        can('announcement.manage') ? element('div', { className: 'card-actions' }, [
          button('common.delete', {
            variant: 'danger',
            onClick: () => apiRequest('announcements.remove', { id: item.id }).then(draw).catch((error) => showToast(translateError(error), 'error'))
          })
        ]) : null
      ].filter(Boolean)))) : emptyState(t('announcements.empty'), t('announcements.emptyHint'), 'megaphone')
    );
  }
}

function fieldInput(labelKey, value, onChange, type = 'text') {
  const input = element('input', { className: 'form-input', type, value: value ?? '' });
  input.addEventListener('input', () => onChange(input.value));
  return element('div', { className: 'form-field' }, [element('label', { text: t(labelKey) }), input]);
}
