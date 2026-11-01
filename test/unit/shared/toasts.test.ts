import assert from 'node:assert/strict';
import test from 'node:test';
import { effectScope, nextTick, ref } from 'vue';
import { useSaveStateToast, useToasts, useToastWatch } from '../../../src/shared/ui/useToasts';

const { toasts, notify, dismiss, pause, resume, clear } = useToasts();

test('notices replace matching keys, refresh expiry and ignore empty messages', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  clear(); t.after(clear);
  assert.equal(notify({ message: '  ' }), 0);
  const id = notify({ message: 'Saved', key: 'save', tone: 'success' });
  assert.equal(toasts.value[0].duration, 2000);
  t.mock.timers.tick(700);
  assert.equal(notify({ message: 'Saved again', key: 'save', tone: 'success' }), id);
  assert.equal(toasts.value.length, 1);
  assert.equal(toasts.value[0].message, 'Saved again');
  t.mock.timers.tick(1999);
  assert.equal(toasts.value.length, 1);
  t.mock.timers.tick(1);
  assert.equal(toasts.value.length, 0);
});

test('reading or focusing a toast pauses its remaining lifetime until all pause reasons end', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  clear(); t.after(clear);
  const id = notify({ message: 'Copied' });
  t.mock.timers.tick(400);
  pause(id, 'pointer'); pause(id, 'focus');
  t.mock.timers.tick(5000);
  resume(id, 'pointer');
  t.mock.timers.tick(5000);
  assert.equal(toasts.value.length, 1);
  resume(id, 'focus');
  t.mock.timers.tick(1599);
  assert.equal(toasts.value.length, 1);
  t.mock.timers.tick(1);
  assert.equal(toasts.value.length, 0);
});

test('errors use the same two-second lifetime, keep retry actions and refresh when repeated', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  clear(); t.after(clear);
  let retried = false;
  const id = notify({ message: 'Save failed', tone: 'error', action: { label: 'Retry', run: () => { retried = true; } } });
  t.mock.timers.tick(1500);
  assert.equal(toasts.value.length, 1);
  assert.equal(notify({ message: 'Save failed', tone: 'error', action: toasts.value[0].action }), id);
  toasts.value[0].action!.run();
  assert.ok(retried);
  t.mock.timers.tick(1999);
  assert.equal(toasts.value.length, 1);
  t.mock.timers.tick(1);
  assert.equal(toasts.value.length, 0);
});

test('a newer toast replaces the previous one immediately and receives its own full lifetime', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  clear(); t.after(clear);
  const old = notify({ message: 'Saved', key: 'save', tone: 'success' });
  t.mock.timers.tick(750);
  const latest = notify({ message: 'Copied', key: 'copy' });
  assert.notEqual(latest, old);
  assert.deepEqual(toasts.value.map(toast => toast.message), ['Copied']);
  dismiss(old);
  t.mock.timers.tick(1250);
  assert.equal(toasts.value[0].id, latest, 'the earlier timer cannot dismiss the replacement');
  t.mock.timers.tick(749);
  assert.equal(toasts.value.length, 1);
  t.mock.timers.tick(1);
  assert.equal(toasts.value.length, 0);
});

test('message watchers announce repeated attempts synchronously and clear resolved errors', t => {
  clear(); t.after(clear);
  const message = ref('');
  const scope = effectScope();
  scope.run(() => useToastWatch(() => message.value, { tone: 'error' }));
  t.after(() => scope.stop());
  message.value = 'Could not save';
  assert.equal(toasts.value[0].message, message.value);
  const first = toasts.value[0].id;
  message.value = '';
  assert.equal(toasts.value.length, 0);
  message.value = 'Could not save';
  assert.notEqual(toasts.value[0].id, first);
  message.value = '';
  assert.equal(toasts.value.length, 0);
});

test('leaving a component invalidates retry actions without losing non-action result notices', t => {
  clear(); t.after(clear);
  const scope = effectScope();
  const error = ref('Could not save');
  const notice = ref('Copied');
  scope.run(() => {
    useToastWatch(() => error.value, { tone: 'error', action: { label: 'Retry', run() {} } });
    useToastWatch(() => notice.value);
  });
  assert.equal(toasts.value.length, 1);
  scope.stop();
  assert.deepEqual(toasts.value.map(toast => toast.message), ['Copied']);
  error.value = 'Another error';
  assert.equal(toasts.value.length, 1);
});

function saveFixture() {
  const status = ref<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
  const record = ref<string | null>('first');
  const active = ref(true);
  const error = ref('Save failed. Draft retained.');
  const retries = ref(0);
  const scope = effectScope();
  scope.run(() => useSaveStateToast(() => status.value, {
    scope: () => record.value,
    active: () => active.value,
    messages: { saving: () => 'Saving…', saved: () => 'Saved.', error: () => error.value },
    retry: { label: () => 'Retry', run: () => { retries.value++; status.value = 'saving'; } },
  }));
  return { status, record, active, error, retries, scope };
}

test('save-state notices stay quiet on open and typing, then replace progress with the committed result', t => {
  clear(); t.after(clear);
  const fixture = saveFixture(); t.after(() => fixture.scope.stop());
  assert.equal(toasts.value.length, 0);
  fixture.status.value = 'unsaved';
  assert.equal(toasts.value.length, 0);
  fixture.status.value = 'saving';
  const id = toasts.value[0].id;
  assert.equal(toasts.value[0].message, 'Saving…');
  fixture.status.value = 'saved';
  assert.equal(toasts.value[0].id, id);
  assert.equal(toasts.value[0].message, 'Saved.');
  assert.equal(toasts.value[0].tone, 'success');
  fixture.status.value = 'unsaved';
  assert.equal(toasts.value[0].message, 'Saved.', 'typing must not replace a completed result');
  fixture.scope.stop();
  assert.equal(toasts.value[0].message, 'Saved.', 'successful results may finish their lifetime after closing');
});

test('save errors retain scoped retry actions, repeat after retry, and disappear when the editor closes', t => {
  clear(); t.after(clear);
  const fixture = saveFixture(); t.after(() => fixture.scope.stop());
  fixture.status.value = 'saving'; fixture.status.value = 'error';
  assert.equal(toasts.value[0].tone, 'error');
  assert.equal(toasts.value[0].message, fixture.error.value);
  toasts.value[0].action!.run();
  assert.equal(fixture.retries.value, 1);
  assert.equal(toasts.value[0].message, 'Saving…');
  fixture.status.value = 'error';
  assert.equal(toasts.value[0].action?.label, 'Retry');
  fixture.error.value = 'Still offline. Draft retained.';
  assert.equal(toasts.value[0].message, fixture.error.value);
  fixture.active.value = false;
  assert.equal(toasts.value.length, 0);
  fixture.status.value = 'saved';
  assert.equal(toasts.value.length, 0, 'a background completion must not announce another editor');
  fixture.active.value = true;
  assert.equal(toasts.value.length, 0, 'returning to a saved editor must be silent');
  fixture.status.value = 'error';
  fixture.scope.stop();
  assert.equal(toasts.value.length, 0, 'unmount must invalidate retry actions');
});

test('record changes clear pending save notices without announcing the next saved record', t => {
  clear(); t.after(clear);
  const fixture = saveFixture(); t.after(() => fixture.scope.stop());
  fixture.status.value = 'saving';
  fixture.record.value = null;
  assert.equal(toasts.value.length, 0);
  fixture.status.value = 'saved'; fixture.record.value = 'second';
  assert.equal(toasts.value.length, 0);
  fixture.status.value = 'error';
  fixture.record.value = null;
  assert.equal(toasts.value.length, 0);
});

test('clearing an error after a reload does not claim that a draft was saved', t => {
  clear(); t.after(clear);
  const fixture = saveFixture(); t.after(() => fixture.scope.stop());
  fixture.status.value = 'error';
  fixture.status.value = 'saved';
  assert.equal(toasts.value.length, 0);
});

test('a stale retry cannot save another record, a hidden editor, or a disposed component', t => {
  clear(); t.after(clear);
  const fixture = saveFixture(); t.after(() => fixture.scope.stop());
  fixture.status.value = 'error';
  const firstRetry = toasts.value[0].action!.run;
  fixture.record.value = 'second';
  firstRetry();
  assert.equal(fixture.retries.value, 0);
  const secondRetry = toasts.value[0].action!.run;
  fixture.active.value = false;
  secondRetry();
  assert.equal(fixture.retries.value, 0);
  fixture.active.value = true;
  const lastRetry = toasts.value[0].action!.run;
  fixture.scope.stop();
  lastRetry();
  assert.equal(fixture.retries.value, 0);
});

test('background preview progress preserves another operation result and its retry', t => {
  clear(); t.after(clear);
  const failure = notify({ key: 'notes', message: 'Notes could not be saved.', tone: 'error', action: { label: 'Retry', run() {} } });
  assert.equal(notify({ key: 'pdf-preview', message: 'Updating preview…', passive: true }), 0);
  assert.equal(toasts.value[0].id, failure);
  assert.equal(toasts.value[0].action?.label, 'Retry');
  notify({ key: 'notes', message: 'Retrying save…', passive: true });
  assert.equal(toasts.value[0].message, 'Retrying save…', 'an explicit retry may replace its own error');
  notify({ key: 'notes', message: 'Notes saved.', tone: 'success' });
  assert.equal(notify({ message: 'Loading a PDF…', passive: true }), 0);
  assert.equal(toasts.value[0].message, 'Notes saved.');
});

test('derived document validation can wait for a settled update without announcing intermediate errors', async t => {
  clear(); t.after(clear);
  const scope = effectScope(); t.after(() => scope.stop());
  const message = ref('');
  scope.run(() => useToastWatch(() => message.value, { tone: 'error' }, { flush: 'post' }));
  message.value = 'Intermediate document mismatch'; message.value = '';
  await nextTick();
  assert.equal(toasts.value.length, 0);
  message.value = 'The final document cannot be saved.';
  await nextTick();
  assert.equal(toasts.value[0].message, message.value);
});
