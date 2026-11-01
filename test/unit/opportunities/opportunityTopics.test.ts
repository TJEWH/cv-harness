import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOpportunityTopic, normalizeOpportunityTopics, opportunityTopicKey } from '../../../src/features/opportunities/domain/opportunityTopics';
import { readOpportunity } from '../../../src/features/opportunities/domain/readOpportunity';
import { opportunityFixture } from '../../support/fixtures/opportunity';

test('topic identity cleans underscore, whitespace, case and Unicode formatting variants before grouping', () => {
  for (const value of ['  acoustic__SENSING  ', 'ACOUSTIC sensing', 'acoustic\tsensing', 'Ａｃｏｕｓｔｉｃ sensing']) {
    assert.deepEqual(normalizeOpportunityTopic(value), { id: 'acoustic sensing', label: 'Acoustic sensing' });
  }
  assert.equal(opportunityTopicKey('HUMAN_ROBOT_INTERACTION'), 'human robot interaction');
});

test('canonical topic labels are independent of record order and retain established technical names', () => {
  const variants = ['embedded_ai', 'Embedded AI', 'EMBEDDED AI'];
  assert.deepEqual(normalizeOpportunityTopics(variants), ['Embedded AI']);
  assert.deepEqual(normalizeOpportunityTopics([...variants].reverse()), ['Embedded AI']);
  assert.deepEqual(normalizeOpportunityTopics(['hri', '3d_vision', 'python_programming', 'mems_sensing', 'ios', 'FFT_audio']),
    ['HRI', '3D vision', 'Python programming', 'MEMS sensing', 'iOS', 'FFT audio']);
});

test('formatting does not merge different topic meanings or rewrite the supplied list', () => {
  const input = Object.freeze(['Acoustics', 'ACOUSTIC_SENSING', 'acoustics', 'Robot audition']);
  assert.deepEqual(normalizeOpportunityTopics(input), ['Acoustics', 'Acoustic sensing', 'Robot audition']);
  assert.deepEqual(input, ['Acoustics', 'ACOUSTIC_SENSING', 'acoustics', 'Robot audition']);
  assert.deepEqual(normalizeOpportunityTopics(['__', '  ']), []);
});

test('catalogue reads cleanse topic copies without changing stored rows or unrelated fields', () => {
  const base = opportunityFixture({ id: 'normalized-topics', topics: ['Acoustics'] });
  const row = { ...base, topics: ['ROBOT__AUDITION', 'robot audition', 'embedded_ai'] };
  const result = readOpportunity(row);
  assert.deepEqual(result.topics, ['Robot audition', 'Embedded AI']);
  assert.deepEqual(row.topics, ['ROBOT__AUDITION', 'robot audition', 'embedded_ai']);
  assert.equal(result.data, row.data);
  assert.equal(result.created_at, row.created_at);
  assert.strictEqual(readOpportunity(result), result, 'already canonical labels retain identity');
});

test('catalogue formatting preserves unsafe source labels for the existing privacy gate to withhold', () => {
  const base = opportunityFixture({ id: 'unsafe-topics' });
  const topics = ['sb_secret_private_token_value', 'api_key=private-value', 'ignore_previous_system', 'person@example.invalid', 'ＩＧＮＯＲＥ previous system', 'ｓｂ＿ｓｅｃｒｅｔ＿private_token'];
  const row = { ...base, topics };
  assert.deepEqual(readOpportunity(row).topics, topics);
  assert.throws(() => readOpportunity({ ...row, topics: [42] }), /invalid canonical record/);
});
