import { before, test } from 'node:test';
import { file, reset, sql } from './db';

before(() => reset());

test('AF-04 synthetic registry, coverage, reuse, plan versions and owner isolation', () => {
  sql(file('../../supabase/tests/opportunity_search_plans.sql'));
});
