import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttachmentMetadata } from '../documentTypes';
import { readHistoryPages } from '../../../platform/supabase/historyPages';

export const MAX_ATTACHMENT_NAME_LENGTH = 200;
export const MAX_ATTACHMENT_DESCRIPTION_LENGTH = 4000;

/** Values must come from the form, never from a file name or extracted file content. */
export function validateAttachmentMetadata(name: unknown, description: unknown): Pick<AttachmentMetadata, 'name' | 'description'> {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_ATTACHMENT_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Enter an attachment name containing 1–200 characters without control characters.');
  }
  if (typeof description !== 'string' || !description.trim() || description.trim().length > MAX_ATTACHMENT_DESCRIPTION_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) {
    throw new Error('Enter an attachment description containing 1–4000 characters without unsupported control characters.');
  }
  return { name: name.trim(), description: description.trim() };
}

export function validateAttachmentId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('The attachment reference is invalid. Reload the attachment library.');
  }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Stateless metadata-only cloud boundary. It never reads local files or accepts upload parameters. */
export function createAttachmentMetadataRepository(client: SupabaseClient | null, getUserId: () => string | null | undefined) {
  function account(): string {
    const id = getUserId();
    if (!client || !id) throw new Error('Sign in to save attachment names and descriptions. Files remain on this device.');
    return id;
  }
  function current(owner: string) {
    if (getUserId() !== owner) throw new Error('Session changed. Reload the attachment library.');
  }
  function throwError(error: unknown) {
    if (record(error) && ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(String(error.code))) {
      throw new Error('The connected workspace needs the local attachment metadata database update. Your files remain on this device.');
    }
    if (error) throw error;
  }
  function checked(value: unknown, owner: string, expectedId?: string): AttachmentMetadata {
    if (!record(value) || value.user_id !== owner || (expectedId !== undefined && value.id !== expectedId)) {
      throw new Error('The attachment metadata could not be verified. Refresh and retry.');
    }
    validateAttachmentId(value.id);
    const fields = validateAttachmentMetadata(value.name, value.description);
    return { id: value.id, ...fields };
  }
  async function list(): Promise<AttachmentMetadata[]> {
    const owner = account();
    return readHistoryPages(async (from, to) => {
      const { data, error } = await client!.from('local_attachment_metadata').select('id,user_id,name,description')
        .eq('user_id', owner).order('id', { ascending: true }).range(from, to);
      current(owner); throwError(error);
      if (!Array.isArray(data)) throw new Error('Attachment metadata could not be loaded.');
      return data.map((row) => checked(row, owner));
    });
  }
  async function save(input: AttachmentMetadata): Promise<AttachmentMetadata> {
    const owner = account();
    validateAttachmentId(input.id);
    const fields = validateAttachmentMetadata(input.name, input.description);
    const { data, error } = await client!.rpc('save_local_attachment_metadata', { p_id: input.id, p_name: fields.name, p_description: fields.description });
    current(owner); throwError(error);
    return checked(data, owner, input.id);
  }
  async function remove(id: string): Promise<void> {
    const owner = account();
    validateAttachmentId(id);
    const { error } = await client!.rpc('delete_local_attachment_metadata', { p_id: id });
    current(owner); throwError(error);
  }
  return { list, save, remove };
}
