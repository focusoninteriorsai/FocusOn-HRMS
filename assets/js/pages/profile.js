import { apiRequest } from '../api.js';
import { t } from '../i18n.js';
import { definitionList, element, formatDate, icon, loadingState } from '../ui.js';

const GENERAL_FIELDS = [
  ['employeeId', 'profile.employeeId'],
  ['displayName', 'profile.displayName'],
  ['workEmail', 'profile.workEmail'],
  ['mobile', 'profile.mobile'],
  ['department', 'profile.department'],
  ['designation', 'profile.designation'],
  ['branch', 'profile.branch'],
  ['reportingManagerId', 'profile.reportingManager'],
  ['workLocationType', 'profile.workLocation'],
  ['joiningDate', 'profile.joiningDate']
];

export async function renderProfile(container) {
  container.append(loadingState());
  const data = await apiRequest('profile.get', {}, { isRead: true });
  container.replaceChildren();

  const entries = GENERAL_FIELDS.map(([field, label]) => [
    t(label),
    field === 'joiningDate' ? formatDate(data.profile[field], { dateStyle: 'long' }) : data.profile[field]
  ]);
  const card = element('article', { className: 'card profile-card stagger-item' }, [
    element('div', { className: 'profile-identity' }, [
      element('div', { className: 'avatar', text: initials(data.profile.displayName, data.profile.employeeId) }),
      element('div', {}, [
        element('h2', { text: data.profile.displayName || data.profile.employeeId }),
        element('p', { className: 'muted', text: data.profile.designation || data.profile.employeeId })
      ])
    ]),
    definitionList(entries)
  ]);

  container.append(
    element('header', { className: 'page-header' }, [
      element('div', {}, [
        element('p', { className: 'eyebrow', text: t('profile.eyebrow') }),
        element('h1', { text: t('profile.title') }),
        element('p', { className: 'page-subtitle', text: t('profile.subtitle') })
      ]),
      element('span', { className: 'page-header-icon' }, icon('user', 28))
    ]),
    card,
    element('aside', { className: 'notice-card stagger-item' }, [
      icon('lock'),
      element('p', { text: t('profile.privacyNotice') })
    ])
  );
}

function initials(name, employeeId) {
  const source = String(name || employeeId || '').trim();
  if (!source) return '—';
  return source.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toLocaleUpperCase()).join('');
}
