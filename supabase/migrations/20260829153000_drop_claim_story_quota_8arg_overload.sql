-- One definition, one gate. The 8-argument overload predates the voice
-- parameter and was still callable, so a caller that omitted the voice silently
-- resolved to a DIFFERENT function body — and "which one ran" becomes a question
-- you have to answer at 2am. It also wrote stories without a voice_id, relying
-- on the column default rather than the claim's own decision.
drop function if exists public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, text
);
