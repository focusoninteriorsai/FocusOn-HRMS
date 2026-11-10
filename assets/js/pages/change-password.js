import { changePassword } from '../auth.js';
import { navigate } from '../router.js';
import { getState } from '../store.js';
import { t, translateError } from '../i18n.js';
import { element, icon, setButtonBusy } from '../ui.js';

export function renderChangePassword(container) {
  const policy = getState().session?.passwordPolicy || { minLength: 12, requireComplexity: true };
  const form = element('form', { className: 'password-form', novalidate: true });
  const current = passwordField('current-password', 'changePassword.current', 'current-password');
  const next = passwordField('new-password', 'changePassword.new', 'new-password');
  const confirmation = passwordField('confirm-password', 'changePassword.confirm', 'new-password');
  const error = element('p', { className: 'form-message form-message-error', role: 'alert', hidden: true });
  const submit = element('button', { className: 'button button-primary button-full', type: 'submit', text: t('changePassword.submit') });

  form.append(current.wrapper, next.wrapper, confirmation.wrapper, error, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const validation = validate(current.input.value, next.input.value, confirmation.input.value, policy);
    if (validation) {
      error.textContent = t(validation, { min: policy.minLength });
      error.hidden = false;
      return;
    }
    setButtonBusy(submit, true, 'changePassword.updating');
    try {
      await changePassword(current.input.value, next.input.value);
      navigate('/dashboard');
    } catch (requestError) {
      error.textContent = translateError(requestError);
      error.hidden = false;
      setButtonBusy(submit, false);
    }
  });

  container.append(
    element('section', { className: 'card standalone-card' }, [
      element('div', { className: 'standalone-icon' }, icon('lock', 28)),
      element('h1', { text: t('changePassword.title') }),
      element('p', { className: 'page-subtitle', text: t('changePassword.description', { min: policy.minLength }) }),
      element('p', { className: 'policy-hint', text: policy.requireComplexity ? t('changePassword.complexity') : t('changePassword.lengthOnly', { min: policy.minLength }) }),
      form
    ])
  );
}

function passwordField(id, labelKey, autocomplete) {
  const input = element('input', {
    id,
    className: 'form-input',
    type: 'password',
    required: true,
    maxLength: 128,
    autocomplete
  });
  const wrapper = element('div', { className: 'form-field' }, [
    element('label', { htmlFor: id, text: t(labelKey) }),
    input
  ]);
  return { wrapper, input };
}

function validate(current, next, confirmation, policy) {
  if (!current || !next || !confirmation) return 'changePassword.required';
  if (next.length < policy.minLength) return 'changePassword.tooShort';
  if (next !== confirmation) return 'changePassword.mismatch';
  if (current === next) return 'changePassword.samePassword';
  if (policy.requireComplexity && !(/[a-z]/.test(next) && /[A-Z]/.test(next) && /\d/.test(next) && /[^A-Za-z0-9]/.test(next))) {
    return 'changePassword.complexityError';
  }
  return '';
}
