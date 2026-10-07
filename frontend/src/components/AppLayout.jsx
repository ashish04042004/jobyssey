import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import Icon from './Icon.jsx';
import Logo from './Logo.jsx';
import { MODULES } from '../modules.js';

function NavItems({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-1">
      {MODULES.map((module) => (
        <NavLink
          key={module.path}
          to={module.path}
          end={module.path === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`
          }
        >
          <Icon name={module.icon} />
          {module.label}
        </NavLink>
      ))}
    </nav>
  );
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function UserMenu({ onNavigate }) {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2">
      <Link
        to="/profile"
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg hover:opacity-80"
        title="Edit profile"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
          {initials(user.name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">{user.name}</span>
          <span className="block truncate text-xs text-slate-500">{user.college}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={async () => {
          setLoggingOut(true);
          await logout().catch(() => {});
        }}
        disabled={loggingOut}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        title="Log out"
        aria-label="Log out"
      >
        <Icon name="logout" />
      </button>
    </div>
  );
}

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 lg:flex">
        <div className="mb-8 px-2">
          <Logo />
        </div>
        <NavItems />
        <div className="mt-auto border-t border-slate-200 pt-4">
          <UserMenu />
        </div>
      </aside>

      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
        >
          <Icon name="menu" />
        </button>
      </header>
      {menuOpen && (
        <div className="space-y-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <NavItems onNavigate={closeMenu} />
          <div className="border-t border-slate-200 pt-3">
            <UserMenu onNavigate={closeMenu} />
          </div>
        </div>
      )}

      <main className="flex-1 px-4 py-6 sm:px-8 lg:py-10">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
