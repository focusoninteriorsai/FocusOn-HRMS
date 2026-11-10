import { apiRequest } from '../api.js';
import { t } from '../i18n.js';
import { getState } from '../store.js';
import {
  button, can, confirmDialog, copyText, dataTable, detailDialog, element, emptyState, formatDate, formDialog,
  humanize, icon, load, money, mountPage, pageHeader, stateBadge, submit, tabs, showToast, translateError
} from './_kit.js';

const SCOPES = ['Self', 'Direct reports', 'Team', 'Department', 'Branch', 'Company', 'Custom list'];
const OVERRIDE_EFFECTS = ['ALLOW', 'DENY'];

export async function renderAccess(container) {
  const state = { tab: 'users', role: null };
  const body = element('div', { className: 'access-body' });
  const tabHost = element('div');

  container.replaceChildren(
    pageHeader('access.title', 'access.subtitle', [
      button('access.refresh', { iconName: 'refresh', onClick: () => paint() })
    ], 'shield'),
    tabHost,
    body
  );

  await paint();

  async function paint() {
    tabHost.replaceChildren(tabs([
      { id: 'users', labelKey: 'access.tabUsers' },
      { id: 'roles', labelKey: 'access.tabRoles' },
      { id: 'overrides', labelKey: 'access.tabOverrides' },
      { id: 'delegations', labelKey: 'access.tabDelegations' },
      { id: 'features', labelKey: 'access.tabFeatures' },
      { id: 'audit', labelKey: 'access.tabAudit' }
    ], (id) => { state.tab = id; paintBody(); }));
    await paintBody();
  }

  async function paintBody() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      if (state.tab === 'users') await paintUsers();
      else if (state.tab === 'roles') await paintRoles();
      else if (state.tab === 'overrides') await paintOverrides();
      else if (state.tab === 'delegations') await paintDelegations();
      else if (state.tab === 'features') await paintFeatures();
      else await paintAudit();
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  function pickEmployee(labelKey) {
    return load('employees.picker', {}).then((data) => data.items.map((item) => ({
      value: item.employeeId, label: `${item.displayName} (${item.employeeId})`
    })));
  }

  /* ------------------------------------------------------------- Users */
  async function paintUsers() {
    const [users, roles, employees] = await Promise.all([
      load('access.users', {}), load('access.roles', {}), load('employees.picker', {})
    ]);
    const employeeOptions = employees.items.map((item) => ({ value: item.employeeId, label: `${item.displayName} (${item.employeeId})` }));
    const roleOptions = roles.items.filter((role) => role.active).map((role) => ({ value: role.id, label: role.name }));

    const table = dataTable([
      { labelKey: 'access.colUser', render: (row) => element('div', {}, [
        element('strong', { text: row.displayName || row.employeeId }),
        element('div', { className: 'muted-small', text: row.employeeId })
      ]) },
      { labelKey: 'access.colRoles', render: (row) => element('span', { className: 'chip-row',
        text: (row.roles || []).length ? row.roles.map((role) => role.name).join(', ') : t('access.noRoles')
      }) },
      { labelKey: 'access.colStatus', render: (row) => stateBadge(row.status) },
      { labelKey: 'access.colLastLogin', render: (row) => (row.lastLoginAt ? formatDate(row.lastLoginAt) : t('common.notAvailable')) },
      {
        labelKey: 'common.actions',
        render: (row) => element('div', { className: 'row-actions' }, [
          can('role.assign') ? element('button', { className: 'button button-secondary', type: 'button', text: t('access.assignRole'),
            onclick: () => formDialog({
              title: 'access.assignRole', fields: [
                { name: 'roleId', labelKey: 'access.role', type: 'select', options: roleOptions, required: true },
                { name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full' }
              ],
              onSubmit: async (values) => {
                await apiRequest('access.assignRole', { employeeId: row.employeeId, roleId: values.roleId, reason: values.reason });
                await paintBody();
              }
            })
          }) : null,
          can('user.resetpassword') ? element('button', { className: 'button button-secondary', type: 'button', text: t('access.resetPassword'),
            onclick: () => apiRequest('access.resetPassword', { employeeId: row.employeeId }).then((data) => {
              detailDialog({
                title: t('access.resetPassword'),
                content: element('div', {}, [
                  element('p', { text: t('access.tempPasswordNotice') }),
                  element('div', { className: 'notice-inline warning' }, [
                    element('code', { text: data.temporaryPassword }),
                    element('button', { className: 'text-button', type: 'button', text: t('common.copy'), onclick: () => copyText(data.temporaryPassword) })
                  ])
                ])
              });
            }).catch((error) => showToast(translateError(error), 'error'))
          }) : null,
          can('user.create') ? element('button', { className: 'button button-secondary', type: 'button', text: t(row.userId ? 'access.disableUser' : 'access.enableUser'),
            onclick: () => apiRequest('access.setUserStatus', { employeeId: row.employeeId, active: !row.userId }).then(() => paintBody()).catch((error) => showToast(translateError(error), 'error'))
          }) : null,
          can('user.view') ? element('button', { className: 'button button-secondary', type: 'button', text: t('access.effectiveAccess'),
            onclick: () => showEffective(row.employeeId)
          }) : null
        ].filter(Boolean))
      }
    ], users.items, { emptyKey: 'access.noUsers' });

    body.replaceChildren(
      element('div', { className: 'page-actions mb-1', }, [
        can('user.create') ? button('access.createUser', {
          variant: 'primary', iconName: 'user',
          onClick: () => formDialog({
            title: 'access.createUser',
            fields: [
              { name: 'employeeId', labelKey: 'access.employee', type: 'select', options: employeeOptions, required: true },
              { name: 'roleId', labelKey: 'access.role', type: 'select', options: roleOptions, required: true },
              { name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full' }
            ],
            onSubmit: async (values) => {
              const data = await apiRequest('access.createUser', values);
              detailDialog({
                title: t('access.createUser'),
                content: element('p', { text: t('access.tempPasswordNotice') + ' ' + (data.temporaryPassword || '') })
              });
              await paintBody();
            }
          })
        }) : null,
        element('span', { className: 'muted-small', text: t('access.usersHint') })
      ]),
      table
    );
  }

  async function showEffective(employeeId) {
    const data = await apiRequest('access.employeeAccess', { employeeId });
    const effective = data.effective || { permissions: [], scopes: {}, isSuperAdmin: false };
    detailDialog({
      title: `${t('access.effectiveAccess')} · ${employeeId}`,
      content: element('div', {}, [
        element('p', {}, [element('strong', { text: t('access.superAdmin') + ': ' }), element('span', { text: effective.isSuperAdmin ? t('common.yes') : t('common.no') })]),
        dataTable([
          { labelKey: 'access.permission', render: (row) => row.key },
          { labelKey: 'access.scope', render: (row) => (row.scopes || []).join(', ') || t('common.notAvailable') }
        ], Object.entries(effective.scopes || {}).map(([key, scopes]) => ({ key, scopes }))),
        element('h3', { text: t('access.overrides') }),
        dataTable([
          { labelKey: 'access.permission', render: (row) => row.permissionKey },
          { labelKey: 'access.effect', render: (row) => stateBadge(row.effect) },
          { labelKey: 'access.reason', render: (row) => row.reason },
          { labelKey: 'access.expires', render: (row) => (row.expiresAt ? formatDate(row.expiresAt) : t('access.never')) }
        ], data.overrides || []),
        element('h3', { text: t('access.delegations') }),
        dataTable([
          { labelKey: 'access.delegate', render: (row) => row.delegateEmployeeId },
          { labelKey: 'access.permissions', render: (row) => (row.permissions || []).join(', ') },
          { labelKey: 'access.endsAt', render: (row) => (row.endsAt ? formatDate(row.endsAt) : t('access.never')) }
        ], data.delegations || [])
      ])
    });
  }

  /* ------------------------------------------------------------- Roles */
  async function paintRoles() {
    // access.roles returns both the role rows and the permission catalog.
    const roles = await load('access.roles', {});
    const permissionGroups = groupPermissions(roles.catalog || []);
    const roleRows = (roles.roles || []).map((role) => ({ ...role, permissions: role.permissions || [] }));
    const roleChoices = roleRows.map((role) => ({ value: role.id, label: role.name }));
    const table = dataTable([
      { labelKey: 'access.roleName', render: (row) => element('div', {}, [
        element('strong', { text: row.name }),
        element('div', { className: 'muted-small', text: `${row.roleCode} · ${humanize(row.scopeType)}` })
      ]) },
      { labelKey: 'access.permissionCount', align: 'right', render: (row) => String(row.permissionCount) },
      { labelKey: 'access.assignedCount', align: 'right', render: (row) => String(row.assignedCount) },
      { labelKey: 'access.colStatus', render: (row) => stateBadge(row.active ? 'ACTIVE' : 'INACTIVE') },
      {
        labelKey: 'common.actions',
        render: (row) => element('div', { className: 'row-actions' }, [
          can('role.define') ? element('button', { className: 'button button-secondary', type: 'button', text: t('access.permissions'), onclick: () => editPermissions(row, permissionGroups) }) : null,
          can('role.define') ? element('button', { className: 'button button-secondary', type: 'button', text: t('common.edit'), onclick: () => roleForm(row, roleChoices, permissionGroups) }) : null,
          can('role.define') && !row.builtIn ? element('button', { className: 'button button-danger', type: 'button', text: t('common.delete'),
            onclick: () => confirmDialog({
              titleKey: 'access.deleteRole', message: t('access.deleteRoleConfirm', { name: row.name }),
              onConfirm: async () => { await apiRequest('access.deleteRole', { roleId: row.id }); await paintBody(); }
            })
          }) : null
        ].filter(Boolean))
      }
    ], roleRows);

    body.replaceChildren(
      element('div', { className: 'page-actions mb-1', }, [
        can('role.define') ? button('access.newRole', { variant: 'primary', iconName: 'shield', onClick: () => roleForm(null, roleChoices, permissionGroups) }) : null
      ].filter(Boolean)),
      table
    );
  }

  function roleForm(role, roleChoices, permissionGroups) {
    formDialog({
      title: role ? 'access.editRole' : 'access.newRole',
      fields: [
        { name: 'roleCode', labelKey: 'access.roleCode', required: !role, value: role?.roleCode || '', help: 'access.roleCodeHelp' },
        { name: 'name', labelKey: 'access.roleName', required: true, value: role?.name || '' },
        { name: 'scopeType', labelKey: 'access.scope', type: 'select', options: SCOPES.map((scope) => ({ value: scope, label: scope })), value: role?.scopeType || 'Self', required: true },
        { name: 'description', labelKey: 'common.description', type: 'textarea', value: role?.description || '', span: 'full' },
        {
          name: 'cloneFrom', labelKey: 'access.cloneFrom', type: 'select', span: 'full', help: 'access.cloneFromHelp',
          options: [{ value: '', label: t('common.none') }, ...(roleChoices || [])],
          value: ''
        }
      ],
      onSubmit: async (values) => {
        // A brand-new role can start from an existing role's permissions.
        const { cloneFrom, ...roleValues } = values;
        const saved = await apiRequest('access.saveRole', { ...roleValues, roleId: role?.id });
        if (!role && cloneFrom) {
          const sourceRole = await load('access.roles', {});
          const permissions = ((sourceRole.roles || []).find((item) => item.id === cloneFrom)?.permissions || [])
            .map((permission) => permission.key);
          if (saved && saved.roleId && permissions.length) {
            await apiRequest('access.saveRolePermissions', { roleId: saved.roleId, permissionKeys: permissions });
          }
        }
        await paintBody();
      }
    });
  }

  function editPermissions(role, groups) {
    const selected = new Set((role.permissions || []).map((item) => item.key));
    const host = element('div');
    Object.entries(groups).forEach(([module, permissions]) => {
      host.append(element('fieldset', { className: 'form-section' }, [
        element('legend', { text: module }),
        element('div', { className: 'checkbox-grid' }, permissions.map((permission) => {
          const input = element('input', { type: 'checkbox', id: `perm-${permission.key}`, value: permission.key, checked: selected.has(permission.key) });
          input.addEventListener('change', () => {
            if (input.checked) selected.add(permission.key);
            else selected.delete(permission.key);
          });
          return element('label', { className: 'checkbox-row', for: `perm-${permission.key}`, title: permission.description || '' }, [
            input, element('span', { text: `${permission.key}${permission.sensitive ? ' *' : ''}` })
          ]);
        }))
      ]));
    });
    const save = element('button', { className: 'button button-primary', type: 'button', text: t('common.save') });
    save.addEventListener('click', async () => {
      try {
        await apiRequest('access.saveRolePermissions', { roleId: role.id, permissionKeys: Array.from(selected) });
        showToast(t('common.saved'), 'success');
        await paintBody();
      } catch (error) {
        showToast(translateError(error), 'error');
      }
    });
    detailDialog({
      title: `${t('access.permissions')} · ${role.name}`,
      content: element('div', {}, [
        element('p', { className: 'muted-small', text: t('access.sensitiveMarker') }),
        host,
        element('div', { className: 'page-actions' }, [save])
      ])
    });
  }

  /* --------------------------------------------------------- Overrides */
  async function paintOverrides() {
    const employees = await pickEmployee();
    const host = element('div');
    body.replaceChildren(host);
    const field = element('div', { className: 'toolbar' }, [
      element('div', { className: 'form-field' }, [
        element('label', { for: 'override-employee', text: t('access.employee') }),
        element('select', { id: 'override-employee', className: 'form-input' }, [
          element('option', { value: '', text: t('access.chooseEmployee') }),
          ...employees.map((item) => element('option', { value: item.value, text: item.label }))
        ])
      ])
    ]);
    const result = element('div');
    field.querySelector('select').addEventListener('change', async (event) => {
      if (!event.target.value) { result.replaceChildren(); return; }
      await paintOverridesFor(event.target.value, result);
    });
    host.append(field, result);
  }

  async function paintOverridesFor(employeeId, host) {
    const data = await apiRequest('access.employeeAccess', { employeeId });
    const table = dataTable([
      { labelKey: 'access.permission', render: (row) => row.permissionKey },
      { labelKey: 'access.effect', render: (row) => stateBadge(row.effect) },
      { labelKey: 'access.scope', render: (row) => row.scopeType || 'Company' },
      { labelKey: 'access.reason', render: (row) => row.reason },
      { labelKey: 'access.expires', render: (row) => (row.expiresAt ? formatDate(row.expiresAt) : t('access.never')) },
      {
        labelKey: 'common.actions',
        render: (row) => element('button', { className: 'button button-danger', type: 'button', text: t('common.remove'),
          onclick: () => confirmDialog({
            titleKey: 'access.removeOverride', message: t('access.removeOverrideConfirm'),
            onConfirm: async () => { await apiRequest('access.deleteOverride', { overrideId: row.id }); await paintOverridesFor(employeeId, host); }
          })
        })
      }
    ], data.overrides || []);

    host.replaceChildren(
      element('div', { className: 'page-actions mb-1', }, [
        button('access.addOverride', {
          variant: 'primary', iconName: 'lock',
          onClick: () => formDialog({
            title: 'access.addOverride',
            fields: [
              { name: 'permissionKey', labelKey: 'access.permission', required: true, placeholder: 'payroll.verify' },
              { name: 'effect', labelKey: 'access.effect', type: 'select', options: OVERRIDE_EFFECTS.map((item) => ({ value: item, label: item })), required: true },
              { name: 'scopeType', labelKey: 'access.scope', type: 'select', options: SCOPES.map((scope) => ({ value: scope, label: scope })), value: 'Company' },
              { name: 'expiresAt', labelKey: 'access.expires', type: 'date' },
              { name: 'reason', labelKey: 'access.reason', type: 'textarea', required: true, span: 'full' }
            ],
            onSubmit: async (values) => {
              await apiRequest('access.saveOverride', {
                employeeId, ...values,
                expiresAt: values.expiresAt ? new Date(`${values.expiresAt}T23:59:59`).toISOString() : ''
              });
              await paintOverridesFor(employeeId, host);
            }
          })
        })
      ]),
      table
    );
  }

  /* ------------------------------------------------------- Delegations */
  async function paintDelegations() {
    const employees = await pickEmployee();
    const host = element('div');
    body.replaceChildren(host);
    const select = element('select', { id: 'delegation-employee', className: 'form-input' }, [
      element('option', { value: '', text: t('access.chooseEmployee') }),
      ...employees.map((item) => element('option', { value: item.value, text: item.label }))
    ]);
    const result = element('div');
    select.addEventListener('change', () => (select.value ? paintDelegationsFor(select.value, result) : result.replaceChildren()));
    host.append(element('div', { className: 'toolbar' }, [
      element('div', { className: 'form-field' }, [element('label', { for: 'delegation-employee', text: t('access.employee') }), select])
    ]), result);
  }

  async function paintDelegationsFor(employeeId, host) {
    const data = await apiRequest('access.employeeAccess', { employeeId });
    const employees = await pickEmployee();
    host.replaceChildren(
      element('div', { className: 'page-actions mb-1', }, [
        button('access.addDelegation', {
          variant: 'primary', iconName: 'user',
          onClick: () => formDialog({
            title: 'access.addDelegation',
            fields: [
              { name: 'delegateEmployeeId', labelKey: 'access.delegate', type: 'select', options: employees, required: true },
              { name: 'permissions', labelKey: 'access.permissions', type: 'textarea', required: true, span: 'full', help: 'access.permissionsHelp' },
              { name: 'endsAt', labelKey: 'access.endsAt', type: 'date', required: true },
              { name: 'reason', labelKey: 'access.reason', type: 'textarea', required: true, span: 'full' }
            ],
            onSubmit: async (values) => {
              await apiRequest('access.saveDelegation', {
                employeeId,
                delegateEmployeeId: values.delegateEmployeeId,
                permissions: String(values.permissions).split(/[,\s]+/).filter(Boolean),
                reason: values.reason,
                endsAt: new Date(`${values.endsAt}T23:59:59`).toISOString()
              });
              await paintDelegationsFor(employeeId, host);
            }
          })
        })
      ]),
      dataTable([
        { labelKey: 'access.delegate', render: (row) => row.delegateEmployeeId },
        { labelKey: 'access.permissions', render: (row) => (row.permissions || []).join(', ') },
        { labelKey: 'access.endsAt', render: (row) => (row.endsAt ? formatDate(row.endsAt) : t('access.never')) },
        { labelKey: 'access.reason', render: (row) => row.reason },
        {
          labelKey: 'common.actions',
          render: (row) => element('button', { className: 'button button-danger', type: 'button', text: t('common.remove'),
            onclick: () => confirmDialog({
              titleKey: 'access.removeDelegation', message: t('access.removeDelegationConfirm'),
              onConfirm: async () => { await apiRequest('access.deleteDelegation', { delegationId: row.id }); await paintDelegationsFor(employeeId, host); }
            })
          })
        }
      ], data.delegations || [])
    );
  }

  /* ---------------------------------------------------------- Features */
  async function paintFeatures() {
    const data = await load('settings.get', {});
    const host = element('div');
    body.replaceChildren(host);
    const groups = {};
    data.features.forEach((feature) => {
      groups[feature.module] = groups[feature.module] || [];
      groups[feature.module].push(feature);
    });
    const cards = Object.entries(groups).map(([module, features]) => element('article', { className: 'card pad-1 mb-1', }, [
      element('h2', { text: module }),
      ...features.map((feature) => {
        const toggle = element('input', { type: 'checkbox', id: `feature-${feature.key}`, checked: feature.enabled });
        toggle.addEventListener('change', async () => {
          try {
            await apiRequest('settings.updateFeatures', { features: { [feature.key]: toggle.checked } });
            showToast(t('common.saved'), 'success');
            const bootstrap = await apiRequest('access.bootstrap', {});
            getState().features = bootstrap.features;
          } catch (error) {
            toggle.checked = !toggle.checked;
            showToast(translateError(error), 'error');
          }
        });
        return element('div', { className: 'checkbox-row mv-sm', }, [
          toggle,
          element('label', { for: `feature-${feature.key}` }, [
            element('strong', { text: feature.label }),
            element('div', { className: 'muted-small', text: feature.description })
          ])
        ]);
      })
    ]));

    const scoped = await load('access.featureScopes', {});
    host.append(
      element('div', { className: 'notice-inline' }, [icon('shield', 18), element('span', { text: t('access.featureScopesHint') })]),
      ...cards,
      element('article', { className: 'card pad-1', }, [
        element('h2', { text: t('access.scopedFlags') }),
        dataTable([
          { labelKey: 'access.feature', render: (row) => row.featureKey },
          { labelKey: 'access.scope', render: (row) => `${row.scopeType}${row.scopeId ? ' · ' + row.scopeId : ''}` },
          { labelKey: 'access.enabled', render: (row) => stateBadge(row.enabled ? 'ACTIVE' : 'INACTIVE') },
          {
            labelKey: 'common.actions',
            render: (row) => element('button', { className: 'button button-danger', type: 'button', text: t('common.remove'),
              onclick: () => confirmDialog({
                titleKey: 'access.removeScope', message: t('access.removeScopeConfirm'),
                onConfirm: async () => { await apiRequest('access.deleteFeatureScope', { scopeRowId: row.id }); await paintBody(); }
              })
            })
          }
        ], scoped.items || []),
        element('div', { className: 'page-actions mt-1', }, [
          button('access.addScope', {
            variant: 'secondary', iconName: 'lock',
            onClick: () => formDialog({
              title: 'access.addScope',
              fields: [
                { name: 'featureKey', labelKey: 'access.feature', type: 'select', required: true, options: data.features.map((f) => ({ value: f.key, label: f.label })) },
                { name: 'scopeType', labelKey: 'access.scopeType', type: 'select', required: true, options: ['GLOBAL', 'BRANCH', 'DEPARTMENT', 'EMPLOYEE'].map((s) => ({ value: s, label: s })) },
                { name: 'scopeId', labelKey: 'access.scopeId', help: 'access.scopeIdHelp' },
                { name: 'enabled', labelKey: 'access.enabled', type: 'checkbox', value: true }
              ],
              onSubmit: async (values) => {
                await apiRequest('access.saveFeatureScope', values);
                await paintBody();
              }
            })
          })
        ])
      ])
    );
  }

  /* ------------------------------------------------------------- Audit */
  async function paintAudit() {
    const filters = { eventType: '', page: 1 };
    const result = element('div');
    const bar = element('div', { className: 'toolbar' }, [
      element('div', { className: 'form-field' }, [
        element('label', { for: 'audit-event', text: t('access.eventType') }),
        element('input', { id: 'audit-event', className: 'form-input', type: 'search', placeholder: 'LEAVE_APPLIED' })
      ])
    ]);
    bar.querySelector('input').addEventListener('change', (event) => { filters.eventType = event.target.value; filters.page = 1; draw(); });
    body.replaceChildren(bar, result);
    await draw();

    async function draw() {
      const data = await apiRequest('access.auditLog', filters);
      result.replaceChildren(
        dataTable([
          { labelKey: 'access.when', render: (row) => formatDate(row.createdAt, { timeStyle: 'short' }) },
          { labelKey: 'access.eventType', render: (row) => stateBadge(row.eventType) },
          { labelKey: 'access.actor', render: (row) => row.actorEmployeeId || 'SYSTEM' },
          { labelKey: 'access.entity', render: (row) => `${row.entity || ''} ${row.recordId || ''}` },
          { labelKey: 'access.outcome', render: (row) => stateBadge(row.outcome) },
          { labelKey: 'access.details', render: (row) => element('code', { className: 'muted-small', text: JSON.stringify(row.details || {}).slice(0, 120) }) }
        ], data.items || []),
        can('settings.view') && data.pageCount > 1 ? element('div', { className: 'pagination' }, [
          button('common.previous', { onClick: () => { filters.page -= 1; draw(); }, disabled: filters.page <= 1 }),
          button('common.next', { onClick: () => { filters.page += 1; draw(); }, disabled: filters.page >= data.pageCount })
        ]) : null
      );
    }
  }
}

function groupPermissions(permissions) {
  const groups = {};
  permissions.forEach((permission) => {
    groups[permission.module] = groups[permission.module] || [];
    groups[permission.module].push(permission);
  });
  return groups;
}

export async function renderEmployees(container) {
  const state = { page: 1, search: '', status: '', departmentId: '', employeeId: null };

  container.replaceChildren(pageHeader('employees.title', 'employees.subtitle', [
    can('employee.export') ? button('employees.export', { iconName: 'download', onClick: exportCsv }) : null,
    can('employee.create') ? button('employees.add', { variant: 'primary', iconName: 'user', onClick: () => employeeForm(null) }) : null
  ].filter(Boolean), 'users'));
  const listHost = element('div');
  const detailHost = element('div');
  container.append(listHost, detailHost);

  const filters = element('div', { className: 'toolbar' }, [
    textField('employees.search', 'search', (value) => { state.search = value; state.page = 1; draw(); }),
    selectField('employees.status', 'status', [
      { value: '', label: t('common.all') }, { value: 'ACTIVE', label: t('employees.activeOnly') }, { value: 'INACTIVE', label: t('employees.inactiveOnly') }
    ], (value) => { state.status = value; state.page = 1; draw(); }),
    textField('employees.departmentId', 'department', (value) => { state.departmentId = value; state.page = 1; draw(); })
  ]);
  listHost.append(filters);
  const tableHost = element('div');
  listHost.append(tableHost);
  await draw();

  async function draw() {
    const data = await load('employees.list', state);
    tableHost.replaceChildren(
      dataTable([
        { labelKey: 'employees.colId', render: (row) => element('strong', { text: row.employeeId }) },
        { labelKey: 'employees.colName', render: (row) => row.displayName },
        { labelKey: 'employees.colDesignation', render: (row) => row.designation || '—' },
        { labelKey: 'employees.colDepartment', render: (row) => row.department || '—' },
        { labelKey: 'employees.colBranch', render: (row) => row.branch || '—' },
        { labelKey: 'employees.colJoining', render: (row) => formatDate(row.joiningDate) },
        { labelKey: 'access.colStatus', render: (row) => stateBadge(row.status) },
        {
          labelKey: 'common.actions',
          render: (row) => element('div', { className: 'row-actions' }, [
            element('button', { className: 'button button-secondary', type: 'button', text: t('common.view'), onclick: () => showDetail(row.employeeId) }),
            can('employee.edit') ? element('button', { className: 'button button-secondary', type: 'button', text: t('common.edit'), onclick: () => employeeForm(row.employeeId) }) : null,
            can('employee.delete') && row.status === 'ACTIVE' ? element('button', { className: 'button button-danger', type: 'button', text: t('employees.deactivate'),
              onclick: () => confirmDialog({
                titleKey: 'employees.deactivate', message: t('employees.deactivateConfirm', { name: row.displayName }),
                onConfirm: async () => { await apiRequest('employees.status', { employeeId: row.employeeId, status: 'INACTIVE', reason: 'Directory deactivation' }); await draw(); }
              })
            }) : null
          ].filter(Boolean))
        }
      ], data.items, { emptyKey: 'employees.noRecords' }),
      element('div', { className: 'pagination' }, [
        element('span', { className: 'muted-small', text: t('common.pageSummary', { page: data.page, pages: data.pageCount, total: data.total }) }),
        element('div', { className: 'pagination-actions' }, [
          button('common.previous', { onClick: () => { state.page -= 1; draw(); }, disabled: data.page <= 1 }),
          button('common.next', { onClick: () => { state.page += 1; draw(); }, disabled: data.page >= data.pageCount })
        ])
      ])
    );
  }

  async function showDetail(employeeId) {
    const data = await load('employees.detail', { employeeId });
    const employee = data.employee;
    detailDialog({
      title: `${employee.displayName} · ${employee.employeeId}`,
      content: element('div', {}, [
        element('div', { className: 'grid grid-2' }, [
          infoCard('employees.profileSection', Object.entries(employee).filter(([key, value]) => value !== '' && value !== null && value !== undefined && !['masked_fields'].includes(key)).slice(0, 18).map(([key, value]) => [humanize(key), String(value)])),
          infoCard('employees.accessSection', [
            [t('access.colRoles'), (data.roles || []).map((role) => role.name).join(', ') || t('access.noRoles')],
            [t('access.superAdmin'), data.effective.isSuperAdmin ? t('common.yes') : t('common.no')],
            [t('employees.canEdit'), data.canEdit ? t('common.yes') : t('common.no')],
            [t('employees.account'), data.account ? humanize(data.account.status) : t('common.notAvailable')]
          ])
        ]),
        data.salary ? element('p', {}, [element('strong', { text: t('employees.salary') + ': ' }), money(data.salary.gross)]) : null,
        can('employee.edit') ? element('div', { className: 'page-actions mt-1', }, [
          button('employees.editRecord', { variant: 'primary', onClick: () => { showDetail(employeeId); employeeForm(employeeId); } })
        ]) : null
      ].filter(Boolean))
    });
  }

  async function employeeForm(employeeId) {
    const [options, existing] = await Promise.all([
      load('employees.detail', { employeeId: employeeId || getState().user.employeeId }),
      employeeId ? load('employees.detail', { employeeId }) : Promise.resolve(null)
    ]);
    const profile = existing?.employee || {};
    formDialog({
      wide: true,
      title: employeeId ? 'employees.editEmployee' : 'employees.add',
      submitLabel: 'common.save',
      fields: [
        { name: 'employeeId', labelKey: 'employees.colId', value: profile.employeeId || '', help: 'employees.idHelp' },
        { name: 'displayName', labelKey: 'employees.fullName', required: true, value: profile.displayName || '' },
        { name: 'workEmail', labelKey: 'employees.workEmail', type: 'email', value: profile.workEmail || '' },
        { name: 'mobile', labelKey: 'employees.mobile', value: profile.mobile || '' },
        { name: 'departmentId', labelKey: 'employees.department', type: 'select', options: options.options.departments.map((item) => ({ value: item.id, label: item.name })), value: profile.departmentId || '' },
        { name: 'designationId', labelKey: 'employees.designation', type: 'select', options: options.options.designations.map((item) => ({ value: item.id, label: item.name })), value: profile.designationId || '' },
        { name: 'branchId', labelKey: 'employees.branch', type: 'select', options: options.options.branches.map((item) => ({ value: item.id, label: item.name })), value: profile.branchId || '' },
        { name: 'reportingManagerId', labelKey: 'employees.reportingManager', type: 'select', options: options.options.managers.map((item) => ({ value: item.employeeId, label: item.displayName })), value: profile.reportingManagerId || '' },
        { name: 'joiningDate', labelKey: 'employees.joiningDate', type: 'date', value: (profile.joiningDate || '').slice(0, 10) },
        { name: 'employmentType', labelKey: 'employees.employmentType', type: 'select', options: options.options.employmentTypes.map((item) => ({ value: item.value || item, label: item.label || humanize(item.value || item) })), value: profile.employmentType || 'FULL_TIME' },
        { name: 'workLocationType', labelKey: 'employees.workLocation', type: 'select', options: options.options.locationTypes.map((item) => ({ value: item.value || item, label: item.label || humanize(item.value || item) })), value: profile.workLocationType || 'OFFICE' },
        { name: 'shiftId', labelKey: 'employees.shift', type: 'select', options: options.options.shifts.map((item) => ({ value: item.id, label: item.name })), value: profile.shiftId || '' },
        { name: 'attendancePolicyId', labelKey: 'employees.attendancePolicy', type: 'select', options: options.options.policies.map((item) => ({ value: item.id, label: item.name })), value: profile.attendancePolicyId || '' },
        { name: 'panNumber', labelKey: 'employees.pan', value: profile.panNumber || '' },
        { name: 'aadhaarNumber', labelKey: 'employees.aadhaar', value: profile.aadhaarNumber || '' },
        { name: 'bankAccountNumber', labelKey: 'employees.bankAccount', value: profile.bankAccountNumber || '' },
        { name: 'bankIfsc', labelKey: 'employees.bankIfsc', value: profile.bankIfsc || '' },
        { name: 'bankName', labelKey: 'employees.bankName', value: profile.bankName || '' },
        { name: 'pfUan', labelKey: 'employees.pfUan', value: profile.pfUan || '' },
        { name: 'esiNumber', labelKey: 'employees.esiNumber', value: profile.esiNumber || '' },
        { name: 'dateOfBirth', labelKey: 'employees.dateOfBirth', type: 'date', value: (profile.dateOfBirth || '').slice(0, 10) },
        { name: 'gender', labelKey: 'employees.gender', type: 'select', options: ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'].map((g) => ({ value: g, label: humanize(g) })), value: profile.gender || '' }
      ],
      onSubmit: async (values) => {
        await apiRequest(employeeId ? 'employees.update' : 'employees.create', { ...values, employeeId: values.employeeId || undefined });
        await draw();
      }
    });
  }

  async function exportCsv() {
    try {
      const data = await apiRequest('employees.export', { includeSensitive: can('field.govtid.view') }, { isRead: true });
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = element('a', { href: url, download: `employees-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
      showToast(translateError(error), 'error');
    }
  }
}

function textField(labelKey, name, onChange) {
  const id = `field-${name}`;
  const input = element('input', { id, className: 'form-input', type: 'search' });
  input.addEventListener('change', () => onChange(input.value));
  return element('div', { className: 'form-field' }, [element('label', { for: id, text: t(labelKey) }), input]);
}

function selectField(labelKey, name, options, onChange) {
  const id = `field-${name}`;
  const select = element('select', { id, className: 'form-input' }, options.map((item) => element('option', { value: item.value, text: item.label })));
  select.addEventListener('change', () => onChange(select.value));
  return element('div', { className: 'form-field' }, [element('label', { for: id, text: t(labelKey) }), select]);
}

function infoCard(titleKey, rows) {
  return element('article', { className: 'card pad-1', }, [
    element('h3', { text: t(titleKey) }),
    ...rows.map(([label, value]) => element('div', { className: 'definition-row' }, [
      element('dt', { text: label }), element('dd', { text: value })
    ]))
  ]);
}
