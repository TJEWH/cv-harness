import { inject, provide, readonly, ref, type InjectionKey, type Ref } from 'vue';

const desktopSidebarKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('desktop-sidebar');

export function provideDesktopSidebar(enabled: Readonly<Ref<boolean>>) {
  provide(desktopSidebarKey, enabled);
}

export function useDesktopSidebar(): Readonly<Ref<boolean>> {
  return inject(desktopSidebarKey, () => readonly(ref(false)), true);
}
