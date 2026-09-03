import { FilePdf, FileText, FileXls, Files } from "@phosphor-icons/react";

export interface AttachmentIconProps {
  readonly mediaType: string;
}

export function AttachmentIcon({ mediaType }: AttachmentIconProps) {
  if (mediaType === "application/pdf") return <FilePdf weight="duotone" />;
  if (mediaType.includes("spreadsheet") || mediaType.includes("excel") || mediaType.endsWith("/csv")) return <FileXls weight="duotone" />;
  if (mediaType.startsWith("text/") || mediaType.includes("word") || mediaType.includes("presentation")) return <FileText weight="duotone" />;
  return <Files weight="duotone" />;
}
