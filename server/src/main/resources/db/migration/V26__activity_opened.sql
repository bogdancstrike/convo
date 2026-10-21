-- "Used Convo that day" next to encrypted items: set by the first authenticated request of a
-- device on a UTC day (any platform), plus which platforms were used. Still counts/flags only.
ALTER TABLE account_activity_daily
    ADD COLUMN opened  boolean NOT NULL DEFAULT false,
    ADD COLUMN web     boolean NOT NULL DEFAULT false,
    ADD COLUMN android boolean NOT NULL DEFAULT false;
-- Days on which an account only opened the app (no items sent) start with zero items.
ALTER TABLE account_activity_daily ALTER COLUMN items SET DEFAULT 0;
