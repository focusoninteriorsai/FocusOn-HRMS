import { apiRequest } from '../api.js';
import { t } from '../i18n.js';
import {
  button, can, confirmDialog, dataTable, element, formatDate, formDialog, humanize, load, pageHeader,
  stateBadge, tabs
} from './_kit.js';

const ENTITIES = [
  { id: 'departments', labelKey: 'org.departments' },
  { id: 'designations', labelKey: 'org.designations' },
  { id: 'branches', labelKey: 'org.branches' },
  { id: 'sites', labelKey: 'org.sites' },
  { id: 'holidays', labelKey: 'org.holidays' }
];

export async function renderOrganization(container) {
  let entity = 'departments';
  let cache = null;
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(
    pageHeader('org.title', 'org.subtitle', [
      can('org.create') ? button('org.add', { variant: 'primary', iconName: 'plus', onClick: () => openForm() }) : null
    ].filter(Boolean), 'building'),
    tabHost,
    body
  );
  tabHost.append(tabs(ENTITIES, async (id) => { entity = id; await draw(); }));
  await draw();

  async function draw() {
    cache = await load('org.list', { entity, pageSize: 300 });
    const rows = cache.items;
    body.replaceChildren(
      entity === 'holidays' ? holidayTable(rows) : entity === 'sites' ? siteTable(rows) : entity === 'branches' ? branchTable(rows) : entity === 'designations' ? designationTable(rows) : departmentTable(rows),
      element('p', { className: 'muted-small', text: t('org.totalRecords', { total: cache.total }) })
    );
  }

  function actions(row) {
    return element('div', { className: 'row-actions' }, [
      can('org.edit') ? element('button', { className: 'button button-secondary', type: 'button', text: t('common.edit'), onclick: () => openForm(row) }) : null,
      can('org.delete') ? element('button', { className: 'button button-danger', type: 'button', text: t('common.delete'),
        onclick: () => confirmDialog({
          titleKey: 'org.deleteRecord', message: t('org.deleteConfirm', { name: row.name }),
          onConfirm: async () => { await apiRequest('org.remove', { entity, id: row.id }); await draw(); }
        })
      }) : null
    ].filter(Boolean));
  }

  function departmentTable(rows) {
    return dataTable([
      { labelKey: 'org.code', render: (row) => row.code },
      { labelKey: 'org.name', render: (row) => element('strong', { text: row.name }) },
      { labelKey: 'org.head', render: (row) => row.headName || '—' },
      { labelKey: 'org.branch', render: (row) => row.branchName || t('org.allBranches') },
      { labelKey: 'org.headcount', align: 'right', render: (row) => String(row.headcount) },
      { labelKey: 'access.colStatus', render: (row) => stateBadge(row.active ? 'ACTIVE' : 'INACTIVE') },
      { labelKey: 'common.actions', render: actions }
    ], rows);
  }

  function designationTable(rows) {
    return dataTable([
      { labelKey: 'org.code', render: (row) => row.code },
      { labelKey: 'org.name', render: (row) => element('strong', { text: row.name }) },
      { labelKey: 'org.level', align: 'right', render: (row) => String(row.level) },
      { labelKey: 'common.description', render: (row) => row.description || '—' },
      { labelKey: 'access.colStatus', render: (row) => stateBadge(row.active ? 'ACTIVE' : 'INACTIVE') },
      { labelKey: 'common.actions', render: actions }
    ], rows);
  }

  function branchTable(rows) {
    return dataTable([
      { labelKey: 'org.code', render: (row) => row.code },
      { labelKey: 'org.name', render: (row) => element('strong', { text: row.name }) },
      { labelKey: 'org.city', render: (row) => row.city || '—' },
      { labelKey: 'org.state', render: (row) => row.state || '—' },
      { labelKey: 'org.timezone', render: (row) => row.timezone },
      { labelKey: 'org.headcount', align: 'right', render: (row) => String(row.headcount) },
      { labelKey: 'common.actions', render: actions }
    ], rows);
  }

  function siteTable(rows) {
    return dataTable([
      { labelKey: 'org.code', render: (row) => row.code },
      { labelKey: 'org.name', render: (row) => element('strong', { text: row.name }) },
      { labelKey: 'org.branch', render: (row) => row.branchName || '—' },
      { labelKey: 'org.client', render: (row) => row.clientName || '—' },
      { labelKey: 'org.geofence', render: (row) => (row.latitude === null ? '—' : `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)} · ${row.radiusMeters || 0} m`) },
      { labelKey: 'access.colStatus', render: (row) => stateBadge(row.active ? 'ACTIVE' : 'INACTIVE') },
      { labelKey: 'common.actions', render: actions }
    ], rows);
  }

  function holidayTable(rows) {
    return dataTable([
      { labelKey: 'org.holidayDate', render: (row) => formatDate(row.holidayDate, { dateStyle: 'long' }) },
      { labelKey: 'org.name', render: (row) => element('strong', { text: row.name }) },
      { labelKey: 'org.holidayType', render: (row) => stateBadge(row.holidayType) },
      { labelKey: 'org.branch', render: (row) => row.branchName },
      { labelKey: 'common.description', render: (row) => row.description || '—' },
      { labelKey: 'common.actions', render: actions }
    ], rows);
  }

  function openForm(row) {
    const labelKey = `org.${entity}`;
    const common = [
      { name: 'name', labelKey: 'org.name', required: true, value: row?.name || '' },
      { name: 'code', labelKey: 'org.code', required: entity !== 'holidays', value: row?.code || '' },
      { name: 'description', labelKey: 'common.description', type: 'textarea', value: row?.description || '', span: 'full' },
      { name: 'active', labelKey: 'org.active', type: 'checkbox', value: row ? row.active : true }
    ];
    let fields = common;
    if (entity === 'departments') {
      fields = [
        common[1], common[0],
        { name: 'headEmployeeId', labelKey: 'org.head', type: 'select', options: (cache.employees || []).map((emp) => ({ value: emp.employeeId, label: emp.displayName })), value: row?.headEmployeeId || '' },
        { name: 'branchId', labelKey: 'org.branch', type: 'select', options: (cache.branches || []).map((item) => ({ value: item.id, label: item.name })), value: row?.branchId || '' },
        common[2], common[3]
      ];
    } else if (entity === 'designations') {
      fields = [common[1], common[0], { name: 'level', labelKey: 'org.level', type: 'number', min: 1, max: 20, value: row?.level || 1 }, common[2], common[3]];
    } else if (entity === 'branches') {
      fields = [
        common[1], common[0],
        { name: 'address', labelKey: 'org.address', type: 'textarea', value: row?.address || '', span: 'full' },
        { name: 'city', labelKey: 'org.city', value: row?.city || '' },
        { name: 'state', labelKey: 'org.state', value: row?.state || '' },
        { name: 'pincode', labelKey: 'org.pincode', value: row?.pincode || '' },
        { name: 'timezone', labelKey: 'org.timezone', value: row?.timezone || 'Asia/Kolkata' },
        { name: 'headEmployeeId', labelKey: 'org.head', type: 'select', options: (cache.employees || []).map((emp) => ({ value: emp.employeeId, label: emp.displayName })), value: row?.headEmployeeId || '' },
        { name: 'phone', labelKey: 'org.phone', value: row?.phone || '' },
        { name: 'email', labelKey: 'org.email', type: 'email', value: row?.email || '' },
        common[3]
      ];
    } else if (entity === 'sites') {
      fields = [
        common[1], common[0],
        { name: 'branchId', labelKey: 'org.branch', type: 'select', options: (cache.branches || []).map((item) => ({ value: item.id, label: item.name })), value: row?.branchId || '' },
        { name: 'clientName', labelKey: 'org.client', value: row?.clientName || '' },
        { name: 'contactPerson', labelKey: 'org.contactPerson', value: row?.contactPerson || '' },
        { name: 'contactPhone', labelKey: 'org.contactPhone', value: row?.contactPhone || '' },
        { name: 'latitude', labelKey: 'org.latitude', type: 'number', step: '0.000001', min: -90, max: 90, value: row?.latitude ?? '' },
        { name: 'longitude', labelKey: 'org.longitude', type: 'number', step: '0.000001', min: -180, max: 180, value: row?.longitude ?? '' },
        { name: 'radiusMeters', labelKey: 'org.radius', type: 'number', min: 25, max: 5000, value: row?.radiusMeters ?? 150 },
        { name: 'address', labelKey: 'org.address', type: 'textarea', value: row?.address || '', span: 'full' },
        common[3]
      ];
    } else {
      fields = [
        { name: 'holidayDate', labelKey: 'org.holidayDate', type: 'date', required: true, value: row?.holidayDate || '' },
        common[0],
        { name: 'holidayType', labelKey: 'org.holidayType', type: 'select', required: true, options: ['PUBLIC', 'RESTRICTED', 'OPTIONAL', 'COMPANY'].map((item) => ({ value: item, label: humanize(item) })), value: row?.holidayType || 'PUBLIC' },
        { name: 'branchId', labelKey: 'org.branch', type: 'select', options: (cache.branches || []).map((item) => ({ value: item.id, label: item.name })), value: row?.branchId || '' },
        common[2], common[3]
      ];
    }
    formDialog({
      wide: entity === 'branches' || entity === 'sites',
      title: row ? 'org.editRecord' : 'org.addRecord',
      intro: t('org.entityHint', { entity: t(labelKey) }),
      fields,
      onSubmit: async (values) => {
        await apiRequest('org.save', { entity, id: row?.id, ...values });
        await draw();
      }
    });
  }
}
