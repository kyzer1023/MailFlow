export function connect(): never {
  throw new Error("Tests must inject an SMTP socket connector");
}
