// DISABLED: This function was sending album reminders directly, bypassing the automation UI toggle.
// Album reminders are now managed exclusively through AutomationsDashboard with albumReminder function.
// This function is legacy and should not be used.

Deno.serve(async (_req) => {
  console.log('[sendAlbumReminder] BLOCKED: This is a legacy function. Use albumReminder function or AutomationsDashboard instead.');
  return Response.json({ 
    disabled: true, 
    message: 'This function is disabled. Album reminders are now handled exclusively by albumReminder function via AutomationsDashboard.' 
  });
});