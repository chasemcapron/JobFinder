import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import { scoreTier } from "@/components/ui";

export type DigestJob = {
  title: string;
  company: string;
  location: string;
  score: number;
  reason: string;
  applyUrl: string;
  /** Adzuna's terms require an "Adzuna" link on every ad shown */
  adzunaAttributionUrl: string | null;
};

/** An application still marked "applied" a week later. */
export type DigestFollowUp = {
  title: string;
  company: string;
  /** e.g. "Applied Oct 13 · 8 days ago" */
  appliedLabel: string;
  applyUrl: string;
};

/*
 * Email clients don't support CSS variables, so these are the light-theme tokens from
 * globals.css as literal hex values.
 */
const c = {
  background: "#f7f7f8",
  surface: "#ffffff",
  foreground: "#18181b",
  muted: "#5f5f69",
  border: "#e4e4e7",
  accent: "#4f46e5",
  accentText: "#3f37c9",
  accentForeground: "#ffffff",
};

/** Same tiers as the in-app ScoreBadge: green strong, yellow medium, red weak (text pairs are AA). */
function scoreColors(score: number) {
  const tier = scoreTier(score);
  if (tier === "high") return { bg: "#ecfdf3", fg: "#05603a", border: "#abefc6" };
  if (tier === "mid") return { bg: "#fef9c3", fg: "#713f12", border: "#fde68a" };
  return { bg: "#fef3f2", fg: "#b42318", border: "#fecdca" };
}

const fontFamily = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function MorningDigestEmail({
  jobs,
  followUps = [],
  dateLabel,
  appUrl,
}: {
  jobs: DigestJob[];
  followUps?: DigestFollowUp[];
  dateLabel: string;
  appUrl: string;
}) {
  const followUpCount = `${followUps.length} application${followUps.length === 1 ? "" : "s"} to follow up`;
  const preview = jobs.length
    ? `${jobs.length} new match${jobs.length === 1 ? "" : "es"}: ${jobs[0].title} at ${jobs[0].company}`
    : `${followUpCount}: ${followUps[0]?.title ?? ""} at ${followUps[0]?.company ?? ""}`;
  const summary = [
    jobs.length ? `${jobs.length} new ${jobs.length === 1 ? "match" : "matches"}` : null,
    followUps.length ? followUpCount : null,
  ].filter(Boolean);
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: c.background, fontFamily, margin: 0 }}>
        <Container style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px" }}>
          <Text style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: c.accentText, letterSpacing: "0.02em" }}>
            Job Finder
          </Text>
          <Heading as="h1" style={{ fontSize: 22, lineHeight: "28px", margin: "0 0 4px", color: c.foreground }}>
            {jobs.length ? "Your top new job matches" : "Time to follow up"}
          </Heading>
          <Text style={{ margin: "0 0 20px", color: c.muted, fontSize: 14, lineHeight: "20px" }}>
            {[dateLabel, ...summary].join(" · ")}
          </Text>
          {jobs.map((job, i) => {
            const s = scoreColors(job.score);
            return (
              <Section
                key={i}
                style={{
                  backgroundColor: c.surface,
                  border: `1px solid ${c.border}`,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    display: "inline-block",
                    margin: "0 0 8px",
                    padding: "2px 10px",
                    backgroundColor: s.bg,
                    border: `1px solid ${s.border}`,
                    borderRadius: 6,
                    color: s.fg,
                    fontSize: 13,
                    lineHeight: "20px",
                    fontWeight: 700,
                  }}
                >
                  {`${Math.round(job.score)}% match`}
                </Text>
                <Text style={{ margin: 0, fontSize: 17, lineHeight: "23px", fontWeight: 600, color: c.foreground }}>
                  <Link href={job.applyUrl} style={{ color: c.foreground, textDecoration: "none" }}>
                    {job.title}
                  </Link>
                </Text>
                <Text style={{ margin: "2px 0 0", fontSize: 14, lineHeight: "20px", color: c.muted }}>
                  {job.company} · {job.location}
                </Text>
                <Text style={{ margin: "12px 0 14px", fontSize: 14, lineHeight: "21px", color: c.foreground }}>{job.reason}</Text>
                <Link
                  href={job.applyUrl}
                  style={{
                    display: "inline-block",
                    backgroundColor: c.accent,
                    color: c.accentForeground,
                    padding: "8px 16px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  View and apply
                </Link>
                {job.adzunaAttributionUrl ? (
                  <Text style={{ margin: "12px 0 0", fontSize: 12, color: c.muted }}>
                    <Link href={job.adzunaAttributionUrl} style={{ color: c.muted }}>
                      Jobs by Adzuna
                    </Link>
                  </Text>
                ) : null}
              </Section>
            );
          })}
          {followUps.length ? (
            <>
              {jobs.length ? (
                <Heading as="h2" style={{ fontSize: 17, lineHeight: "23px", margin: "24px 0 4px", color: c.foreground }}>
                  Time to follow up
                </Heading>
              ) : null}
              <Text style={{ margin: "0 0 12px", color: c.muted, fontSize: 14, lineHeight: "20px" }}>
                Still marked &ldquo;Applied&rdquo; after a week. A short follow-up note can help; if you&apos;ve heard back, update the
                status so this stops.
              </Text>
              <Section
                style={{ backgroundColor: c.surface, border: `1px solid ${c.border}`, borderRadius: 12, padding: 16, marginBottom: 12 }}
              >
                {followUps.map((f, i) => (
                  <Text key={i} style={{ margin: i ? "12px 0 0" : 0, fontSize: 14, lineHeight: "20px", color: c.muted }}>
                    <Link href={f.applyUrl} style={{ color: c.foreground, fontWeight: 600, textDecoration: "none" }}>
                      {f.title}
                    </Link>
                    <br />
                    {f.company} · {f.appliedLabel}
                  </Text>
                ))}
                <Link
                  href={`${appUrl}/applications`}
                  style={{
                    display: "inline-block",
                    marginTop: 14,
                    border: `1px solid ${c.border}`,
                    color: c.accentText,
                    padding: "7px 14px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  Update statuses
                </Link>
              </Section>
            </>
          ) : null}
          <Hr style={{ borderColor: c.border, margin: "20px 0" }} />
          <Text style={{ fontSize: 12, color: c.muted, margin: 0 }}>
            <Link href={`${appUrl}/jobs`} style={{ color: c.accentText, fontWeight: 500 }}>
              See all matches
            </Link>{" "}
            ·{" "}
            <Link href={`${appUrl}/settings`} style={{ color: c.muted }}>
              Turn off this email
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
