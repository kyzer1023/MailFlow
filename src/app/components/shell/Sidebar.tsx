import { FlowArrow, House, PaperPlaneTilt, SignOut, SpinnerGap, type Icon } from "@phosphor-icons/react";
import { NavLink } from "react-router-dom";
import { useSignOut } from "../../hooks/use-sign-out";
import { useApi } from "../../state/api-context";
import { Brand } from "./Brand";

const navItems: readonly { to: string; label: string; icon: Icon }[] = [
  { to: "/dashboard", label: "Overview", icon: House },
  { to: "/flows", label: "Flows", icon: FlowArrow },
  { to: "/campaigns", label: "Campaigns", icon: PaperPlaneTilt },
];

export function Sidebar() {
  const { user } = useApi();
  const { signOut, signingOut, signOutError } = useSignOut();
  const initials = user?.displayName?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "US";
  return <aside className="sidebar"><div className="sidebar-brand"><Brand /></div><p className="society-name">For student societies</p><nav aria-label="Product navigation">{navItems.map(({ to, label, icon: NavIcon }) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? "active" : ""}><NavIcon weight="bold" /><span>{label}</span></NavLink>)}</nav><div className="sidebar-bottom">{signOutError && <p className="sidebar-error" role="alert">{signOutError}</p>}<div className="member-card"><span className="avatar">{initials}</span><span><strong>{user?.displayName || "USM member"}</strong><small>{user?.mailboxAddress || user?.principalName || "Signed in with Microsoft"}</small></span><button type="button" title="Sign out" aria-label="Sign out" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? <SpinnerGap className="spin" /> : <SignOut />}</button></div></div></aside>;
}
