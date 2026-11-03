import type { ParsedResume } from "@/lib/tailor/structure";

/** What the parse step's model returns for fake-resume.txt (text copied exactly, as instructed). */
export const parsed: ParsedResume = {
  summary: "Entry-level data analyst who builds SQL reports and Tableau dashboards for operations teams.",
  sections: [
    {
      heading: "Experience",
      kind: "experience",
      items: [],
      entries: [
        {
          title: "Data Analyst Intern",
          org: "Prairie Logistics Co.",
          location: "Springfield, IL",
          dates: "May 2024 - Aug 2024",
          bullets: [
            "Built 6 Tableau dashboards tracking on-time delivery for 3 regional warehouses",
            "Wrote SQL queries in PostgreSQL to cut weekly report preparation from 5 hours to 1 hour",
            "Cleaned shipment data in Excel and Python (pandas) for the monthly operations review",
          ],
        },
        {
          title: "IT Help Desk Assistant",
          org: "Lincoln Valley College",
          location: "Springfield, IL",
          dates: "Sep 2022 - May 2024",
          bullets: [
            "Resolved about 40 tickets a week for students and staff in ServiceNow",
            "Documented password reset and printer setup steps in the knowledge base",
          ],
        },
      ],
    },
    {
      heading: "Education",
      kind: "education",
      items: [],
      entries: [{ title: "B.S. in Information Systems", org: "Lincoln Valley College", location: "Springfield, IL", dates: "May 2024", bullets: [] }],
    },
    {
      heading: "Skills",
      kind: "skills",
      entries: [],
      items: ["SQL", "PostgreSQL", "Tableau", "Excel", "Python", "ServiceNow", "Data Visualization"],
    },
  ],
};
