-- Sponsored advert impressions: per-member, per-advert, per-day counter.
-- Served impressions are counted server-side at feed render so refreshes or
-- multiple devices cannot bypass the daily cap (two appearances by default).
CREATE TABLE IF NOT EXISTS advert_impressions (
  advert_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  day TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (advert_id, member_id, day)
);
CREATE INDEX IF NOT EXISTS idx_advert_impressions_member_day ON advert_impressions (member_id, day);
