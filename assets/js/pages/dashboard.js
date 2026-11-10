import { apiRequest } from '../api.js';
import { signOut } from '../auth.js';
import { t } from '../i18n.js';
import { hasPermission } from '../store.js';
import {
  button, closeDialog, dataTable, element, formatDate, icon, loadingState, money, openDialog, showToast,
  stateBadge, translateError
} from './_kit.js';

export async function renderDashboard(container) {
  container.append(loadingState());
  const data = await apiRequest('dashboard.get', {}, { isRead: true });
  container.replaceChildren();

  const header = element('header', { className: 'page-header' }, [
    element('div', {}, [
      element('p', { className: 'eyebrow', text: formatDate(new Date().toISOString(), { dateStyle: 'full' }) }),
      element('h1', { text: t('dashboard.welcome', { name: data.employee.displayName || data.employee.employeeId }) }),
      element('p', { className: 'page-subtitle', text: [data.employee.designation, data.employee.department, data.employee.branch].filter(Boolean).join(' · ') || t('dashboard.subtitle') })
    ]),
    element('div', { className: 'page-actions' }, [
      hasPermission('workflow.inbox') ? button('dashboard.openInbox', { iconName: 'check', onClick: () => { window.location.hash = '#/workflow'; } }) : null,
      button('dashboard.logoutAll', { iconName: 'logout', onClick: confirmLogoutAll })
    ].filter(Boolean))
  ]);

  container.append(header);

  if (data.company) container.append(companyPanel(data.company));
  container.append(attendancePanel(data.today, data.shift));
  container.append(element('div', { className: 'grid grid-2 mt-1', }, [
    leavePanel(data.leave),
    approvalsPanel(data.pendingApprovals, data.pendingApprovalCount),
    data.payslips.length ? payslipsPanel(data.payslips) : null,
    data.money ? moneyPanel(data.money) : null,
    data.announcements.length ? announcementsPanel(data.announcements) : null
  ].filter(Boolean)));
  if (data.quickLinks?.length) container.append(quickLinksPanel(data.quickLinks));
}

function panel(titleKey, iconName, children, badge) {
  return element('article', { className: 'card detail-card stagger-item pad-1-5', }, [
    element('div', { className: 'card-heading' }, [
      element('span', { className: 'card-icon' }, icon(iconName)),
      element('h2', { text: t(titleKey) }),
      badge
    ].filter(Boolean)),
    ...children
  ]);
}

function companyPanel(company) {
  const cards = [
    ['dashboard.headcount', String(company.headcount)],
    ['dashboard.presentToday', String(company.presentToday)],
    ['dashboard.onLeaveToday', String(company.onLeaveToday)],
    ['dashboard.newJoiners', String(company.newJoiners)],
    ['dashboard.openPositions', String(company.openPositions || 0)],
    ['dashboard.pendingApprovals', String(company.pendingApprovalsAll)]
  ];
  return element('section', { 'aria-label': t('dashboard.companySnapshot') }, [
    element('div', { className: 'grid grid-3' }, cards.map(([labelKey, value]) => element('article', { className: 'stat-card' }, [
      element('span', { className: 'stat-label', text: t(labelKey) }),
      element('strong', { className: 'stat-value', text: value })
    ]))),
    company.monthlyPayrollNet !== null && company.monthlyPayrollNet !== undefined
      ? element('article', { className: 'stat-card accent mt-1', }, [
        element('span', { className: 'stat-label', text: t('dashboard.monthlyPayrollNet') }),
        element('strong', { className: 'stat-value' }, [money(company.monthlyPayrollNet)])
      ])
      : null
  ].filter(Boolean));
}

function attendancePanel(today, shift) {
  const state = String(today.state || 'NOT_MARKED');
  const checkedIn = Boolean(today.checkInAt);
  const checkedOut = Boolean(today.checkOutAt);
  const line = checkedIn
    ? t('dashboard.punchedIn', { time: String(today.checkInAt).slice(11, 16) }) + (checkedOut ? ' · ' + t('dashboard.punchedOut', { time: String(today.checkOutAt).slice(11, 16) }) : '')
    : t('dashboard.notPunched');
  const action = element('button', { className: `button ${checkedIn ? 'button-secondary' : 'button-primary'}`,
    type: 'button',
    onclick: (event) => punch(checkedIn ? 'CHECK_OUT' : 'CHECK_IN', event.currentTarget)
  }, [icon('clock'), element('span', { text: t(checkedIn ? 'attendance.checkOut' : 'attendance.checkIn') })]);
  return panel('dashboard.attendance', 'clock', [
    element('p', { className: 'page-subtitle', text: line }),
    element('div', { className: 'chip-row' }, [
      stateBadge(state),
      element('span', { className: 'muted-small', text: `${t('attendance.shift')}: ${shift.start.slice(0, 5)} – ${shift.end.slice(0, 5)}` })
    ]),
    !checkedOut ? element('div', { className: 'card-actions' }, [action]) : null
  ].filter(Boolean), element('a', { className: 'text-button', href: '#/attendance', text: t('common.viewAll') }));

  async function punch(punchAction, trigger) {
    trigger.disabled = true;
    const finish = () => {
      trigger.disabled = false;
      const mount = document.getElementById('main-app-content');
      if (mount) import('../router.js').then((router) => router.handleRoute());
    };
    const send = (coords) => apiRequest('attendance.markSelf', {
      action: punchAction,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      accuracy: coords?.accuracy
    }).then(finish).catch((error) => {
      showToast(translateError(error), 'error');
      finish();
    });
    if (!navigator.geolocation) { send(null); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => send({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
      () => send(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }
}

function leavePanel(leave) {
  return panel('dashboard.leaveBalances', 'calendar', [
    leave.balances.length
      ? element('div', { className: 'chip-row' }, leave.balances.map((balance) => element('span', { className: 'badge badge-info', text: `${balance.code}: ${balance.balance}` })))
      : element('p', { className: 'muted-small', text: t('common.noRecords') }),
    leave.upcoming.length
      ? element('ul', { className: 'timeline' }, leave.upcoming.map((item) => element('li', {}, [
        element('strong', { text: item.leaveTypeName }),
        element('div', { className: 'muted-small', text: `${item.startDate} → ${item.endDate}` })
      ])))
      : element('p', { className: 'muted-small', text: t('leave.noUpcoming') }),
    leave.pending ? element('p', { className: 'muted-small', text: t('dashboard.pendingLeave', { count: leave.pending }) }) : null
  ].filter(Boolean), element('a', { className: 'text-button', href: '#/leave', text: t('common.viewAll') }));
}

function approvalsPanel(items, count) {
  return panel('dashboard.approvals', 'check', [
    items.length
      ? element('ul', { className: 'timeline' }, items.map((item) => element('li', {}, [
        element('strong', { text: `${item.requestTypeLabel} · ${item.requesterName}` }),
        element('div', { className: 'muted-small', text: item.summary }),
        element('div', { className: 'muted-small', text: item.dueAt ? t('workflow.dueOn', { date: formatDate(item.dueAt) }) : '' })
      ].filter(Boolean))))
      : element('p', { className: 'muted-small', text: t('workflow.empty') })
  ], count ? element('span', { className: 'badge badge-warning', text: String(count) }) : null);
}

function payslipsPanel(payslips) {
  return panel('dashboard.payslips', 'file', [
    dataTable([
      { labelKey: 'payroll.period', render: (row) => row.period },
      { labelKey: 'payroll.net', align: 'right', render: (row) => money(row.net) }
    ], payslips)
  ], element('a', { className: 'text-button', href: '#/payslips', text: t('common.viewAll') }));
}

function moneyPanel(money1) {
  return panel('dashboard.money', 'money', [
    element('p', { className: 'muted-small', text: t('dashboard.pendingExpenses', { count: money1.pendingExpenses }) }),
    element('p', { className: 'muted-small', text: t('dashboard.outstandingAdvance', { amount: Number(money1.outstandingAdvance).toLocaleString('en-IN') }) })
  ], element('a', { className: 'text-button', href: '#/money', text: t('common.viewAll') }));
}

function announcementsPanel(items) {
  return panel('dashboard.announcements', 'megaphone', items.map((item) => element('div', { className: 'mb-sm', }, [
    element('strong', { text: item.title }),
    element('p', { className: 'muted-small', text: item.body.slice(0, 220) })
  ])));
}

function quickLinksPanel(links) {
  return element('section', { className: 'card pad-1-5 mt-1', }, [
    element('h2', { text: t('dashboard.quickLinks') }),
    element('div', { className: 'chip-row' }, links.map((link) => element('a', { className: 'button button-secondary', href: `#${link.path}`, text: link.label
    })))
  ]);
}

function confirmLogoutAll() {
  const confirm = element('button', { className: 'button button-danger', type: 'button', text: t('dashboard.logoutAll') });
  confirm.addEventListener('click', async () => {
    try {
      await apiRequest('auth.logoutAll', {});
      closeDialog();
      await signOut({ allDevices: true });
    } catch (error) {
      closeDialog();
    }
  });
  openDialog({
    title: t('dashboard.logoutAll'),
    content: element('p', { text: t('dashboard.logoutAllHint') }),
    actions: [element('button', { className: 'button button-secondary', type: 'button', text: t('common.cancel'), onclick: closeDialog }), confirm]
  });
}
