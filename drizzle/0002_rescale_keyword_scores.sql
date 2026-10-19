-- Keyword scores are now calibrated (calibrateKeywordScore in src/lib/jobs/scoring.ts):
-- raw 0-75 maps to 0-95, and anything above eases from 95 toward 100. Rescale stored keyword
-- scores once so existing matches use the new scale before the next refresh recomputes them.
UPDATE "job_matches" SET "keyword_score" = LEAST(100, ROUND(CASE WHEN "keyword_score" <= 75 THEN "keyword_score" * 95.0 / 75 ELSE 95 + ("keyword_score" - 75) * 5.0 / 35 END));
--> statement-breakpoint
UPDATE "job_matches" SET "score" = LEAST(100, ROUND(CASE WHEN "score" <= 75 THEN "score" * 95.0 / 75 ELSE 95 + ("score" - 75) * 5.0 / 35 END)) WHERE "ai_scored" = false;
