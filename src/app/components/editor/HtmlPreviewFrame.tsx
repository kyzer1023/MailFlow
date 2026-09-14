import { buildPreviewSrcDoc } from "../../../client";

export function HtmlPreviewFrame({
  bodyHtml,
  title,
}: {
  readonly bodyHtml: string;
  readonly title: string;
}) {
  return (
    <iframe
      className="html-preview-frame"
      title={title}
      sandbox=""
      srcDoc={buildPreviewSrcDoc(bodyHtml)}
      tabIndex={-1}
    />
  );
}
