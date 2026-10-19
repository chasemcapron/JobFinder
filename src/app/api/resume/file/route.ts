import { getSavedResume } from "@/lib/resume/file-store";
import { currentUserId } from "@/lib/session";

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/** The signed-in user's saved resume file. Inline for the PDF preview; `?download=1` saves it. */
export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return new Response("Not signed in", { status: 401 });
  const file = await getSavedResume(userId);
  if (!file) return new Response("No resume file saved", { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const asciiName = file.fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": MIME[file.kind],
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
