import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * `React.lazy` variant whose chunk can be loaded ahead of render. After
 * `preload()` resolves, the first render returns the module synchronously
 * (via a thenable that fulfills in the same tick), so the component never
 * suspends. That guarantee is what lets `hydrateRoot` adopt the prerendered
 * marketing/legal HTML instead of falling back to a client re-render — a
 * plain `lazy` always suspends its first render, even with the module cached.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> & { preload: () => Promise<void> } {
  let loaded: { default: T } | null = null;
  const load = () =>
    factory().then((mod) => {
      loaded = mod;
      return mod;
    });

  const Component = lazy(() => {
    if (loaded) {
      const mod = loaded;
      return {
        then: (resolve: (value: { default: T }) => void) => resolve(mod),
      } as Promise<{ default: T }>;
    }
    return load();
  });

  return Object.assign(Component, {
    preload: async () => {
      await load();
    },
  });
}
