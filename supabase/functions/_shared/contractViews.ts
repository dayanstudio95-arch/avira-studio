// "מי פתח את החוזה" (2026-10-13, the owner's request): when the couple opened their
// contract link. Pure — tested in scripts/test-whatsapp-bot.mjs PART 57.
//
// Counted only when the public contract page itself asked (purpose 'contract' — the
// questionnaire page reads the same lead), only before signing (after that the link is
// how the couple downloads their copy), and never when someone from the studio is signed
// in: the owner opening a link he copied is not the couple reading it.
export function shouldStampContractView(
  { purpose, signedAt, viewerIsStudio }: { purpose?: unknown; signedAt?: string | null; viewerIsStudio: boolean }
): boolean {
  return purpose === 'contract' && !signedAt && !viewerIsStudio;
}

export function contractViewUpdate(
  lead: { contract_viewed_first_at?: string | null; contract_view_count?: number | null },
  now: Date = new Date(),
): { contract_viewed_first_at: string; contract_viewed_at: string; contract_view_count: number; first: boolean } {
  const iso = now.toISOString();
  return {
    contract_viewed_first_at: lead.contract_viewed_first_at || iso,
    contract_viewed_at: iso,
    contract_view_count: (Number(lead.contract_view_count) || 0) + 1,
    first: !lead.contract_viewed_first_at,
  };
}
