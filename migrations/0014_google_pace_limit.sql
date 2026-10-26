DROP TRIGGER campaigns_google_pace;
CREATE TRIGGER campaigns_google_pace BEFORE INSERT ON campaigns
WHEN NEW.provider = 'google' AND NEW.pace_per_minute > 12
BEGIN SELECT RAISE(ABORT, 'Gmail pace exceeds safety ceiling'); END;
