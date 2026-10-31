import type { CvState } from '../types';
import { readCvState } from '../domain/cvStateValidation';
export const STORAGE_KEY = 'cv-session';

export function debounce<Args extends unknown[], Result>(fn: (...args: Args) => Result, wait = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestArgs: Args | undefined;
  const invoke = () => {
    const args = latestArgs;
    latestArgs = undefined;
    timer = null;
    return args ? fn(...args) : undefined;
  };
  const debounced = (...args: Args) => {
    latestArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, wait);
  };
  debounced.flush = () => {
    if (timer === null) return undefined;
    clearTimeout(timer);
    return invoke();
  };
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    latestArgs = undefined;
  };
  return debounced;
}

export function saveLocal(data: unknown) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.warn('saveLocal failed', error);
    return false;
  }
}

export function loadLocal(): CvState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? readCvState(JSON.parse(raw)) : null;
  } catch (error) {
    console.warn('loadLocal failed', error);
    return null;
  }
}
