-- Persist the Microsoft Graph importance selected for every resolved message.
ALTER TABLE recipient_jobs
ADD COLUMN importance TEXT NOT NULL DEFAULT 'normal'
CHECK (importance IN ('low', 'normal', 'high'));
