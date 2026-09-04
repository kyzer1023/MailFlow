/** The declared Content-Length is only an early hint; count the actual stream. */
export class RequestBodyTooLarge extends Error {}

export async function boundedMultipartForm(request: Request, maxBytes: number): Promise<FormData> {
  if (Number(request.headers.get("Content-Length")) > maxBytes) throw new RequestBodyTooLarge();
  if (!request.body) throw new Error("Missing multipart body");
  let size = 0;
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new RequestBodyTooLarge();
      controller.enqueue(chunk);
    },
  }));
  return new Response(bounded, { headers: { "Content-Type": request.headers.get("Content-Type") ?? "" } }).formData();
}
