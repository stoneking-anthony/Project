-- The spine. See docs/SPINE.md. Safe to run on every start: everything is idempotent.

create table if not exists events (
  id           uuid primary key,
  kind         text        not null,
  v            int         not null default 1,
  occurred_at  timestamptz not null,
  tz           text        not null,
  recorded_at  timestamptz not null default clock_timestamp(),
  payload      jsonb       not null,
  source       text        not null,
  source_ref   text,
  corrects     uuid references events(id),
  redacted_at  timestamptz,
  unique (source, source_ref)
);
create index if not exists events_kind_time on events (kind, occurred_at);
create index if not exists events_corrects on events (corrects) where corrects is not null;
create index if not exists events_payload on events using gin (payload jsonb_path_ops);

create table if not exists sources (
  name          text primary key,
  expect        text not null,
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz
);

create table if not exists standard (
  id         bigserial primary key,
  key        text not null,
  text       text not null,
  written_at timestamptz not null default clock_timestamp()
);
create index if not exists standard_key on standard (key, written_at desc);

-- Append-only, enforced here rather than by discipline. The single exception is
-- redact(), which may blank a payload and nothing else.
create or replace function spine_block_writes() returns trigger language plpgsql as $$
begin
  -- Nested: plpgsql doesn't short-circuit AND, and `standard` rows have no `kind`.
  if tg_op = 'UPDATE' and tg_table_name = 'events' and current_setting('spine.redacting', true) = 'on' then
    if new.id = old.id and new.kind = old.kind and new.occurred_at = old.occurred_at
       and new.source = old.source and new.corrects is not distinct from old.corrects
       and new.redacted_at is not null then
      return new;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name;
end $$;

drop trigger if exists events_append_only on events;
create trigger events_append_only before update or delete on events
  for each row execute function spine_block_writes();
drop trigger if exists events_no_truncate on events;
create trigger events_no_truncate before truncate on events
  for each statement execute function spine_block_writes();
drop trigger if exists standard_append_only on standard;
create trigger standard_append_only before update or delete on standard
  for each row execute function spine_block_writes();
drop trigger if exists standard_no_truncate on standard;
create trigger standard_no_truncate before truncate on standard
  for each statement execute function spine_block_writes();

-- The one escape hatch: blanks a payload and records when. Logged by the caller.
create or replace function redact(target uuid) returns void language plpgsql as $$
begin
  perform set_config('spine.redacting', 'on', true);
  update events set payload = '{"redacted": true}'::jsonb, redacted_at = clock_timestamp() where id = target;
  perform set_config('spine.redacting', 'off', true);
end $$;

-- An event is live unless something corrects it. When two corrections target the
-- same event (two offline devices), the latest recorded_at wins. Retractions and
-- redacted events are never live.
create or replace view live as
  select e.* from events e
  where not exists (select 1 from events c where c.corrects = e.id)
    and not (e.corrects is not null and exists (
      select 1 from events s
      where s.corrects = e.corrects and s.id <> e.id
        and (s.recorded_at, s.id) > (e.recorded_at, e.id)))
    and not (e.payload ? 'retract')
    and e.redacted_at is null;

-- Corrections that lost to a later sibling, for a "conflicts" review list.
create or replace view correction_conflicts as
  select e.corrects as target, e.id as losing_id, e.recorded_at
  from events e
  where e.corrects is not null and exists (
    select 1 from events s
    where s.corrects = e.corrects and s.id <> e.id
      and (s.recorded_at, s.id) > (e.recorded_at, e.id));
