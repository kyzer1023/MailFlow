import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createAttachmentSet,
  uploadAttachmentFile,
  deleteAttachmentFile,
  type AttachmentSetResponse,
  type AttachmentFileResponse,
} from "../api";
import { useDraftAttachments } from "./use-draft-attachments";

vi.mock("../api", () => ({
  createAttachmentSet: vi.fn(),
  uploadAttachmentFile: vi.fn(),
  deleteAttachmentFile: vi.fn(),
}));
const setResponse = (id: string) =>
  ({ attachmentSet: { id } }) as AttachmentSetResponse;
const uploaded = (id: string) =>
  ({
    file: {
      id,
      originalFilename: "agenda.txt",
      mediaType: "text/plain",
      byteSize: 6,
    },
  }) as AttachmentFileResponse;
const local = (id: string) => ({
  id,
  name: "agenda.txt",
  mediaType: "text/plain",
  byteSize: 6,
  status: "uploading" as const,
});
function file() {
  const source = new File(["Agenda"], "agenda.txt", { type: "text/plain" });
  Object.defineProperty(source, "arrayBuffer", {
    value: async () => Uint8Array.from([65, 103, 101, 110, 100, 97]).buffer,
  });
  return source;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.mocked(createAttachmentSet).mockResolvedValue(setResponse("set-1"));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("serializes uploads and reuses one attachment set", async () => {
  const first = deferred<AttachmentFileResponse>();
  vi.mocked(uploadAttachmentFile)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(uploaded("server-2"));
  const { result } = renderHook(() => useDraftAttachments("csrf", false));
  let pending!: Promise<void>;
  act(() => {
    result.current.setAttachments([local("first"), local("second")]);
    void result.current.uploadAttachment("first", file());
    pending = result.current.uploadAttachment("second", file());
  });
  await waitFor(() => expect(uploadAttachmentFile).toHaveBeenCalledTimes(1));
  expect(createAttachmentSet).toHaveBeenCalledTimes(1);
  expect(result.current.attachmentsReady).toBe(false);
  await act(async () => {
    first.resolve(uploaded("server-1"));
    await pending;
  });
  expect(uploadAttachmentFile).toHaveBeenCalledTimes(2);
  expect(createAttachmentSet).toHaveBeenCalledTimes(1);
  expect(result.current.attachments.map((item) => item.id)).toEqual([
    "server-1",
    "server-2",
  ]);
  expect(result.current.attachmentsReady).toBe(true);
});

it("retries failed uploads with retained bytes, then releases them on success", async () => {
  vi.mocked(uploadAttachmentFile)
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce(uploaded("server-1"));
  const { result } = renderHook(() => useDraftAttachments("csrf", false));
  const source = file();
  act(() => result.current.setAttachments([local("local-1")]));
  await act(async () => {
    await result.current.uploadAttachment("local-1", source);
  });
  expect(result.current.attachments[0].error).toBe("Connection lost");
  act(() => result.current.retryAttachment("local-1"));
  await waitFor(() => expect(result.current.attachmentsReady).toBe(true));
  expect(vi.mocked(uploadAttachmentFile).mock.calls[1][1]).toBe(source);
  act(() => result.current.retryAttachment("local-1"));
  expect(uploadAttachmentFile).toHaveBeenCalledTimes(2);
});

it("discards old set creation and queued uploads when a new draft begins", async () => {
  const oldSet = deferred<AttachmentSetResponse>();
  vi.mocked(createAttachmentSet)
    .mockReturnValueOnce(oldSet.promise)
    .mockResolvedValueOnce(setResponse("set-2"));
  vi.mocked(uploadAttachmentFile).mockResolvedValue(uploaded("new-server"));
  const { result } = renderHook(() => useDraftAttachments("csrf", false));
  const originalKey = result.current.attachmentSetRequestKey;
  let oldQueue!: Promise<void>;
  act(() => {
    result.current.setAttachments([local("old-1"), local("old-2")]);
    void result.current.uploadAttachment("old-1", file());
    oldQueue = result.current.uploadAttachment("old-2", file());
  });
  await waitFor(() => expect(createAttachmentSet).toHaveBeenCalledTimes(1));
  act(() => result.current.resetAttachmentState());
  expect(result.current.attachmentSetRequestKey).not.toBe(originalKey);
  act(() => result.current.setAttachments([local("new")]));
  await act(async () => {
    await result.current.uploadAttachment("new", file());
  });
  await act(async () => {
    oldSet.resolve(setResponse("set-old"));
    await oldQueue;
  });
  expect(uploadAttachmentFile).toHaveBeenCalledTimes(1);
  expect(result.current.attachmentSetId).toBe("set-2");
  expect(result.current.attachments.map((item) => item.id)).toEqual([
    "new-server",
  ]);
});

it("ignores an old upload result after reset and blocks removal after preparation", async () => {
  const response = deferred<AttachmentFileResponse>();
  vi.mocked(uploadAttachmentFile).mockReturnValueOnce(response.promise);
  const { result, rerender } = renderHook(
    ({ prepared }) => useDraftAttachments("csrf", prepared),
    { initialProps: { prepared: false } },
  );
  let pending!: Promise<void>;
  act(() => {
    result.current.setAttachments([local("old")]);
    pending = result.current.uploadAttachment("old", file());
  });
  await waitFor(() => expect(uploadAttachmentFile).toHaveBeenCalledTimes(1));
  act(() => {
    result.current.resetAttachmentState();
    result.current.setAttachments([{ ...local("new"), status: "ready" }]);
  });
  await act(async () => {
    response.resolve(uploaded("old-server"));
    await pending;
  });
  expect(result.current.attachments.map((item) => item.id)).toEqual(["new"]);
  rerender({ prepared: true });
  await act(async () => {
    await result.current.removeAttachment("new");
  });
  expect(deleteAttachmentFile).not.toHaveBeenCalled();
  expect(result.current.attachments).toHaveLength(1);
});
