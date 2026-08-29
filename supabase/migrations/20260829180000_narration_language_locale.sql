-- `narrations.language` is typed `StoryLocale` in the contract ('en-GB',
-- 'el-GR', …) but the column is free text, and every narration written before
-- 20260829160000_story_locale.sql stored the bare language subtag ('en').
--
-- The consequence was not cosmetic. `StoryDetailDto` parses the response in the
-- app, so `language: 'en'` failed the enum and `getStory` threw for five of the
-- eight stories in the account — the reader rendered "We couldn't open this
-- story." for a book that was complete, illustrated and narrated on the server.
-- A story a family already made is the one thing in this product that must
-- never become unopenable.
--
-- Backfill the rows, then constrain the column so a bare subtag cannot be
-- written again. The worker already writes `job.locale`; the check is what
-- makes that a guarantee rather than a habit.

update public.narrations set language = 'en-GB' where language = 'en';
update public.narrations set language = 'es-ES' where language = 'es';
update public.narrations set language = 'de-DE' where language = 'de';
update public.narrations set language = 'fr-FR' where language = 'fr';
update public.narrations set language = 'it-IT' where language = 'it';
update public.narrations set language = 'el-GR' where language = 'el';
update public.narrations set language = 'nl-NL' where language = 'nl';

alter table public.narrations
  add constraint narrations_language_is_locale
  check (language in ('en-GB', 'es-ES', 'de-DE', 'fr-FR', 'it-IT', 'el-GR', 'nl-NL'));
