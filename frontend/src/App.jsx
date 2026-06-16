import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Roster from './pages/Roster.jsx';
import TradeBuilder from './pages/TradeBuilder.jsx';
import Proposals from './pages/Proposals.jsx';
import Intelligence from './pages/Intelligence.jsx';
import PowerRankings from './pages/PowerRankings.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Rookies from './pages/Rookies.jsx';
import SyncStatus from './components/SyncStatus.jsx';
import TradeHistory from './pages/TradeHistory.jsx';
import './App.css';

const NAV_ITEMS = [
  { to: '/', label: 'Roster' },
  { to: '/trade', label: 'Trade Finder' },
  { to: '/proposals', label: 'Decisions' },
  { to: '/power-rankings', label: 'Power Rankings' },
  { to: '/portfolio', label: 'Roster Strength' },
  { to: '/rookies', label: 'Rookies' },
  { to: '/trade-history', label: 'Trade History' },
  { to: '/intelligence', label: 'Research' },
];

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

function AppShell() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const shouldUseDark = savedTheme
      ? savedTheme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;

    setIsDark(shouldUseDark);
    applyTheme(shouldUseDark);
  }, []);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    localStorage.setItem('theme', nextTheme ? 'dark' : 'light');
    applyTheme(nextTheme);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <p className="eyebrow">Local Dynasty Lab</p>
          <h1>Dynasty Calculator</h1>
        </div>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-pressed={isDark}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? 'Light mode' : 'Dark mode'}
        </button>
      </header>

      <div className="app-layout">
        <aside className="app-sidebar" aria-label="Dynasty navigation">
          <nav className="app-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <SyncStatus />
        </aside>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<Roster />} />
            <Route path="/trade" element={<TradeBuilder />} />
            <Route path="/proposals" element={<Proposals />} />
            <Route path="/intelligence" element={<Intelligence />} />
            <Route path="/power-rankings" element={<PowerRankings />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/rookies" element={<Rookies />} />
            <Route path="/trade-history" element={<TradeHistory />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
