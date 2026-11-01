import { createRenderer } from 'vue';

/** Lifecycle/setup tests with no DOM assertions. Rendered interaction hosts stay local. */
export function createStubRenderer() {
  return createRenderer<object, object>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  });
}
