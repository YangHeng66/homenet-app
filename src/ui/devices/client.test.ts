import { describe, expect, it } from 'vitest';
import { initials } from './client';

describe('initials', () => {
  it.each([
    ['OnePlus-Ace-6', 'On'],
    ['客厅电视', '客'],
    ['192.168.8.221', '221'],
    ['10.0.0.5', '5'],
  ])('%s → %s', (name, out) => {
    expect(initials(name)).toBe(out);
  });
});
