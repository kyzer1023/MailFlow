import { Link } from "react-router-dom";

export interface BrandProps {
  readonly compact?: boolean;
}

export function Brand({ compact = false }: BrandProps) {
  return <Link className={`brand ${compact ? "brand--compact" : ""}`} to="/" aria-label="MailFlow home"><img src="/assets/mailflow-logo-horizontal.png" alt="MailFlow" /></Link>;
}
