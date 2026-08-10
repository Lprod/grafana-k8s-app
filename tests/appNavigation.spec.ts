import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('navigating app', () => {
  test('clusters page should render successfully', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Clusters}`);
    await expect(page.getByRole('heading', { name: 'Clusters' })).toBeVisible();
  });
});
