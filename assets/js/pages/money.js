import { apiRequest } from '../api.js';
import { t, translateError } from '../i18n.js';
import {
  button, can, confirmDialog, dataTable, dateCell, element, emptyState, formDialog, humanize, icon, load,
  money, pageHeader, stateBadge, statRow, tabs, showToast
} from './_kit.js';

const CATEGORIES = ['TRAVEL', 'ACCOMMODATION', 'MEALS', 'MOBILE', 'INTERNET', 'CLIENT_ENTERTAINMENT', 'SUPPLIES', 'TRAINING', 'MEDICAL', 'OTHER'];

export async function renderMoney(container) {
  const state = { tab: 'expenses' };
  const tabHost = element('div');
  const body = element('div');
  container.replaceChildren(pageHeader('money.title', 'money.subtitle', [], 'money'), tabHost, body);
  tabHost.append(tabs([
    { id: 'expenses', labelKey: 'money.tabExpenses' },
    { id: 'loans', labelKey: 'money.tabLoans' }
  ], async (id) => { state.tab = id; await draw(); }));
  await draw();

  async function draw() {
    body.replaceChildren(element('div', { className: 'loading-stack' }, [element('div', { className: 'skeleton skeleton-card' })]));
    try {
      if (state.tab === 'expenses') await drawExpenses();
      else await drawLoans();
    } catch (error) {
      body.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    }
  }

  async function drawExpenses() {
    const [data, mine] = await Promise.all([load('money.expenses', { pageSize: 200 }), load('money.loans', { scope: 'mine' })]);
    const categories = [...new Set([...(data.categories || []), ...CATEGORIES])];
    body.replaceChildren(
      statRow([
        { labelKey: 'money.expenseTotal', value: `₹${Number(data.totals?.claimed || 0).toLocaleString('en-IN')}` },
        { labelKey: 'money.expensePaid', value: `₹${Number(data.totals?.paid || 0).toLocaleString('en-IN')}` },
        { labelKey: 'money.outstandingAdvance', value: `₹${Number(mine.stats?.outstanding || 0).toLocaleString('en-IN')}`, tone: mine.stats?.outstanding ? 'warning' : '' }
      ]),
      element('div', { className: 'page-actions mv-1', }, [
        can('expense.apply') ? button('money.submitExpense', {
          variant: 'primary', iconName: 'plus',
          onClick: () => formDialog({
            title: 'money.submitExpense',
            fields: [
              { name: 'expenseDate', labelKey: 'money.expenseDate', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
              { name: 'category', labelKey: 'money.category', type: 'select', required: true, options: categories.map((item) => ({ value: item, label: humanize(item) })) },
              { name: 'amount', labelKey: 'money.amount', type: 'number', min: 1, step: '0.01', required: true },
              { name: 'receiptFileId', labelKey: 'money.receiptId', help: 'money.receiptHelp' },
              { name: 'description', labelKey: 'common.description', type: 'textarea', required: true, span: 'full', min: 5 }
            ],
            onSubmit: async (values) => {
              await apiRequest('money.submitExpense', values);
              await draw();
            }
          })
        }) : null
      ].filter(Boolean)),
      dataTable([
        { labelKey: 'access.employee', render: (row) => row.employeeName },
        { labelKey: 'money.expenseDate', render: (row) => dateCell(row.expenseDate) },
        { labelKey: 'money.category', render: (row) => humanize(row.category) },
        { labelKey: 'money.amount', align: 'right', render: (row) => money(row.amount) },
        { labelKey: 'common.description', render: (row) => row.description.slice(0, 60) },
        { labelKey: 'money.receipt', render: (row) => (row.receiptAttached ? stateBadge('ACTIVE', 'common.yes') : '—') },
        { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
        {
          labelKey: 'common.actions',
          render: (row) => (row.state === 'APPROVED' && data.canPay ? element('button', { className: 'button button-secondary', type: 'button', text: t('money.markPaid'),
            onclick: () => formDialog({
              title: 'money.markPaid',
              fields: [{ name: 'reference', labelKey: 'money.paymentReference', required: true }],
              submitLabel: 'money.markPaid',
              onSubmit: async (values) => { await apiRequest('money.payExpense', { expenseId: row.id, reference: values.reference }); await draw(); }
            })
          }) : '—')
        }
      ], data.items || [], { emptyKey: 'money.noExpenses' })
    );
  }

  async function drawLoans() {
    const data = await load('money.loans', { scope: can('advance.view') ? 'all' : 'mine' });
    body.replaceChildren(
      statRow([
        { labelKey: 'money.loansTotal', value: String(data.stats?.total || 0) },
        { labelKey: 'money.loansDisbursed', value: `₹${Number(data.stats?.disbursed || 0).toLocaleString('en-IN')}` },
        { labelKey: 'money.outstandingAdvance', value: `₹${Number(data.stats?.outstanding || 0).toLocaleString('en-IN')}`, tone: 'warning' }
      ]),
      element('div', { className: 'page-actions mv-1', }, [
        can('advance.apply') ? button('money.requestLoan', {
          variant: 'primary', iconName: 'plus',
          onClick: () => formDialog({
            title: 'money.requestLoan',
            fields: [
              { name: 'requestType', labelKey: 'money.requestType', type: 'select', options: [{ value: 'ADVANCE', label: humanize('ADVANCE') }, { value: 'LOAN', label: humanize('LOAN') }], required: true },
              { name: 'principal', labelKey: 'money.amount', type: 'number', min: 500, step: '1', required: true },
              { name: 'emiCount', labelKey: 'money.instalments', type: 'number', min: 1, max: 60, value: 1 },
              { name: 'reason', labelKey: 'common.reason', type: 'textarea', required: true, span: 'full' }
            ],
            onSubmit: async (values) => { await apiRequest('money.requestLoan', values); await draw(); }
          })
        }) : null
      ].filter(Boolean)),
      dataTable([
        { labelKey: 'access.employee', render: (row) => row.employeeName },
        { labelKey: 'money.requestType', render: (row) => humanize(row.requestType) },
        { labelKey: 'money.amount', align: 'right', render: (row) => money(row.principal) },
        { labelKey: 'money.emi', align: 'right', render: (row) => money(row.emi) },
        { labelKey: 'money.disbursed', align: 'right', render: (row) => money(row.disbursed) },
        { labelKey: 'money.outstanding', align: 'right', render: (row) => money(row.outstanding) },
        { labelKey: 'attendance.state', render: (row) => stateBadge(row.state) },
        {
          labelKey: 'common.actions',
          render: (row) => (row.state === 'APPROVED' && row.disbursed === 0 && can('advance.disburse') ? element('button', { className: 'button button-secondary', type: 'button', text: t('money.disburse'),
            onclick: () => confirmDialog({
              titleKey: 'money.disburse', message: t('money.disburseConfirm', { amount: row.principal }),
              variant: 'primary',
              onConfirm: async () => { await apiRequest('money.disburseLoan', { loanId: row.id }); await draw(); }
            })
          }) : '—')
        }
      ], data.items || [], { emptyKey: 'money.noLoans' })
    );
  }
}
