"use client";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { COVER_GREETING, COVER_SIGN_OFF, itemLines, type Contact, type CoverLetterView, type ResumeView } from "@/lib/tailor/render";

/**
 * PDF versions of the tailored resume and cover letter, drawn in the browser by
 * @react-pdf/renderer (loaded only when a download is asked for). ATS-friendly: one column,
 * Helvetica (built in, so no font files), selectable text, standard headings, no tables or images.
 */

const s = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 48, fontFamily: "Helvetica", fontSize: 10.5, lineHeight: 1.35, color: "#111" },
  name: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "center" },
  contact: { textAlign: "center", marginTop: 3, marginBottom: 8, color: "#333" },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 10, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 0.75, borderBottomColor: "#999" },
  entryHead: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  // A long degree or project name wraps instead of running into the dates.
  entryLead: { fontFamily: "Helvetica-Bold", flex: 1, marginRight: 10 },
  entryDates: { flexShrink: 0 },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique", color: "#333" },
  bullet: { flexDirection: "row", marginLeft: 8, marginTop: 1.5 },
  dot: { width: 10 },
  bulletText: { flex: 1 },
  para: { marginBottom: 10 },
});

const contactLine = (c: Contact) => [c.location, c.phone, c.email, ...c.links].filter(Boolean).join("  |  ");

function Header({ contact }: { contact: Contact }) {
  return (
    <View>
      {contact.name ? <Text style={s.name}>{contact.name}</Text> : null}
      {contactLine(contact) ? <Text style={s.contact}>{contactLine(contact)}</Text> : null}
    </View>
  );
}

export function ResumePdf({ view }: { view: ResumeView }) {
  return (
    <Document title="Resume" creator="Job Finder" producer="Job Finder">
      <Page size="LETTER" style={s.page}>
        <Header contact={view.contact} />
        {view.summary ? (
          <View>
            <Text style={s.heading}>SUMMARY</Text>
            <Text>{view.summary}</Text>
          </View>
        ) : null}
        {view.sections.map((sec, i) => (
          <View key={i}>
            <Text style={s.heading}>{sec.heading.toUpperCase()}</Text>
            {itemLines(sec.items).map((line, k) => (
              <Text key={k}>{line}</Text>
            ))}
            {sec.entries.map((e, j) => (
              <View key={j} wrap={false}>
                {[e.title, e.org].some(Boolean) || e.dates ? (
                  <View style={s.entryHead}>
                    <Text style={s.entryLead}>{[e.title, e.org].filter(Boolean).join(", ")}</Text>
                    {e.dates ? <Text style={s.entryDates}>{e.dates}</Text> : null}
                  </View>
                ) : null}
                {e.location ? <Text style={s.italic}>{e.location}</Text> : null}
                {e.bullets.map((b, k) => (
                  <View key={k} style={s.bullet}>
                    <Text style={s.dot}>•</Text>
                    <Text style={s.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export function CoverLetterPdf({ view }: { view: CoverLetterView }) {
  return (
    <Document title="Cover letter" creator="Job Finder" producer="Job Finder">
      <Page size="LETTER" style={{ ...s.page, fontSize: 11, lineHeight: 1.45 }}>
        <Header contact={view.contact} />
        <Text style={s.para}>{view.date}</Text>
        <Text style={s.para}>{`Re: ${view.role}, ${view.company}`}</Text>
        <Text style={s.para}>{COVER_GREETING}</Text>
        {view.paragraphs.map((p, i) => (
          <Text key={i} style={s.para}>
            {p}
          </Text>
        ))}
        <Text>{COVER_SIGN_OFF}</Text>
        {view.contact.name ? <Text>{view.contact.name}</Text> : null}
      </Page>
    </Document>
  );
}
