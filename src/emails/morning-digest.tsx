import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

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

export function MorningDigestEmail({ jobs, dateLabel, appUrl }: { jobs: DigestJob[]; dateLabel: string; appUrl: string }) {
  const preview = `${jobs.length} new match${jobs.length === 1 ? "" : "es"}: ${jobs[0]?.title ?? ""} at ${jobs[0]?.company ?? ""}`;
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f8fafc", fontFamily: "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif", margin: 0 }}>
        <Container style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px" }}>
          <Heading as="h1" style={{ fontSize: 22, margin: "0 0 4px", color: "#0f172a" }}>
            Your top new job matches
          </Heading>
          <Text style={{ margin: "0 0 16px", color: "#64748b", fontSize: 14 }}>{dateLabel}</Text>
          {jobs.map((job, i) => (
            <Section
              key={i}
              style={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 12 }}
            >
              <Text style={{ margin: 0, fontSize: 12, fontWeight: 700, color: job.score >= 75 ? "#047857" : job.score >= 55 ? "#1d4ed8" : "#b45309" }}>
                {`${job.score}% match`}
              </Text>
              <Text style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600, color: "#0f172a" }}>
                <Link href={job.applyUrl} style={{ color: "#0f172a", textDecoration: "none" }}>
                  {job.title}
                </Link>
              </Text>
              <Text style={{ margin: "2px 0 8px", fontSize: 14, color: "#475569" }}>
                {job.company} · {job.location}
              </Text>
              <Text style={{ margin: "0 0 12px", fontSize: 14, color: "#334155" }}>{job.reason}</Text>
              <Link
                href={job.applyUrl}
                style={{ backgroundColor: "#2563eb", color: "#ffffff", padding: "8px 14px", borderRadius: 6, fontSize: 14, textDecoration: "none" }}
              >
                Apply
              </Link>
              {job.adzunaAttributionUrl ? (
                <Text style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b" }}>
                  <Link href={job.adzunaAttributionUrl} style={{ color: "#64748b" }}>
                    Jobs by Adzuna
                  </Link>
                </Text>
              ) : null}
            </Section>
          ))}
          <Hr style={{ borderColor: "#e2e8f0", margin: "20px 0" }} />
          <Text style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
            <Link href={`${appUrl}/jobs`} style={{ color: "#2563eb" }}>
              See all matches
            </Link>{" "}
            ·{" "}
            <Link href={`${appUrl}/settings`} style={{ color: "#64748b" }}>
              Turn off this email
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
