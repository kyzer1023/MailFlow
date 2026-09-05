/* Synthetic, browser-only fixture loaded by the ignored local preview entry.
   This is never imported by the application or included in a production build. */
(() => {
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("Local preview only");
  const nativeFetch = window.fetch.bind(window);
  const now = "2026-09-05T00:00:00.000Z";
  const config = { toField: "email", ccField: null, bccField: null, replyToField: null, ccFixed: null, bccFixed: null, replyToFixed: null, importance: "normal", separator: "auto", placeholderMappings: { name: "name", session: "session" } };
  const templates = [
    { id: "flow-workshop", name: "Workshop invitation", body: "<p>Hi {{name}},</p><p>You’re invited to our workshop. Your session is {{session}}.</p><p>We look forward to seeing you.</p><p>Best regards,<br>The organising team</p>", subject: "You’re invited to our workshop" },
    { id: "flow-venue", name: "Event reminder", body: "<p>Hi {{name}},</p><p>Your session is {{session}} at {{venue}}.</p><p>See you there!</p>", subject: "Your event reminder" },
  ];
  const flows = templates.map((item) => ({ id: item.id, ownerUserId: "preview-user", societyName: null, name: item.name, currentTemplateVersionId: item.id + "-v1", state: "active", createdAt: now, updatedAt: now }));
  const versions = templates.map((item) => ({ id: item.id + "-v1", flowId: item.id, version: 1, subjectTemplate: item.subject, bodyHtml: item.body, recipientConfiguration: config, placeholderManifest: item.id === "flow-venue" ? ["name", "session", "venue"] : ["name", "session"], createdAt: now }));
  const counts = { pending: 0, claimed: 0, sending: 0, accepted: 0, failed: 0, skipped: 0, unknown: 0 };
  const campaigns = [];
  const sets = [];
  const json = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
  window.fetch = async (url, options = {}) => {
    const path = new URL(typeof url === "string" ? url : url.url, location.origin).pathname;
    if (!path.startsWith("/api/")) return nativeFetch(url, options);
    const method = options.method || "GET";
    const body = typeof options.body === "string" ? JSON.parse(options.body) : null;
    if (path === "/api/me") return json({ user: { id: "preview-user", displayName: "Preview member", principalName: "member@student.example", mailboxAddress: "member@student.example" }, csrfToken: "synthetic-local-csrf", config: { defaultPacePerMinute: 12, maxCampaignRecipients: 300, mailTransport: "smtp", attachmentsEnabled: true } });
    if (path === "/api/flows" && method === "GET") return json({ flows });
    if (path === "/api/flows" && method === "POST") {
      if (flows.some((flow) => flow.name.toLowerCase() === body.name.toLowerCase())) return json({ error: { code: "flow_name_conflict", message: "A template already has this name. Choose another name." } }, 409);
      const id = crypto.randomUUID();
      const version = body.bodyHtml ? { ...body, id: id + "-v1", flowId: id, version: 1, createdAt: now } : null;
      const flow = { ...flows[0], id, name: body.name, currentTemplateVersionId: version?.id || null };
      flows.push(flow); if (version) versions.push(version);
      return json({ flow, templateVersion: version }, 201);
    }
    const flowMatch = path.match(/^\/api\/flows\/([^/]+)(\/versions)?$/);
    if (flowMatch) {
      const flow = flows.find((item) => item.id === flowMatch[1]);
      if (!flow) return json({ error: { message: "Template not found." } }, 404);
      if (method === "PATCH") { Object.assign(flow, body); return json({ flow }); }
      if (flowMatch[2] && method === "POST") { const version = { ...body, id: crypto.randomUUID(), flowId: flow.id, version: 2, createdAt: now }; versions.push(version); flow.currentTemplateVersionId = version.id; return json({ version }, 201); }
      return json({ flow, templateVersion: versions.find((version) => version.id === flow.currentTemplateVersionId) || null });
    }
    if (path === "/api/attachment-sets" && method === "POST") {
      const attachmentSet = { id: crypto.randomUUID(), state: "open", fileCount: 0, totalBytes: 0, campaignId: null, createdAt: now };
      sets.push(attachmentSet); return json({ attachmentSet }, 201);
    }
    if (/^\/api\/attachment-sets\/[^/]+\/files$/.test(path) && method === "POST") {
      const source = options.body.get("file");
      return json({ file: { id: crypto.randomUUID(), originalFilename: source.name, mediaType: source.type, byteSize: source.size, sha256: "synthetic", status: "ready" } });
    }
    if (path.startsWith("/api/attachment-sets/") && method === "DELETE") return new Response(null, { status: 204 });
    if (path === "/api/campaigns" && method === "GET") return json({ campaigns });
    // Prevent all provider-bound actions in this visual fixture.
    if (/\/(test-send|start|resume)$/.test(path)) return json({ error: { code: "preview_only", message: "This is a synthetic preview. No mail is sent." } }, 409);
    if (path === "/api/campaigns" && method === "POST") {
      const existing = campaigns.find((campaign) => campaign.idempotencyKey === body.idempotencyKey);
      if (existing) return json({ campaign: existing, counts: existing.counts });
      const campaign = { ...body, id: crypto.randomUUID(), ownerUserId: "preview-user", senderAddress: "member@student.example", state: "validated", createdAt: now, updatedAt: now, counts: { ...counts, pending: body.rows.length } };
      campaigns.push(campaign); return json({ campaign, counts: campaign.counts }, 201);
    }
    return json({ error: { message: "This action is not available in the synthetic preview." } }, 404);
  };
})();
