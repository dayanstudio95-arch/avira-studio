import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { imageBase64, filename, contentType = 'image/jpeg' } = body;

    // Debug mode: no image data sent, return env/sdk info
    if (!imageBase64) {
      const envKeys = ['SUPABASE_URL','SUPABASE_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY'];
      const found = envKeys.filter(k => !!Deno.env.get(k));
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      return Response.json({
        debug: true,
        envFound: found,
        supabaseUrlPrefix: supabaseUrl.substring(0, 30),
        b44Keys: Object.keys(base44).join(','),
        srKeys: base44.asServiceRole ? Object.keys(base44.asServiceRole).join(',') : 'none'
      });
    }

    if (!filename) {
      return Response.json({ error: 'filename required' }, { status: 400 });
    }

    // Convert base64 to Uint8Array
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const appId = '69bee10fa6d31a0348c609dd';
    const bucket = 'base44-prod';
    const storagePath = 'public/' + appId + '/' + timestamp + '_' + safeName;

    // Try Supabase storage via env vars
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
                        Deno.env.get('SUPABASE_KEY') ||
                        Deno.env.get('SUPABASE_ANON_KEY');

    if (supabaseUrl && supabaseKey) {
      const uploadUrl = supabaseUrl + '/storage/v1/object/' + bucket + '/' + storagePath;
      const uploadResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + supabaseKey,
          'Content-Type': contentType,
          'x-upsert': 'true'
        },
        body: bytes
      });

      if (uploadResp.ok) {
        const publicUrl = supabaseUrl + '/storage/v1/object/public/' + bucket + '/' + storagePath;
        return Response.json({ url: publicUrl });
      }

      const errText = await uploadResp.text().catch(() => 'unknown');
      return Response.json({ error: 'Upload failed (' + uploadResp.status + '): ' + errText }, { status: 500 });
    }

    return Response.json({
      error: 'Storage not configured. Missing SUPABASE_URL or key env vars.',
      hint: 'Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to app environment variables.'
    }, { status: 500 });

  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});