/** Local timestamp `YYYY-MM-DD HH:mm:ss`. */
function stamp(): string {
  return new Date().toLocaleString("sv-SE", { hour12: false });
}

/** One-line preview for console; never dump tokens or full agent JSON. */
export function preview(text: string, max = 80): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) {
    return "";
  }
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}

export function info(msg: string): void {
  console.log(`${stamp()}  ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`${stamp()}  WARN  ${msg}`);
}

export function error(msg: string, err?: unknown): void {
  const extra =
    err instanceof Error ? err.message : err != null ? String(err) : "";
  console.error(`${stamp()}  ERR   ${msg}${extra ? ` ${extra}` : ""}`);
}
