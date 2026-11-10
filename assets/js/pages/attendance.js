import { apiRequest } from '../api.js';
import { t, translateError } from '../i18n.js';
import { getState } from '../store.js';
import {
  button, can, dataTable, dateCell, element, emptyState, formDialog, humanize, icon, load, pageHeader,
  stateBadge, statRow, tabs, showToast
} from './_kit.js';

export async function renderAttendance(container) {
  const state = { tab: 'today', period: todayMonth(), employeeId: '' };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('attendance.title', 'attendance.subtitle', [], 'clock'), tabHost, body);
  tabHost.append(tabs([
    { id: 'today', labelKey: 'attendance.tabToday' },
    { id: 'month', labelKey: 'attendance.tabMonth' },
    { id: 'register', labelKey: 'attendance.tabRegister' },
    { id: 'lock', labelKey: 'attendance.tabLock' },
    { id: 'regularize', labelKey: 'attendance.tabRegularization' }
  ], async (id) => { state.tab = id; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      if (state.tab === 'today') await drawToday();
      else if (state.tab === 'month') await drawMonth();
      else if (state.tab === 'register') await drawRegister();
      else if (state.tab === 'lock') await drawLock();
      else await drawRegularization();
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  /* ---------------------------------------------------------------- Today */
  async function drawToday() {
    const data = await load('attendance.today', {});
    const day = data.day || {};
    const geo = data.geoLocation;
    const latField = element('input', { className: 'form-input', type: 'number', step: '0.000001', placeholder: t('attendance.latitude') });
    const lngField = element('input', { className: 'form-input', type: 'number', step: '0.000001', placeholder: t('attendance.longitude') });
    const kindField = element('select', { className: 'form-input' }, ['OFFICE', 'WORK_FROM_HOME', 'ON_DUTY'].map((kind) => element('option', { value: kind, text: humanize(kind) })));
    const statusLine = element('div', { className: 'notice-inline' });

    const checkIn = button('attendance.checkIn', {
      variant: 'primary', iconName: 'clock',
      onClick: (event) => punch('CHECK_IN', event.currentTarget)
    });
    const checkOut = button('attendance.checkOut', {
      variant: 'secondary', iconName: 'clock', disabled: !day.checkInAt,
      onClick: (event) => punch('CHECK_OUT', event.currentTarget)
    });

    function fillLocation() {
      if (!navigator.geolocation) {
        showToast(t('attendance.geoUnsupported'), 'error');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          latField.value = position.coords.latitude.toFixed(6);
          lngField.value = position.coords.longitude.toFixed(6);
          showToast(t('attendance.geoCaptured', { accuracy: Math.round(position.coords.accuracy) }), 'success');
        },
        () => showToast(t('attendance.geoDenied'), 'error'),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    }

    async function punch(action, trigger) {
      const payload = {
        action,
        latitude: latField.value === '' ? undefined : Number(latField.value),
        longitude: lngField.value === '' ? undefined : Number(lngField.value),
        accuracy: 25,
        kind: kindField.value
      };
      if (latField.value === '' && data.requireLocation) {
        fillLocation();
        showToast(t('attendance.locationRequired'), 'error');
        return;
      }
      try {
        trigger.disabled = true;
        const result = await apiRequest('attendance.markSelf', payload);
        showToast(result.message || t('common.saved'), 'success');
        await draw();
      } catch (error) {
        showToast(translateError(error), 'error');
      } finally {
        trigger.disabled = false;
      }
    }

    statusLine.append(
      icon(day.state === 'ABSENT' ? 'alert' : 'check'),
      element('span', { text: day.checkInAt
        ? t('attendance.punchedSummary', { checkIn: day.checkInAt.slice(11, 16), checkOut: day.checkOutAt ? day.checkOutAt.slice(11, 16) : t('attendance.stillOpen') })
        : t('attendance.notMarkedYet') })
    );

    body.replaceChildren(
      element('div', { className: 'grid grid-3' }, [
        statCard('attendance.shift', `${data.shift.start.slice(0, 5)} – ${data.shift.end.slice(0, 5)}`, data.shift.name),
        statCard('attendance.state', humanize(day.state || 'NOT_MARKED'), day.workHours ? t('attendance.hoursWorked', { hours: day.workHours }) : ''),
        statCard('attendance.geofence', geo ? `${geo.radius} m` : t('attendance.notConfigured'), geo ? geo.name : t('attendance.geoOptional'))
      ]),
      element('article', { className: 'card pad-1-5 mt-1', }, [
        element('h2', { text: t('attendance.todayPunch') }),
        statusLine,
        element('div', { className: 'form-grid' }, [
          element('div', { className: 'form-field' }, [element('label', { text: t('attendance.attendanceKind') }), kindField]),
          element('div', { className: 'form-field' }, [
            element('label', { text: t('attendance.location') }),
            element('div', { className: 'chip-row' }, [latField, lngField]),
            element('button', { className: 'text-button', type: 'button', text: t('attendance.useMyLocation'), onclick: fillLocation })
          ])
        ]),
        data.requireLocation ? element('p', { className: 'muted-small', text: t('attendance.geoHint') }) : null,
        element('div', { className: 'page-actions mt-1', }, [checkIn, checkOut])
      ])
    );
  }

  /* ---------------------------------------------------------------- Month */
  async function drawMonth() {
    const employees = state.employeeId ? null : await load('employees.picker', {});
    const data = await load('attendance.monthly', { month: state.period, employeeId: state.employeeId || undefined });
    const summary = data.summary;
    const selector = employees ? element('select', { className: 'form-input' }, [
      element('option', { value: '', text: t('attendance.myself') }),
      ...employees.items.map((item) => element('option', { value: item.employeeId, text: `${item.displayName} (${item.employeeId})` }))
    ]) : null;
    if (selector) selector.addEventListener('change', () => { state.employeeId = selector.value; draw(); });
    const monthField = element('input', { className: 'form-input', type: 'month', value: state.period });
    monthField.addEventListener('change', () => { state.period = monthField.value; draw(); });

    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field' }, [element('label', { text: t('attendance.month') }), monthField]),
        selector ? element('div', { className: 'form-field' }, [element('label', { text: t('access.employee') }), selector]) : null,
        data.lock.locked ? element('div', { className: 'form-field' }, [element('label', { text: t('attendance.lockStatus') }), stateBadge('LOCKED')]) : null
      ].filter(Boolean)),
      statRow([
        { labelKey: 'attendance.presentDays', value: String(summary.presentDays) },
        { labelKey: 'attendance.absentDays', value: String(summary.absentDays), tone: summary.absentDays ? 'warning' : '' },
        { labelKey: 'attendance.leaveDays', value: String(summary.leaveDays) },
        { labelKey: 'attendance.notMarkedDays', value: String(summary.notMarkedDays) },
        { labelKey: 'attendance.lateCount', value: String(summary.lateCount) },
        { labelKey: 'attendance.overtime', value: `${Math.round(summary.overtimeMinutes / 60)} h` },
        { labelKey: 'attendance.paidDays', value: String(summary.paidDays) },
        { labelKey: 'attendance.lopDays', value: String(summary.lopDays), tone: summary.lopDays ? 'danger' : '' }
      ]),
      element('h3', { className: 'mt-2', text: t('attendance.dayRegister') }),
      dataTable([
        { labelKey: 'attendance.date', render: (row) => dateCell(row.date) },
        { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
        { labelKey: 'attendance.checkIn', render: (row) => (row.checkInAt ? row.checkInAt.slice(11, 16) : '—') },
        { labelKey: 'attendance.checkOut', render: (row) => (row.checkOutAt ? row.checkOutAt.slice(11, 16) : '—') },
        { labelKey: 'attendance.workHours', align: 'right', render: (row) => String(row.workHours || 0) },
        { labelKey: 'attendance.flags', render: (row) => (row.flags || []).join(', ') || '—' },
        { labelKey: 'attendance.note', render: (row) => row.note || '—' }
      ], data.days || [])
    );
  }

  /* ------------------------------------------------------------- Register */
  async function drawRegister() {
    const employees = await load('employees.picker', {});
    const data = await load('attendance.register', { month: state.period, pageSize: 200 });
    const monthField = element('input', { className: 'form-input', type: 'month', value: state.period });
    monthField.addEventListener('change', () => { state.period = monthField.value; draw(); });

    const markButton = can('attendance.markothers') ? button('attendance.mark', {
      variant: 'primary', iconName: 'plus',
      onClick: () => formDialog({
        title: 'attendance.mark',
        fields: [
          { name: 'employeeId', labelKey: 'access.employee', type: 'select', required: true, options: employees.items.map((item) => ({ value: item.employeeId, label: `${item.displayName} (${item.employeeId})` })) },
          { name: 'date', labelKey: 'attendance.date', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
          { name: 'state', labelKey: 'attendance.state', type: 'select', required: true, options: ['PRESENT', 'ABSENT', 'HALF_DAY', 'WORK_FROM_HOME', 'ON_DUTY', 'LEAVE', 'HOLIDAY'].map((item) => ({ value: item, label: humanize(item) })) },
          { name: 'checkInAt', labelKey: 'attendance.checkInTime', type: 'datetime-local' },
          { name: 'checkOutAt', labelKey: 'attendance.checkOutTime', type: 'datetime-local' },
          { name: 'note', labelKey: 'attendance.note', type: 'textarea', span: 'full' }
        ],
        onSubmit: async (values) => {
          await apiRequest('attendance.mark', {
            ...values,
            checkInAt: values.checkInAt ? new Date(values.checkInAt).toISOString() : '',
            checkOutAt: values.checkOutAt ? new Date(values.checkOutAt).toISOString() : ''
          });
          await draw();
        }
      })
    }) : null;

    body.replaceChildren(
      element('div', { className: 'toolbar' }, [
        element('div', { className: 'form-field' }, [element('label', { text: t('attendance.month') }), monthField]),
        markButton
      ].filter(Boolean)),
      dataTable([
        { labelKey: 'access.employee', render: (row) => element('div', {}, [
          element('strong', { text: row.displayName || row.employeeId }),
          element('div', { className: 'muted-small', text: row.employeeId })
        ]) },
        { labelKey: 'attendance.date', render: (row) => dateCell(row.date) },
        { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
        { labelKey: 'attendance.checkIn', render: (row) => (row.checkInAt ? row.checkInAt.slice(11, 16) : '—') },
        { labelKey: 'attendance.checkOut', render: (row) => (row.checkOutAt ? row.checkOutAt.slice(11, 16) : '—') },
        { labelKey: 'attendance.workHours', align: 'right', render: (row) => String(row.workHours || 0) },
        {
          labelKey: 'common.actions',
          render: (row) => element('button', { className: 'button button-secondary', type: 'button', text: t('common.view'),
            onclick: () => apiRequest('attendance.monthly', { month: row.date.slice(0, 7), employeeId: row.employeeId }).then((month) => {
              import('./_kit.js').then(({ detailDialog }) => detailDialog({
                title: `${row.displayName || row.employeeId} · ${row.date}`,
                content: dataTable([
                  { labelKey: 'attendance.date', render: (item) => dateCell(item.date) },
                  { labelKey: 'attendance.state', render: (item) => stateBadge(item.state) },
                  { labelKey: 'attendance.workHours', align: 'right', render: (item) => String(item.workHours || 0) }
                ], month.days)
              }));
            })
          })
        }
      ], data.items || [])
    );
  }

  /* ----------------------------------------------------------------- Lock */
  async function drawLock() {
    const data = await load('attendance.monthly', { month: state.period });
    const lock = data.lock || {};
    body.replaceChildren(
      element('article', { className: 'card pad-1-5', }, [
        element('h2', { text: t('attendance.tabLock') }),
        element('p', { className: 'page-subtitle', text: t('attendance.lockDescription') }),
        element('div', { className: 'notice-inline' + (lock.locked ? ' success' : ' warning') }, [
          icon('lock'),
          element('span', { text: lock.locked ? t('attendance.lockedOn', { date: lock.lockedAt || '' }) : t('attendance.notLocked') })
        ]),
        element('div', { className: 'form-grid' }, [
          element('div', { className: 'form-field' }, [
            element('label', { text: t('attendance.month') }),
            (() => {
              const field = element('input', { className: 'form-input', type: 'month', value: state.period });
              field.addEventListener('change', () => { state.period = field.value; draw(); });
              return field;
            })()
          ])
        ]),
        element('div', { className: 'page-actions mt-1', }, [
          can('attendance.lock') && !lock.locked ? button('attendance.lockMonth', {
            variant: 'primary', iconName: 'lock',
            onClick: async () => {
              try {
                await apiRequest('attendance.lockMonth', { period: state.period });
                showToast(t('attendance.lockedToast'), 'success');
                await draw();
              } catch (error) { showToast(translateError(error), 'error'); }
            }
          }) : null,
          can('attendance.lock') && lock.locked ? button('attendance.unlockMonth', {
            variant: 'danger', iconName: 'lock',
            onClick: () => formDialog({
              title: 'attendance.unlockMonth',
              fields: [{ name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full' }],
              submitLabel: 'attendance.unlockMonth',
              onSubmit: async (values) => {
                await apiRequest('attendance.unlockMonth', { period: state.period, reason: values.reason });
                await draw();
              }
            })
          }) : null
        ].filter(Boolean))
      ])
    );
  }

  /* -------------------------------------------------------- Regularization */
  async function drawRegularization() {
    const data = await load('attendance.regularizations', {});
    body.replaceChildren(
      element('div', { className: 'page-actions mb-1', }, [
        can('attendance.regularize.request') ? button('attendance.requestRegularization', {
          variant: 'primary', iconName: 'clock',
          onClick: () => formDialog({
            title: 'attendance.requestRegularization',
            intro: t('attendance.regularizationWindow', { days: data.regularizationDays }),
            fields: [
              { name: 'date', labelKey: 'attendance.date', type: 'date', required: true },
              { name: 'checkInAt', labelKey: 'attendance.checkInTime', type: 'datetime-local' },
              { name: 'checkOutAt', labelKey: 'attendance.checkOutTime', type: 'datetime-local' },
              { name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full', min: 10 }
            ],
            onSubmit: async (values) => {
              await apiRequest('attendance.requestRegularization', {
                ...values,
                checkInAt: values.checkInAt ? new Date(values.checkInAt).toISOString() : '',
                checkOutAt: values.checkOutAt ? new Date(values.checkOutAt).toISOString() : ''
              });
              await draw();
            }
          })
        }) : null
      ].filter(Boolean)),
      dataTable([
        { labelKey: 'attendance.date', render: (row) => dateCell(row.date) },
        { labelKey: 'attendance.checkIn', render: (row) => (row.checkInAt ? row.checkInAt.slice(11, 16) : '—') },
        { labelKey: 'attendance.checkOut', render: (row) => (row.checkOutAt ? row.checkOutAt.slice(11, 16) : '—') },
        { labelKey: 'common.reason', render: (row) => row.reason },
        { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
        { labelKey: 'attendance.requested', render: (row) => dateCell(row.createdAt) }
      ], data.items || [], { emptyKey: 'attendance.noRegularizations' })
    );
  }
}

function statCard(labelKey, value, hint) {
  return element('article', { className: 'stat-card' }, [
    element('span', { className: 'stat-label', text: t(labelKey) }),
    element('strong', { className: 'stat-value', text: value }),
    hint ? element('span', { className: 'stat-hint', text: hint }) : null
  ].filter(Boolean));
}

function todayMonth() {
  return new Date().toISOString().slice(0, 7);
}
