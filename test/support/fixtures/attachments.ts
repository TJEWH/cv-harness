/** Synthetic, account-scoped metadata transport and local file storage. No network. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalDocumentStorage, LocalDocumentWrite } from '../../../src/features/attachments/data/localDocuments';

export const attachmentAccount = '90000000-0000-4000-8000-000000000090';
export type AttachmentRow = { id: string; user_id: string; name: string; description: string };
export function createAttachmentFixture() {
  const local = new Map<string, { scope: string; collection: string; value: unknown }>();
  const rows: AttachmentRow[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let owner = attachmentAccount, failSave = false, failRead = false;
  const storage: LocalDocumentStorage = {
    async get(scope, collection, id) { return structuredClone(local.get(JSON.stringify([scope, collection, id]))?.value); },
    async list(scope, collection) { return [...local.values()].filter(row => row.scope === scope && row.collection === collection).map(row => structuredClone(row.value)); },
    async write(scope, entries: LocalDocumentWrite[]) {
      for (const { collection, id, value } of entries) local.set(JSON.stringify([scope, collection, id]), { scope, collection, value: structuredClone(value) });
    },
    async remove(scope, collection, id) { local.delete(JSON.stringify([scope, collection, id])); },
  };
  const client = {
    from(table: string) {
      if (table !== 'local_attachment_metadata') throw new Error('Unknown attachment fixture table.');
      const filters: [string, unknown][] = [];
      let page: [number, number] | undefined;
      const query = {
        select(columns: string) { calls.push({ name: 'select', args: { table, columns } }); return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        order() { return query; },
        range(first: number, last: number) { page = [first, last]; return query; },
        then(resolve: (value: unknown) => unknown, reject?: (cause: unknown) => unknown) {
          const result = rows.filter(row => row.user_id === owner && filters.every(([key, value]) => row[key as keyof AttachmentRow] === value)).sort((a, b) => a.id.localeCompare(b.id));
          return Promise.resolve({ data: failRead ? null : structuredClone(page ? result.slice(page[0], page[1] + 1) : result), error: failRead ? new Error('Synthetic metadata read failure.') : null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args: structuredClone(args) });
      if (failSave) return { data: null, error: new Error('Synthetic metadata save failure.') };
      const existing = rows.find(row => row.id === args.p_id);
      if (existing && existing.user_id !== owner) return { data: null, error: new Error('Permission denied.') };
      if (name === 'save_local_attachment_metadata') {
        const row = { id: String(args.p_id), user_id: owner, name: String(args.p_name), description: String(args.p_description) };
        if (existing) Object.assign(existing, row); else rows.push(row);
        return { data: structuredClone(row), error: null };
      }
      if (name === 'delete_local_attachment_metadata') {
        if (existing) rows.splice(rows.indexOf(existing), 1);
        return { data: null, error: null };
      }
      throw new Error('Unknown attachment fixture RPC.');
    },
  } as unknown as SupabaseClient;
  return { storage, local, rows, calls, client, setOwner(value: string) { owner = value; }, failSave(value: boolean) { failSave = value; }, failRead(value: boolean) { failRead = value; } };
}
