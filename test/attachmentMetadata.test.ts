import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAttachmentMetadataRepository, validateAttachmentMetadata } from '../src/features/attachments/data/attachmentMetadata';

const id = '923aaa1c-7472-4c63-b01f-601dd972ed50';
const metadata = { id, name: 'Transcript of records', description: 'Completed university courses and grades.' };
const row = { ...metadata, user_id: 'owner-a' };
type Query = { name: string; selection?: string; filters: Record<string, unknown>; range?: number[]; params?: Record<string, unknown> };
function fakeClient(respond: (query: Query) => { data?: unknown; error?: unknown } | Promise<{ data?: unknown; error?: unknown }>) {
  const queries: Query[] = [];
  const client = {
    from(name: string) {
      const query: Query = { name, filters: {} }; queries.push(query);
      const builder = {
        select(selection: string) { query.selection = selection; return builder; },
        eq(key: string, value: unknown) { query.filters[key] = value; return builder; },
        order() { return builder; },
        range(from: number, to: number) { query.range = [from, to]; return Promise.resolve(respond(query)); },
      };
      return builder;
    },
    rpc(name: string, params: Record<string, unknown>) {
      const query = { name, filters: {}, params }; queries.push(query); return Promise.resolve(respond(query));
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

test('attachment saves send only manually supplied names and descriptions, with a stable reference', async () => {
  const { client, queries } = fakeClient(() => ({ data: row }));
  const repository = createAttachmentMetadataRepository(client, () => 'owner-a');
  const input = { ...metadata, name: ` ${metadata.name} `, description: `\n${metadata.description}\n`, filename: 'private-alice-transcript.pdf', mimeType: 'application/pdf', size: 82, blob: new Blob(['Private file contents']), extractedText: 'Confidential GPA', user_id: 'owner-b' };
  assert.deepEqual(await repository.save(input), metadata);
  assert.deepEqual(queries[0], { name: 'save_local_attachment_metadata', filters: {}, params: { p_id: id, p_name: metadata.name, p_description: metadata.description } });
  assert.doesNotMatch(JSON.stringify(queries), /private-alice|Private file|Confidential|mimeType|extractedText|owner-b/);
  await repository.save(input);
  assert.equal(queries[0].params!.p_id, queries[1].params!.p_id, 'Retry uses the same metadata ID');
});

test('metadata reads are owner scoped, paginated, and exclude local file details', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ ...row, id: `923aaa1c-7472-4c63-b01f-${String(index).padStart(12, '0')}` }));
  const { client, queries } = fakeClient(({ range }) => ({ data: rows.slice(range![0], range![1] + 1) }));
  const result = await createAttachmentMetadataRepository(client, () => 'owner-a').list();
  assert.equal(result.length, 101);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.equal(query.name, 'local_attachment_metadata');
    assert.equal(query.selection, 'id,user_id,name,description');
    assert.deepEqual(query.filters, { user_id: 'owner-a' });
  }
  assert.deepEqual(Object.keys(result[0]).sort(), ['description', 'id', 'name']);
});

test('metadata boundary rejects blank, malformed, excessive and control-bearing input before networking', async () => {
  const { client, queries } = fakeClient(() => ({ data: row }));
  const repository = createAttachmentMetadataRepository(client, () => 'owner-a');
  for (const name of ['', ' \t', null, 5, {}, 'x'.repeat(201), 'Transcript\nfilename', 'Name\u0000']) {
    await assert.rejects(repository.save({ ...metadata, name } as typeof metadata), /attachment name/);
  }
  for (const description of ['', ' \t\n', null, 5, {}, 'x'.repeat(4001), 'Private\u0001', 'Bad\u007f']) {
    await assert.rejects(repository.save({ ...metadata, description } as typeof metadata), /attachment description/);
  }
  await assert.rejects(repository.save({ ...metadata, id: 'file:///private/document.pdf' }), /reference is invalid/);
  assert.equal(queries.length, 0);
  assert.deepEqual(validateAttachmentMetadata('a'.repeat(200), 'a'.repeat(4000)), { name: 'a'.repeat(200), description: 'a'.repeat(4000) });
  assert.deepEqual(validateAttachmentMetadata(' Name ', 'Paragraph one\n\tParagraph two\r\n'), { name: 'Name', description: 'Paragraph one\n\tParagraph two' });
});

test('foreign, mismatched, malformed and stale metadata responses are rejected', async () => {
  for (const data of [{ ...row, user_id: 'owner-b' }, { ...row, id: crypto.randomUUID() }, { ...row, description: null }]) {
    const { client } = fakeClient(() => ({ data }));
    await assert.rejects(createAttachmentMetadataRepository(client, () => 'owner-a').save(metadata));
  }
  const foreign = fakeClient(() => ({ data: [{ ...row, user_id: 'owner-b' }] }));
  await assert.rejects(createAttachmentMetadataRepository(foreign.client, () => 'owner-a').list(), /verified/);
  for (const operation of ['list', 'save', 'remove'] as const) {
    let owner = 'owner-a';
    const { client } = fakeClient(() => { owner = 'owner-b'; return { data: operation === 'list' ? [row] : row }; });
    const repository = createAttachmentMetadataRepository(client, () => owner);
    await assert.rejects(operation === 'save' ? repository.save(metadata) : operation === 'remove' ? repository.remove(id) : repository.list(), /Session changed/);
  }
});

test('deleting metadata sends only its reference and errors do not report success', async () => {
  const { client, queries } = fakeClient(() => ({ data: null }));
  await createAttachmentMetadataRepository(client, () => 'owner-a').remove(id);
  assert.deepEqual(queries, [{ name: 'delete_local_attachment_metadata', filters: {}, params: { p_id: id } }]);
  const missing = fakeClient(() => ({ error: { code: 'PGRST202' } }));
  await assert.rejects(createAttachmentMetadataRepository(missing.client, () => 'owner-a').save(metadata), /database update/);
  await assert.rejects(createAttachmentMetadataRepository(null, () => null).list(), /Sign in/);
});
