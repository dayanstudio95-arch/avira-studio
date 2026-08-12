import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { entities } from './entities';
import { functions } from './functions';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

// Route base44.entities.* and base44.functions.invoke() through the Supabase-backed
// shims instead of the dead Base44 backend.
base44.entities = entities;
base44.functions = functions;
