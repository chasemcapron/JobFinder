import { Body, Column, Container, Head, Heading, Html, Link, Preview, Row, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";
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
 * The app's palette as literal hex values (email clients don't support CSS variables): a charcoal
 * header with the four-colour stripe, flat colour bars for sections, solid score tiles. The body
 * stays light, because many mail apps re-colour or ignore dark backgrounds.
 */
const c = {
  page: "#f4f4f5",
  surface: "#ffffff",
  charcoal: "#1c1c1e",
  charcoalMuted: "#a6a6ad",
  foreground: "#18181b",
  muted: "#5f5f69",
  border: "#e4e4e7",
  blue: "#2f6fe4",
  blueText: "#1d4fb8",
  green: "#34c26b",
  orange: "#f58a2e",
  pink: "#ee4c86",
};

/** Same tiers and fills as the in-app ScoreBadge; charcoal text on each is AA. `text` is the AA colour on white. */
function scoreColors(score: number) {
  const tier = scoreTier(score);
  if (tier === "high") return { fill: "#34c26b", text: "#05603a" };
  if (tier === "mid") return { fill: "#f5c518", text: "#713f12" };
  return { fill: "#f25c5c", text: "#b42318" };
}

const fontFamily = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const caps = { textTransform: "uppercase" as const, letterSpacing: "0.1em", fontWeight: 700, fontSize: 12, lineHeight: "16px" };

function Stripe({ height = 4 }: { height?: number }) {
  return (
    <Row>
      {[c.pink, c.orange, c.blue, c.green].map((color) => (
        <Column key={color} style={{ backgroundColor: color, height, lineHeight: `${height}px`, fontSize: 1 }}>
          &nbsp;
        </Column>
      ))}
    </Row>
  );
}

/** The app's logo: four flat colour squares. */
function Mark() {
  const cell = (color: string) => (
    <td style={{ width: 9, height: 9, backgroundColor: color, borderRadius: 2, fontSize: 1, lineHeight: "9px" }}>&nbsp;</td>
  );
  return (
    <table role="presentation" cellPadding={0} cellSpacing={3} style={{ display: "inline-table", verticalAlign: "middle" }}>
      <tbody>
        <tr>
          {cell(c.pink)}
          {cell(c.orange)}
        </tr>
        <tr>
          {cell(c.blue)}
          {cell(c.green)}
        </tr>
      </tbody>
    </table>
  );
}

/** A flat colour bar with a caps label and a count, as in the app's pipeline columns. */
function Bar({ color, textColor, label, count }: { color: string; textColor: string; label: string; count: number }) {
  return (
    <Section style={{ backgroundColor: color, borderRadius: 8, padding: "7px 14px", margin: "24px 0 12px" }}>
      <Row>
        <Column style={{ ...caps, color: textColor }}>{label}</Column>
        <Column align="right" style={{ ...caps, color: textColor }}>
          {count}
        </Column>
      </Row>
    </Section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <Section style={{ backgroundColor: c.surface, border: `1px solid ${c.border}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
      {children}
    </Section>
  );
}

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
      <Body style={{ backgroundColor: c.page, fontFamily, margin: 0 }}>
        <Container style={{ maxWidth: 600, margin: "0 auto", padding: "24px 12px" }}>
          <Section style={{ backgroundColor: c.charcoal, borderRadius: 14, overflow: "hidden" }}>
            <Stripe />
            <Section style={{ padding: "20px 20px 22px" }}>
              <Row style={{ marginBottom: 14 }}>
                <Column style={{ width: 30, verticalAlign: "middle" }}>
                  <Mark />
                </Column>
                <Column style={{ verticalAlign: "middle", color: "#ffffff", fontSize: 15, lineHeight: "20px", fontWeight: 700 }}>
                  Job Finder
                </Column>
              </Row>
              <Heading as="h1" style={{ fontSize: 24, lineHeight: "30px", margin: "0 0 6px", color: "#ffffff" }}>
                {jobs.length ? "Your top new job matches" : "Time to follow up"}
              </Heading>
              <Text style={{ margin: 0, color: c.charcoalMuted, fontSize: 14, lineHeight: "20px" }}>
                {[dateLabel, ...summary].join(" · ")}
              </Text>
            </Section>
          </Section>

          {jobs.length ? <Bar color={c.blue} textColor="#ffffff" label="New matches" count={jobs.length} /> : null}
          {jobs.map((job, i) => {
            const s = scoreColors(job.score);
            const score = Math.round(job.score);
            return (
              <Card key={i}>
                <Row>
                  <Column style={{ width: 56, verticalAlign: "top" }}>
                    <Text
                      style={{
                        margin: 0,
                        width: 44,
                        height: 44,
                        lineHeight: "44px",
                        textAlign: "center",
                        backgroundColor: s.fill,
                        color: c.charcoal,
                        borderRadius: 8,
                        fontSize: 18,
                        fontWeight: 700,
                      }}
                    >
                      {score}
                    </Text>
                  </Column>
                  <Column style={{ verticalAlign: "top" }}>
                    <Text style={{ margin: 0, fontSize: 16, lineHeight: "22px", fontWeight: 600, color: c.foreground }}>
                      <Link href={job.applyUrl} style={{ color: c.foreground, textDecoration: "none" }}>
                        {job.title}
                      </Link>
                    </Text>
                    <Text style={{ margin: "2px 0 0", fontSize: 14, lineHeight: "20px", color: c.muted }}>
                      <span style={{ color: s.text, fontWeight: 700 }}>{`${score}% match`}</span> · {job.company} · {job.location}
                    </Text>
                    <Text style={{ margin: "10px 0 14px", fontSize: 14, lineHeight: "21px", color: c.foreground }}>{job.reason}</Text>
                    <Link
                      href={job.applyUrl}
                      style={{
                        display: "inline-block",
                        backgroundColor: c.blue,
                        color: "#ffffff",
                        padding: "8px 16px",
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 600,
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
                  </Column>
                </Row>
              </Card>
            );
          })}

          {followUps.length ? (
            <>
              <Bar color={c.orange} textColor={c.charcoal} label="Time to follow up" count={followUps.length} />
              <Text style={{ margin: "0 0 12px", color: c.muted, fontSize: 14, lineHeight: "20px" }}>
                Still marked &ldquo;Applied&rdquo; after a week. A short follow-up note can help; if you&apos;ve heard back, update the
                status so this stops.
              </Text>
              <Card>
                {followUps.map((f, i) => (
                  <Text
                    key={i}
                    style={{
                      margin: 0,
                      padding: i ? "12px 0 0" : 0,
                      borderTop: i ? `1px solid ${c.border}` : undefined,
                      marginTop: i ? 12 : 0,
                      fontSize: 14,
                      lineHeight: "20px",
                      color: c.muted,
                    }}
                  >
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
                    marginTop: 16,
                    border: `1px solid ${c.border}`,
                    color: c.blueText,
                    padding: "7px 14px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Update statuses
                </Link>
              </Card>
            </>
          ) : null}

          <Section style={{ marginTop: 24 }}>
            <Stripe height={3} />
            <Text style={{ fontSize: 12, lineHeight: "18px", color: c.muted, margin: "12px 0 0" }}>
              <Link href={`${appUrl}/jobs`} style={{ color: c.blueText, fontWeight: 600 }}>
                See all matches
              </Link>{" "}
              ·{" "}
              <Link href={`${appUrl}/applications`} style={{ color: c.muted }}>
                Your applications
              </Link>{" "}
              ·{" "}
              <Link href={`${appUrl}/settings`} style={{ color: c.muted }}>
                Turn off this email
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
