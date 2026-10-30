import { computed, inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey, type Ref } from 'vue';

const mobileActionsKey: InjectionKey<Readonly<Ref<HTMLElement | null>>> = Symbol('workspace-mobile-actions');

export function provideWorkspaceMobileActions(target: Ref<HTMLElement | null>) {
  const viewport = typeof window === 'undefined' ? undefined : window.matchMedia?.('(max-width: 760px)');
  const mobile = ref(viewport?.matches ?? false);
  const update = () => { mobile.value = viewport?.matches ?? false; };
  onMounted(() => viewport?.addEventListener('change', update));
  onBeforeUnmount(() => viewport?.removeEventListener('change', update));
  provide(mobileActionsKey, computed(() => mobile.value ? target.value : null));
}

export function useWorkspaceMobileActions() {
  return inject(mobileActionsKey, null);
}
