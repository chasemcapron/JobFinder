import { finalizeJob } from "../normalize";
import type { NormalizedJob } from "../types";

/**
 * Sample postings (fictional companies) used when MOCK_JOBS=true, or when there's nothing
 * real to query (no target companies and no keyed sources). Lets the whole flow be exercised offline.
 */
const SAMPLES: [title: string, company: string, location: string, remote: boolean, daysAgo: number, salary: [number, number] | null, desc: string][] = [
  ["Senior Backend Engineer", "Acme Payments", "Chicago, IL", false, 1, [165000, 210000], "Build payment APIs in TypeScript and Node.js on AWS. PostgreSQL, Kafka, Kubernetes. 5+ years of backend experience."],
  ["Software Engineer II, Platform", "Northwind Data", "Remote - US", true, 2, [130000, 160000], "Own internal platform services in Python and Go. Terraform, Docker, Kubernetes, GitHub Actions. Distributed systems experience a plus."],
  ["Staff Data Engineer", "Globex Analytics", "New York, NY", false, 3, [200000, 250000], "Lead data pipeline architecture with Airflow, Spark, dbt and Snowflake. Mentor engineers. SQL and Python expert."],
  ["Frontend Engineer (React)", "Initech", "Austin, TX", false, 4, [120000, 150000], "Ship product UI in React, Next.js and TypeScript. Tailwind CSS, accessibility, testing with Vitest and Playwright."],
  ["Junior Software Developer", "Umbrella Health", "Remote", true, 5, [80000, 95000], "Entry-level role on a healthcare team. JavaScript, React, REST APIs. New grads welcome."],
  ["Engineering Manager, Payments", "Acme Payments", "San Francisco, CA", false, 6, [230000, 280000], "Manage a team of 8 engineers building payment reconciliation. Background in backend systems, payments, and hiring."],
  ["Machine Learning Engineer", "Hooli", "Seattle, WA", false, 7, null, "Train and deploy models with PyTorch. Python, MLOps, AWS SageMaker, LLM fine-tuning."],
  ["DevOps Engineer", "Stark Logistics", "Denver, CO", false, 8, [125000, 155000], "CI/CD with Jenkins and GitHub Actions, AWS, Terraform, Kubernetes, observability with Datadog and Prometheus."],
  ["Senior Product Designer", "Pied Piper", "London, England", false, 9, null, "Design end-to-end product experiences in Figma. UX research, prototyping, design systems."],
  ["Software Engineering Intern", "Wayne Industries", "Chicago, IL", false, 10, null, "Summer internship. Java or Python, data structures, algorithms. Students graduating 2027-2028."],
  ["Senior Full Stack Engineer", "Vandelay Industries", "Remote (Canada)", true, 12, [150000, 180000], "Node.js, React, PostgreSQL, Redis. Build B2B SaaS features end to end. 5+ years experience."],
  ["Data Analyst", "Soylent Foods", "Chicago, IL", false, 15, [75000, 95000], "SQL, Tableau, Excel, A/B testing. Partner with marketing on reporting."],
];

export function mockJobs(now = new Date()): NormalizedJob[] {
  return SAMPLES.map(([title, company, location, remote, daysAgo, salary, desc], i) =>
    finalizeJob({
      source: "mock",
      externalId: `sample-${i + 1}`,
      title,
      company,
      locationRaw: location,
      remote,
      description: `${desc}\n\n(Sample posting — set MOCK_JOBS=false and add target companies for real results.)`,
      applyUrl: `https://example.com/jobs/sample-${i + 1}`,
      postedAt: new Date(now.getTime() - daysAgo * 86_400_000),
      salaryMin: salary?.[0] ?? null,
      salaryMax: salary?.[1] ?? null,
      salaryCurrency: salary ? "USD" : null,
    }),
  );
}
