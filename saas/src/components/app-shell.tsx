"use client";
import { Notice } from "./notice";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import {
  LayoutDashboard,
  UsersRound,
  Files,
  ScanLine,
  ListTodo,
  CalendarDays,
  Settings2,
  PanelLeftClose,
  Menu,
  ChevronDown,
  ArrowUpRight,
  FlaskConical,
  X,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useTheme } from "next-themes";
import { fr, sections } from "@/lib/i18n/dictionaries";
import { useDemo } from "./providers";

const icons = [
  LayoutDashboard,
  UsersRound,
  Files,
  ScanLine,
  ListTodo,
  CalendarDays,
  Settings2,
];
function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data } = useDemo();
  return (
    <nav aria-label="Navigation principale">
      {sections.map((section, index) => {
        const Icon = icons[index];
        const active = pathname === `/fr/${section}`;
        return (
          <Link
            key={section}
            href={`/fr/${section}`}
            onClick={onNavigate}
            className={`nav-item ${active ? "active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={19} strokeWidth={1.7} />
            <span>{fr.navigation[section]}</span>
            {section === "demandes" && (
              <span className="nav-count">
                {
                  data.requests.filter((r) =>
                    ["nouvelle", "a_qualifier"].includes(r.status),
                  ).length
                }
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
function Brand() {
  return (
    <Link
      className="brand"
      href="/fr/tableau-de-bord"
    >
      <span className="brand-symbol" aria-hidden="true">
        <svg width="19" height="24" viewBox="0 0 19 24" fill="none" aria-hidden="true">
          <path d="M14 2v17M14 12c-1-7-12-6-12 1 0 8 12 9 12 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg><span />
      </span>
      <span>
        daxenvo<span className="brand-ai"> AI</span><span className="sr-only">, tableau de bord</span>
      </span>
    </Link>
  );
}
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <Brand />
      <div className="workspace-choice">
        <span className="workspace-icon">D</span>
        <span>
          <strong>Atelier Démo</strong>
          <small>Espace fictif · sans compte</small>
        </span>
        <ChevronDown size={15} />
      </div>
      <span className="nav-caption">VOTRE ESPACE</span>
      <Navigation onNavigate={onNavigate} />
      <div className="sidebar-bottom">
        <div className="foundation-note">
          <span className="note-icon">
            <FlaskConical size={17} />
          </span>
          <strong>Le début de votre croissance.</strong>
          <p>Explorez Daxenvo avec des exemples fictifs.</p>
          <Link onClick={onNavigate} href="/fr/parametres">
            Voir les fonctionnalités <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" />
          Fondations J7<span>v0.1</span>
        </div>
      </div>
    </>
  );
}
export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="theme-control" role="group" aria-label="Choisir le thème">
      {(
        [
          ["light", "Clair", Sun],
          ["dark", "Sombre", Moon],
          ["system", "Système", Monitor],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={`Thème ${label.toLowerCase()}`}
          aria-pressed={ready && theme === value}
          disabled={!ready}
          onClick={() => setTheme(value)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current =
    sections.find((s) => pathname.endsWith(`/${s}`)) ?? "tableau-de-bord";
  const drawer = useRef<HTMLDialogElement>(null);
  const { persistence, notice } = useDemo();
  return (
    <div className="app-layout">
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <aside className="sidebar">
        <SidebarContent />
      </aside>
      <dialog
        className="mobile-drawer"
        ref={drawer}
        aria-label="Menu de navigation"
        onClick={(event) => {
          if (event.target === drawer.current) drawer.current?.close();
        }}
      >
        <button
          className="icon-button drawer-close"
          aria-label="Fermer le menu"
          onClick={() => drawer.current?.close()}
        >
          <X size={20} />
        </button>
        <SidebarContent onNavigate={() => drawer.current?.close()} />
      </dialog>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Ouvrir le menu"
              disabled={persistence === "loading"}
              onClick={() => drawer.current?.showModal()}
            >
              <Menu size={21} />
            </button>
            <PanelLeftClose size={18} className="desktop-only muted" />
            <span className="desktop-only">Espace de travail</span>
            <span className="breadcrumb-slash desktop-only">/</span>
            <strong>{fr.navigation[current]}</strong>
          </div>
          <div className="topbar-right">
            <ThemeControl />
            <span className="demo-pill">
              <FlaskConical size={13} />
              Démonstration
            </span>
          </div>
        </header>
        <main
          id="contenu"
          className="main-content"
          data-demo-ready={persistence !== "loading"}
        >
          <div className="demo-notice">
            <span>
              <span className="status-dot" />
              Données fictives · Aucun compte connecté
            </span>
            <span className="storage-label">
              {persistence === "local"
                ? "Enregistré dans ce navigateur"
                : persistence === "loading"
                  ? "Chargement local…"
                  : "Mémoire temporaire"}
            </span>
          </div>
          {notice && (
            <Notice>
              {notice}
            </Notice>
          )}
          {children}
          <footer className="page-footer">
            <span>Conçu pour faire avancer vos projets.</span>
            <span>
              Daxenvo AI <span className="footer-separator">/</span> Fondations
              SaaS · J7
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
