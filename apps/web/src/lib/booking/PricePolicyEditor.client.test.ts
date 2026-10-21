/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$app/forms', () => ({ enhance: () => undefined }));
vi.mock('$lib/ui/confirm-action', () => ({ guardUnsavedChanges: () => undefined, confirmAction: async () => true }));
vi.mock('$lib/ui/styled-controls', () => ({ styledDate: () => undefined, styledSelect: () => undefined }));
import PricePolicyEditor from './PricePolicyEditor.svelte';
afterEach(cleanup);
function fixture(baseMonth: string, monthly = 0) {
 const [year, month] = baseMonth.split('-').map(Number);
 const firstMonth = `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
 return { services: [{ id: 'service', name: 'Synthetic service' }], professionalId: 'professional', currentMonth: '2026-10',
  policies: [{ service_id: 'service', professional_id: 'professional', base_amount: 15, base_month: baseMonth + '-01',
   first_adjustment_month: firstMonth, monthly_percentage: monthly, rounding_unit: 1, currency: 'ARS', revision: 1,
   service_price_monthly_adjustments: [] }] };
}
describe('price preview boundary in the editor', () => {
 it('shows the valid final month 600 and permits saving its configuration', () => {
  render(PricePolicyEditor, fixture('1976-10'));
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(2); // heading and last valid month
  expect(screen.getByText('octubre de 2026')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Guardar aranceles' })).toBeEnabled();
 });
 it('shows the date failure instead of asking to fill already-complete fields', () => {
  render(PricePolicyEditor, fixture('1976-09'));
  expect(screen.getByRole('status')).toHaveTextContent('50 años');
  expect(screen.queryByText(/Completá el importe/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Guardar aranceles' })).toBeDisabled();
 });
 it('translates invalid complete configuration into a human recovery action', () => {
  render(PricePolicyEditor, fixture('2026-10', 1001));
  expect(screen.getByRole('status')).toHaveTextContent('0 a 1.000 %');
  const input = screen.getByLabelText(/^Aumento mensual desde el primer ajuste/);
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', screen.getByRole('status').id);
  expect(screen.getByRole('status')).not.toHaveTextContent('PRICE_');
  expect(screen.getByRole('button', { name: 'Guardar aranceles' })).toBeDisabled();
 });
});
