import { EMAIL, looksLikeName, PHONE, URL } from "@/lib/ai/redact";
import type { Contact } from "./render";

const HEADER_LINES = 8;
/** Contact lines sit right under the name; below them come headings and school lines ("Business School, College Station, TX"). */
const CONTACT_LINES = 3;
/** A separated piece of a contact line that is only "City, ST" (maybe with a ZIP). */
const CITY_STATE = /^([A-Z][A-Za-z.'-]*(?: [A-Z][A-Za-z.'-]*){0,3},\s*[A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/;

/**
 * The resume's contact header (name, email, phone, city, links), read with the same patterns
 * redaction uses, from the top of the resume. It stays on the server and in the user's own
 * downloads; the AI only ever sees the redacted text.
 */
export function extractContact(resumeText: string, accountName?: string | null): Contact {
  const lines = resumeText.split("\n").map((l) => l.trim()).filter(Boolean);
  const header = lines.slice(0, HEADER_LINES).join("\n");
  const first = (re: RegExp, text: string) => text.match(re)?.[0] ?? null;
  const name = lines[0] && looksLikeName(lines[0]) ? lines[0] : accountName?.trim() || null;
  const links = [...new Set(header.match(URL) ?? [])].map((l) => l.replace(/[),.;]+$/, "")).slice(0, 3);
  return {
    name,
    email: first(EMAIL, header) ?? first(EMAIL, resumeText),
    phone: first(PHONE, header),
    location:
      lines
        .slice(0, CONTACT_LINES)
        .flatMap((l) => l.split(/\s*[|•·◦▪]\s*|\s{2,}/))
        .map((piece) => piece.trim().match(CITY_STATE)?.[1])
        .find(Boolean) ?? null,
    links,
  };
}
