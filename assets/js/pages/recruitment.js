import { apiRequest } from '../api.js';
import { t, translateError } from '../i18n.js';
import {
  button, can, dataTable, dateCell, detailDialog, element, emptyState, formDialog, humanize, icon, load,
  money, pageHeader, stateBadge, statRow, tabs, showToast
} from './_kit.js';

export async function renderRecruitment(container) {
  const state = { tab: 'openings', openingId: '' };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('recruitment.title', 'recruitment.subtitle', [], 'users'), tabHost, body);
  tabHost.append(tabs([
    { id: 'openings', labelKey: 'recruitment.tabOpenings' },
    { id: 'pipeline', labelKey: 'recruitment.tabPipeline' }
  ], async (id) => { state.tab = id; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      if (state.tab === 'openings') await drawOpenings();
      else await drawPipeline();
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  async function drawOpenings() {
    const data = await load('recruitment.list', { pageSize: 200 });
    body.replaceChildren(
      statRow([
        { labelKey: 'recruitment.openPositions', value: String(data.stats.openPositions) },
        { labelKey: 'recruitment.headcount', value: String(data.stats.totalHeadcount) },
        { labelKey: 'recruitment.candidates', value: String(data.stats.candidates) },
        { labelKey: 'recruitment.hired', value: String(data.stats.hired), tone: 'accent' }
      ]),
      element('div', { className: 'page-actions mv-1', }, [
        can('recruitment.create') ? button('recruitment.newOpening', { variant: 'primary', iconName: 'plus', onClick: () => openingForm(null, data) }) : null
      ].filter(Boolean)),
      dataTable([
        { labelKey: 'recruitment.code', render: (row) => row.code },
        { labelKey: 'recruitment.title', render: (row) => element('div', {}, [
          element('strong', { text: row.title }),
          element('div', { className: 'muted-small', text: `${row.department || '—'} · ${row.designation || '—'}` })
        ]) },
        { labelKey: 'recruitment.headcount', align: 'right', render: (row) => String(row.headcount) },
        { labelKey: 'recruitment.experience', render: (row) => `${row.experienceMin}–${row.experienceMax} ${t('recruitment.years')}` },
        { labelKey: 'recruitment.ctcRange', render: (row) => (row.salaryMin || row.salaryMax ? `₹${row.salaryMin.toLocaleString('en-IN')} – ₹${row.salaryMax.toLocaleString('en-IN')}` : '—') },
        { labelKey: 'recruitment.priority', render: (row) => stateBadge(row.priority === 'URGENT' ? 'FAILED' : row.priority === 'HIGH' ? 'PENDING' : 'ACTIVE', `recruitment.priority${humanize(row.priority)}`) },
        { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
        { labelKey: 'recruitment.candidates', align: 'right', render: (row) => String(row.candidateCount) },
        {
          labelKey: 'common.actions',
          render: (row) => element('div', { className: 'row-actions' }, [
            element('button', { className: 'button button-secondary', type: 'button', text: t('common.open'), onclick: () => { state.openingId = row.id; state.tab = 'pipeline'; draw(); } }),
            can('recruitment.edit') ? element('button', { className: 'button button-secondary', type: 'button', text: t('common.edit'), onclick: () => openingForm(row, data) }) : null
          ].filter(Boolean))
        }
      ], data.openings, { emptyKey: 'recruitment.noOpenings' })
    );
  }

  async function openingForm(opening, data) {
    const [departments, designations, branches, employees] = await Promise.all([
      load('org.list', { entity: 'departments', pageSize: 200 }),
      load('org.list', { entity: 'designations', pageSize: 200 }),
      load('org.list', { entity: 'branches', pageSize: 200 }),
      load('employees.picker', {})
    ]);
    formDialog({
      wide: true,
      title: opening ? 'recruitment.editOpening' : 'recruitment.newOpening',
      fields: [
        { name: 'code', labelKey: 'recruitment.code', value: opening?.code || '' },
        { name: 'title', labelKey: 'recruitment.title', required: true, value: opening?.title || '' },
        { name: 'departmentId', labelKey: 'employees.department', type: 'select', options: departments.items.map((row) => ({ value: row.id, label: row.name })), value: opening?.departmentId || '' },
        { name: 'designationId', labelKey: 'employees.designation', type: 'select', options: designations.items.map((row) => ({ value: row.id, label: row.name })), value: opening?.designationId || '' },
        { name: 'branchId', labelKey: 'employees.branch', type: 'select', options: branches.items.map((row) => ({ value: row.id, label: row.name })), value: opening?.branchId || '' },
        { name: 'hiringManagerId', labelKey: 'recruitment.hiringManager', type: 'select', options: employees.items.map((row) => ({ value: row.employeeId, label: row.displayName })), value: opening?.hiringManagerId || '' },
        { name: 'headcount', labelKey: 'recruitment.headcount', type: 'number', min: 1, max: 200, value: opening?.headcount || 1 },
        { name: 'employmentType', labelKey: 'employees.employmentType', type: 'select', options: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((item) => ({ value: item, label: humanize(item) })), value: opening?.employmentType || 'FULL_TIME' },
        { name: 'experienceMin', labelKey: 'recruitment.experienceMin', type: 'number', min: 0, value: opening?.experienceMin || 0 },
        { name: 'experienceMax', labelKey: 'recruitment.experienceMax', type: 'number', min: 0, value: opening?.experienceMax || 0 },
        { name: 'salaryMin', labelKey: 'recruitment.salaryMin', type: 'number', min: 0, value: opening?.salaryMin || 0 },
        { name: 'salaryMax', labelKey: 'recruitment.salaryMax', type: 'number', min: 0, value: opening?.salaryMax || 0 },
        { name: 'openingDate', labelKey: 'recruitment.openingDate', type: 'date', value: opening?.openingDate || new Date().toISOString().slice(0, 10) },
        { name: 'closingDate', labelKey: 'recruitment.closingDate', type: 'date', value: opening?.closingDate || '' },
        { name: 'priority', labelKey: 'recruitment.priority', type: 'select', options: ['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((item) => ({ value: item, label: humanize(item) })), value: opening?.priority || 'NORMAL' },
        { name: 'state', labelKey: 'attendance.state', type: 'select', options: ['OPEN', 'ON_HOLD', 'CLOSED', 'CANCELLED'].map((item) => ({ value: item, label: humanize(item) })), value: opening?.state || 'OPEN' },
        { name: 'description', labelKey: 'common.description', type: 'textarea', value: opening?.description || '', span: 'full' },
        { name: 'requirements', labelKey: 'recruitment.requirements', type: 'textarea', value: opening?.requirements || '', span: 'full' }
      ],
      onSubmit: async (values) => {
        await apiRequest('recruitment.saveOpening', { ...values, id: opening?.id });
        await draw();
      }
    });
  }

  async function drawPipeline() {
    const data = await load('recruitment.list', { pageSize: 300, openingId: state.openingId || undefined });
    const openingField = element('select', { className: 'form-input' }, [
      element('option', { value: '', text: t('recruitment.allOpenings') }),
      ...data.openings.map((opening) => element('option', { value: opening.id, text: `${opening.code} · ${opening.title}`, selected: opening.id === state.openingId }))
    ]);
    openingField.addEventListener('change', () => { state.openingId = openingField.value; draw(); });

    const byStage = {};
    data.stages.forEach((stage) => { byStage[stage] = []; });
    data.candidates.forEach((candidate) => {
      byStage[candidate.stage] = byStage[candidate.stage] || [];
      byStage[candidate.stage].push(candidate);
    });

    const board = element('div', { className: 'kanban' }, Object.entries(byStage).map(([stage, candidates]) => element('section', { className: 'kanban-column' }, [
      element('h3', {}, [element('span', { text: stage }), element('span', { className: 'badge badge-neutral', text: String(candidates.length) })]),
      ...candidates.map((candidate) => element('article', { className: 'kanban-card' }, [
        element('strong', { text: candidate.name }),
        element('span', { className: 'muted-small', text: candidate.openingTitle }),
        element('span', { className: 'muted-small', text: `${candidate.experienceYears} ${t('recruitment.years')} · ${candidate.source || '—'}` }),
        element('div', { className: 'row-actions' }, [
          detailButton(candidate),
          can('recruitment.edit') ? element('button', { className: 'text-button', type: 'button', text: t('recruitment.move'), onclick: () => moveForm(candidate, data) }) : null
        ].filter(Boolean))
      ]))
    ])));

    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field' }, [element('label', { text: t('recruitment.opening') }), openingField]),
        can('recruitment.create') ? button('recruitment.addCandidate', {
          variant: 'primary', iconName: 'plus',
          onClick: () => candidateForm(null, data)
        }) : null
      ].filter(Boolean)),
      board
    );
  }

  function detailButton(candidate) {
    return element('button', { className: 'text-button mt-1', type: 'button', text: t('common.view'),
      onclick: () => detailDialog({
        title: `${candidate.name} · ${candidate.stage}`,
        content: element('div', {}, [
          element('div', { className: 'definition-row' }, [element('dt', { text: t('recruitment.email') }), element('dd', { text: candidate.email })]),
          element('div', { className: 'definition-row' }, [element('dt', { text: t('recruitment.phone') }), element('dd', { text: candidate.phone })]),
          element('div', { className: 'definition-row' }, [element('dt', { text: t('recruitment.currentCompany') }), element('dd', { text: candidate.currentCompany || '—' })]),
          element('div', { className: 'definition-row' }, [element('dt', { text: t('recruitment.expectedCtc') }), element('dd', { text: `₹${candidate.expectedCtc.toLocaleString('en-IN')}` })]),
          candidate.notes ? element('p', { text: candidate.notes }) : null,
          element('h3', { text: t('recruitment.interviews') }),
          candidate.interviews.length
            ? element('ul', { className: 'timeline' }, candidate.interviews.map((item) => element('li', {}, [
              element('strong', { text: item.round || 'Interview' }),
              element('div', { text: `${item.scheduledAt || ''} · ${item.mode || ''}` }),
              item.notes ? element('div', { className: 'muted-small', text: item.notes }) : null
            ].filter(Boolean))))
            : element('p', { className: 'muted-small', text: t('recruitment.noInterviews') }),
          element('div', { className: 'page-actions', }, [
            can('recruitment.edit') ? button('recruitment.scheduleInterview', {
              onClick: () => formDialog({
                title: 'recruitment.scheduleInterview',
                fields: [
                  { name: 'round', labelKey: 'recruitment.round', required: true },
                  { name: 'scheduledAt', labelKey: 'recruitment.scheduledAt', type: 'datetime-local', required: true },
                  { name: 'mode', labelKey: 'recruitment.mode', type: 'select', options: ['ONLINE', 'IN_PERSON', 'PHONE'].map((item) => ({ value: item, label: humanize(item) })) },
                  { name: 'location', labelKey: 'recruitment.location' },
                  { name: 'notes', labelKey: 'common.notes', type: 'textarea', span: 'full' }
                ],
                onSubmit: async (values) => {
                  await apiRequest('recruitment.scheduleInterview', {
                    candidateId: candidate.id,
                    ...values,
                    scheduledAt: new Date(values.scheduledAt).toISOString()
                  });
                  await draw();
                }
              })
            }) : null,
            can('recruitment.approve') ? button('recruitment.releaseOffer', {
              variant: 'primary',
              onClick: () => formDialog({
                title: 'recruitment.releaseOffer',
                fields: [
                  { name: 'ctc', labelKey: 'recruitment.ctc', type: 'number', min: 1, required: true, value: candidate.expectedCtc || '' },
                  { name: 'joiningDate', labelKey: 'employees.joiningDate', type: 'date', required: true },
                  { name: 'probationMonths', labelKey: 'recruitment.probationMonths', type: 'number', min: 0, max: 24, value: 3 },
                  { name: 'notes', labelKey: 'common.notes', type: 'textarea', span: 'full' }
                ],
                onSubmit: async (values) => { await apiRequest('recruitment.releaseOffer', { candidateId: candidate.id, ...values }); await draw(); }
              })
            }) : null,
            can('recruitment.edit') && candidate.stage === 'Offer' ? button('recruitment.convert', {
              variant: 'secondary',
              onClick: () => formDialog({
                title: 'recruitment.convert',
                fields: [
                  { name: 'employeeId', labelKey: 'employees.colId', help: 'recruitment.autoId' },
                  { name: 'displayName', labelKey: 'employees.fullName', required: true, value: candidate.name },
                  { name: 'workEmail', labelKey: 'employees.workEmail', type: 'email', value: candidate.email }
                ],
                onSubmit: async (values) => { await apiRequest('recruitment.convert', { candidateId: candidate.id, ...values }); await draw(); }
              })
            }) : null
          ].filter(Boolean))
        ].filter(Boolean))
      })
    });
  }

  function moveForm(candidate, data) {
    formDialog({
      title: 'recruitment.move',
      fields: [
        { name: 'stage', labelKey: 'recruitment.stage', type: 'select', required: true, options: data.stages.map((stage) => ({ value: stage, label: stage })), value: candidate.stage },
        { name: 'notes', labelKey: 'common.notes', type: 'textarea', span: 'full' }
      ],
      submitLabel: 'recruitment.move',
      onSubmit: async (values) => { await apiRequest('recruitment.moveStage', { candidateId: candidate.id, stage: values.stage }); await draw(); }
    });
  }

  function candidateForm(_candidate, data) {
    formDialog({
      wide: true,
      title: 'recruitment.addCandidate',
      fields: [
        { name: 'openingId', labelKey: 'recruitment.opening', type: 'select', required: true, options: data.openings.map((opening) => ({ value: opening.id, label: `${opening.code} · ${opening.title}` })), value: state.openingId },
        { name: 'name', labelKey: 'employees.fullName', required: true },
        { name: 'email', labelKey: 'recruitment.email', type: 'email', required: true },
        { name: 'phone', labelKey: 'recruitment.phone', required: true },
        { name: 'stage', labelKey: 'recruitment.stage', type: 'select', options: data.stages.map((stage) => ({ value: stage, label: stage })) },
        { name: 'source', labelKey: 'recruitment.source', type: 'select', options: (data.sources || []).map((source) => ({ value: source, label: source })) },
        { name: 'experienceYears', labelKey: 'recruitment.experience', type: 'number', min: 0, value: 0 },
        { name: 'currentCompany', labelKey: 'recruitment.currentCompany' },
        { name: 'currentCtc', labelKey: 'recruitment.currentCtc', type: 'number', min: 0, value: 0 },
        { name: 'expectedCtc', labelKey: 'recruitment.expectedCtc', type: 'number', min: 0, value: 0 },
        { name: 'noticePeriod', labelKey: 'recruitment.noticePeriod', type: 'number', min: 0, value: 30 },
        { name: 'notes', labelKey: 'common.notes', type: 'textarea', span: 'full' }
      ],
      onSubmit: async (values) => { await apiRequest('recruitment.saveCandidate', values); await draw(); }
    });
  }
}
