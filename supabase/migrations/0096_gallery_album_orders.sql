-- 0096 — The couple's gallery album becomes an album order (2026-10-30, phase 3 of the galleries — docs/galleries-port/5-album.md).
--
-- Studio Plan's three functions (final definitions, read back from its schema like 0095): when the couple sends the album
-- they designed in their photo gallery, it becomes an album order already 'approved' — joined to the event's open order
-- when there is one, else a new one — and they continue in Avira's album portal to product, cover, add-ons and the
-- bank transfer. Re-sending follows Studio Plan's rules (unpaid → count updated; proof pending → back to unpaid; paid →
-- unchanged, the studio is told). Only the gallery Worker (service role) calls them.
--
-- Avira change: films_album_order_state counts 30 included spreads, the same number Avira's album portal charges from
-- (Studio Plan reads a per-studio setting Avira doesn't have).
-- Not here: films_album_design_bank (Studio Plan's studio sketch editor reading a gallery — Avira's editor reads Drive).
-- Only adds. Rollback: audit-reports/rollback/0096_rollback.sql.

CREATE OR REPLACE FUNCTION public.films_album_order_from_design(p_gallery_id text, p_spread_count integer, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g public.films_galleries%rowtype;
  o public.album_orders%rowtype;
  created boolean := false;
  joined boolean := false;
  others integer := 0;
  names text;
  title text;
  note text;
begin
  select * into g from public.films_galleries where id = p_gallery_id;
  if not found or not public.tenant_has_module(g.tenant_id, 'crm') then
    return null;
  end if;
  if p_spread_count is null or p_spread_count < 0 or p_spread_count > 200 then
    raise exception 'bad spread count';
  end if;
  -- One send at a time per gallery: two at once make one order.
  perform pg_advisory_xact_lock(hashtextextended('films_album_order:' || p_gallery_id, 0));
  names := nullif(btrim(g.couple_name), '');

  select * into o from public.album_orders where films_gallery_id = p_gallery_id and tenant_id = g.tenant_id for update;
  if not found then
    if g.event_id is not null then
      -- The order the studio opened for this wedding: unpaid, no sketch, no other gallery (D17(4)).
      select * into o from public.album_orders x
       where x.tenant_id = g.tenant_id and x.event_id = g.event_id and x.films_gallery_id is null
         and x.payment_status = 'unpaid'
         and x.workflow_status in ('draft', 'sketch_uploaded', 'in_review', 'revision_requested')
         and x.current_version_id is null and x.approved_version_id is null
         and not exists (select 1 from public.album_versions v where v.album_order_id = x.id)
       order by x.created_at, x.id
       limit 1
       for update;
      if found then
        update public.album_orders set
          source = 'couple_designer',
          films_gallery_id = g.id,
          designed_spread_count = p_spread_count,
          workflow_status = 'approved',
          portal_token_hash = coalesce(portal_token_hash, p_token_hash),
          updated_at = now()
        where id = o.id returning * into o;
        joined := true;
      end if;
    end if;
    if not joined then
      insert into public.album_orders (
        tenant_id, event_id, couple_names_manual, wedding_date_manual, workflow_status,
        source, films_gallery_id, designed_spread_count, portal_token_hash
      ) values (
        g.tenant_id, g.event_id, names,
        public.films_safe_date(g.event_date),
        'approved', 'couple_designer', g.id, p_spread_count, p_token_hash
      ) returning * into o;
      created := true;
    end if;
    if g.event_id is not null then
      select count(*)::integer into others from public.album_orders
       where tenant_id = g.tenant_id and event_id = g.event_id and id <> o.id;
    end if;
    title := case when joined then 'הזוג עיצב את האלבום של ההזמנה: ' else 'אלבום חדש עוצב על ידי הזוג: ' end || coalesce(names, 'הזמנת אלבום');
    note := format('%s דפים. הזוג ממשיך לבחירת מוצר, כריכה ותשלום.', p_spread_count)
      || case when joined then ' העיצוב צורף להזמנה שפתחתם לאירוע הזה.' else '' end
      || case when others > 0 then format(' לאירוע הזה יש עוד %s הזמנות אלבום — כדאי לבדוק שזו לא כפילות.', others) else '' end;
  elsif o.payment_status = 'unpaid' and o.workflow_status in
      ('draft', 'sketch_uploaded', 'in_review', 'revision_requested', 'approved', 'product_selected', 'awaiting_payment') then
    update public.album_orders set
      designed_spread_count = p_spread_count,
      workflow_status = 'approved',
      portal_token_hash = coalesce(portal_token_hash, p_token_hash),
      updated_at = now()
    where id = o.id returning * into o;
    title := 'הזוג שלח את האלבום מחדש: ' || coalesce(names, 'הזמנת אלבום');
    note := format('%s דפים. ההזמנה חזרה לבחירת מוצר ותשלום לפי מספר הדפים החדש.', p_spread_count);
  elsif o.payment_status = 'transfer_pending_review' and o.workflow_status in ('approved', 'product_selected', 'awaiting_payment') then
    -- A proof the studio has not checked yet is not a payment: the new pages are charged like an unpaid order's.
    note := format('%s דפים (היו %s). ההזמנה חזרה לבחירת מוצר ותשלום לפי מספר הדפים החדש; אסמכתת ההעברה הקודמת נשמרה — כדאי לבדוק אותה מול הסכום החדש.',
                   p_spread_count, coalesce(o.designed_spread_count, 0));
    update public.album_orders set
      designed_spread_count = p_spread_count,
      workflow_status = 'approved',
      payment_status = 'unpaid',
      portal_token_hash = coalesce(portal_token_hash, p_token_hash),
      updated_at = now()
    where id = o.id returning * into o;
    title := 'הזוג שלח את האלבום מחדש לפני שאישרתם את ההעברה: ' || coalesce(names, 'הזמנת אלבום');
  elsif o.payment_status = 'paid' then
    title := 'הזוג שלח את האלבום מחדש אחרי התשלום: ' || coalesce(names, 'הזמנת אלבום');
    note := format('%s דפים (בהזמנה ששולמה: %s). המחיר לא השתנה, כדאי לבדוק.', p_spread_count, coalesce(o.designed_spread_count, 0));
  else
    title := 'הזוג שלח את האלבום מחדש: ' || coalesce(names, 'הזמנת אלבום');
    note := format('%s דפים (בהזמנה: %s). ההזמנה כבר בשלב "%s", ולכן לא השתנתה — כדאי לבדוק.', p_spread_count, coalesce(o.designed_spread_count, 0), o.workflow_status);
  end if;

  insert into public.notifications (tenant_id, type, title, body, related_album_order_id)
  values (g.tenant_id, 'album_designed_by_couple', title, note, o.id);

  return jsonb_build_object('id', o.id, 'workflowStatus', o.workflow_status, 'created', created, 'joined', joined);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_album_order_state(p_gallery_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g public.films_galleries%rowtype;
  o public.album_orders%rowtype;
  price numeric;
  included integer;
begin
  select * into g from public.films_galleries where id = p_gallery_id;
  if not found or not public.tenant_has_module(g.tenant_id, 'crm') then
    return jsonb_build_object('crm', false);
  end if;
  select a.price into price from public.album_addons a
    where a.tenant_id = g.tenant_id and a.category = 'extra_pages' and a.active
    order by a.sort_order limit 1;
  -- Avira: the album portal includes 30 spreads in every product (album-portal PAGE_BASELINE); Studio Plan reads
  -- album_pricing_settings.included_spreads, which Avira doesn't have.
  included := 30;
  select * into o from public.album_orders where films_gallery_id = p_gallery_id and tenant_id = g.tenant_id;
  return jsonb_build_object(
    'crm', true,
    'extraPagePrice', price,
    'includedSpreads', included,
    'order', case when o.id is null then null else jsonb_build_object(
      'id', o.id,
      'workflowStatus', o.workflow_status,
      'paymentStatus', o.payment_status,
      'tokenHash', o.portal_token_hash,
      'revoked', o.portal_token_revoked_at is not null,
      'spreads', o.designed_spread_count
    ) end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_album_order_confirm_spreads(p_gallery_id text, p_spreads integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g public.films_galleries%rowtype;
  o public.album_orders%rowtype;
begin
  if p_spreads is null or p_spreads < 1 or p_spreads > 200 then
    raise exception 'bad spread count';
  end if;
  select * into g from public.films_galleries where id = p_gallery_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('films_album_order:' || p_gallery_id, 0));
  select * into o from public.album_orders where films_gallery_id = p_gallery_id and tenant_id = g.tenant_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_order');
  end if;
  update public.album_orders set designed_spread_count = p_spreads, updated_at = now() where id = o.id;
  return jsonb_build_object('ok', true, 'id', o.id, 'spreads', p_spreads, 'before', o.designed_spread_count);
end;
$function$;

revoke all on function public.films_album_order_from_design(text, integer, text) from public, anon, authenticated;
revoke all on function public.films_album_order_state(text) from public, anon, authenticated;
revoke all on function public.films_album_order_confirm_spreads(text, integer) from public, anon, authenticated;
grant execute on function public.films_album_order_from_design(text, integer, text) to service_role;
grant execute on function public.films_album_order_state(text) to service_role;
grant execute on function public.films_album_order_confirm_spreads(text, integer) to service_role;
