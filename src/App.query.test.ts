import { describe, expect, it } from 'vitest';
import { parseInitialViewFromQuery } from './lib/appNavigation';

describe('App query parsing', () => {
  it('routes callback query to settings integrations', () => {
    const parsed = parseInitialViewFromQuery('http://localhost:3000/?view=settings&section=integrations&splitwise=success');

    expect(parsed.view).toBe('settings');
    expect(parsed.settingsSection).toBe('integrations');
  });

  it('falls back to dashboard for unknown values', () => {
    const parsed = parseInitialViewFromQuery('http://localhost:3000/?view=unknown&section=pricing');

    expect(parsed.view).toBe('dashboard');
    expect(parsed.settingsSection).toBeUndefined();
  });
});
