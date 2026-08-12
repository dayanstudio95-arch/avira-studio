// DISABLED: This function was sending payment reminders directly to Leads, bypassing the automation UI toggle.
// Payment reminders are now handled exclusively by automationEngine.ts -> runPaymentReminder()

Deno.serve(async (_req) => {
  return Response.json({ disabled: true, message: 'This function is disabled. Payment reminders are now handled by automationEngine payment_reminder automation.' });
});