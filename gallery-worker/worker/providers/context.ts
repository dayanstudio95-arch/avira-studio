import type { Env, Settings } from '../types';

/** What every cloud needs to resolve a link. `origin` is our own site (sent as Referer to Google). */
export interface CloudContext {
  env: Env;
  settings: Settings;
  origin: string;
}
