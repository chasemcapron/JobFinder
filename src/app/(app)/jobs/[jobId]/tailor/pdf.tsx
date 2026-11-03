"use client";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  COVER_GREETING,
  COVER_SIGN_OFF,
  entryLines,
  itemLines,
  splitLabel,
  type Contact,
  type CoverLetterView,
  type HeaderLine,
  type ResumeView,
} from "@/lib/tailor/render";

/**
 * PDF versions of the tailored resume and cover letter, drawn in the browser by
 * @react-pdf/renderer (loaded only when a download is asked for). The layout copies the owner's
 * own resume, measured from their PDF: Letter, 1-inch sides, Times (the built-in Times-Roman /
 * Bold / Italic, Times New Roman's metrics, so no font files), a 22pt centered name, 11pt bold
 * capital headings over a full-width rule, two-line entry headers with right-aligned places and
 * dates, 10.5pt bullets with an 18pt hanging indent. One column, real text: ATS-friendly.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 72, fontFamily: "Times-Roman", fontSize: 10.5, lineHeight: 1.33, color: "#000" },
  name: { fontFamily: "Times-Bold", fontSize: 22, textAlign: "center", lineHeight: 1.1 },
  contact: { fontSize: 11, textAlign: "center", marginTop: 2 },
  heading: { fontFamily: "Times-Bold", fontSize: 11, marginTop: 8, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: "#000", lineHeight: 1.2 },
  entry: { marginTop: 3 },
  line: { flexDirection: "row", justifyContent: "space-between", fontSize: 11, lineHeight: 1.27 },
  left: { flex: 1, marginRight: 10 },
  right: { flexShrink: 0, textAlign: "right" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontFamily: "Times-Italic" },
  regular: { fontFamily: "Times-Roman" },
  bullet: { flexDirection: "row" },
  dot: { width: 18 },
  bulletText: { flex: 1 },
  skillLine: { marginTop: 1 },
  label: { fontFamily: "Times-Bold", fontSize: 11 },
  para: { marginBottom: 11 },
});

const contactLine = (c: Contact) => [c.location, c.phone, c.email, ...c.links].filter(Boolean).join(" | ");

function Header({ contact }: { contact: Contact }) {
  return (
    <View>
      {contact.name ? <Text style={s.name}>{contact.name}</Text> : null}
      {contactLine(contact) ? <Text style={s.contact}>{contactLine(contact)}</Text> : null}
    </View>
  );
}

function Line({ line }: { line: HeaderLine }) {
  return (
    <View style={s.line}>
      <Text style={[s.left, s[line.leftStyle]]}>{line.left}</Text>
      {line.right ? <Text style={[s.right, s[line.rightStyle]]}>{line.right}</Text> : null}
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
            {itemLines(sec.items).map((item, k) => {
              const { label, text } = splitLabel(item);
              return (
                <Text key={k} style={s.skillLine}>
                  {label ? <Text style={s.label}>{label} </Text> : null}
                  {text}
                </Text>
              );
            })}
            {sec.entries.map((e, j) => (
              <View key={j} style={s.entry} wrap={false}>
                {entryLines(e).map((line, k) => (
                  <Line key={k} line={line} />
                ))}
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
      <Page size="LETTER" style={{ ...s.page, paddingTop: 36, fontSize: 11.5, lineHeight: 1.4 }}>
        <Header contact={view.contact} />
        <View style={{ marginTop: 22 }}>
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
        </View>
      </Page>
    </Document>
  );
}
