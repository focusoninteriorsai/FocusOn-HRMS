import { apiRequest } from '../api.js';
import { signOut } from '../auth.js';
import { t } from '../i18n.js';
import { definitionList, element, formatDate, icon, loadingState, openDialog, closeDialog } from '../ui.js';

export async function renderDashboard(container) {
  container.append(loadingState());
  const data = await apiRequest('dashboard.get', {}, { isRead: true });
  container.replaceChildren();

  const header = element('header', { className: 'page-header' }, [
    element('div', {}, [
      element('p', { className: 'eyebrow', text: t('dashboard.eyebrow') }),
      element('h1', { text: t('dashboard.welcome', { name: data.user.displayName }) }),
      element('p', { className: 'page-subtitle', text: t('dashboard.subtitle') })
    ])
  ]);

  const accountCard = element('article', { className: 'card detail-card stagger-item' }, [
    element('div', { className: 'card-heading' }, [
      element('span', { className: 'card-icon' }, icon('user')),
      element('h2', { text: t('dashboard.account') }),
      element('span', { className: 'badge badge-success', text: t('dashboard.active') })
    ]),
    definitionList([
      [t('profile.employeeId'), data.user.employeeId],
      [t('profile.department'), data.user.department],
      [t('profile.designation'), data.user.designation],
      [t('profile.branch'), data.user.branch]
    ])
  ]);

  const logoutButton = element('button', {
    className: 'button button-secondary',
    type: 'button',
    onclick: confirmLogoutAll
  }, [icon('logout'), element('span', { text: t('dashboard.logoutAll') })]);
  const securityCard = element('article', { className: 'card detail-card stagger-item' }, [
    element('div', { className: 'card-heading' }, [
      element('span', { className: 'card-icon' }, icon('shield')),
      element('h2', { text: t('dashboard.security') })
    ]),
    definitionList([
      [t('dashboard.passwordChanged'), formatDate(data.security.passwordChangedAt)],
      [t('dashboard.sessionExpires'), formatDate(data.session.absoluteExpiresAt, { timeStyle: 'short' })],
      [t('dashboard.lastSeen'), formatDate(data.session.lastSeenAt, { timeStyle: 'short' })],
      [t('dashboard.accessEntries'), String(data.security.permissionCount)]
    ]),
    element('div', { className: 'card-actions' }, logoutButton)
  ]);

  const modulesCard = element('article', { className: 'card detail-card stagger-item dashboard-modules' }, [
    element('div', { className: 'card-heading' }, [
      element('span', { className: 'card-icon' }, icon('clock')),
      element('h2', { text: t('dashboard.moduleStatus') })
    ]),
    element('p', { className: 'muted', text: t('dashboard.moduleStatusDescription') }),
    element('div', { className: 'module-count' }, [
      element('strong', { text: String(data.security.permissionCount) }),
      element('span', { text: t('dashboard.effectivePermissions') })
    ])
  ]);

  container.append(header, element('div', { className: 'dashboard-grid' }, [accountCard, securityCard, modulesCard]));
}

function confirmLogoutAll() {
  const cancel = element('button', { className: 'button button-secondary', type: 'button', text: t('common.cancel'), onclick: closeDialog });
  const confirm = element('button', {
    className: 'button button-danger',
    type: 'button',
    text: t('dashboard.logoutAll'),
    onclick: async () => {
      confirm.disabled = true;
      closeDialog();
      await signOut({ allDevices: true });
    }
  });
  openDialog({
    title: t('dashboard.logoutAllTitle'),
    content: element('p', { text: t('dashboard.logoutAllDescription') }),
    actions: [cancel, confirm]
  });
}
