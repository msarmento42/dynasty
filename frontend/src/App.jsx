import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Roster from './pages/Roster.jsx';
import TradeBuilder from './pages/TradeBuilder.jsx';
import Proposals from './pages/Proposals.jsx';
import Intelligence from './pages/Intelligence.jsx';
import PowerRankings from './pages/PowerRankings.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Rookies from './pages/Rookies.jsx';
import './App.css';

export default function App() {
    const [isDark, setIsDark] = useState(false);

  useEffect(() => {
        // Load theme preference from localStorage
                const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
                setIsDark(savedTheme === 'dark');
                applyTheme(savedTheme === 'dark');
        } else {
                // Check system preference
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                setIsDark(prefersDark);
                applyTheme(prefersDark);
        }
  }, []);

  const applyTheme = (dark) => {
        const root = document.documentElement;
        if (dark) {
                root.setAttribute('data-theme', 'dark');
        } else {
                root.setAttribute('data-theme', 'light');
        }
  };

  const toggleTheme = () => {
        const newIsDark = !isDark;
        setIsDark(newIsDark);
        localStorage.setItem('theme', newIsDark ? 'dark' : 'light');
        applyTheme(newIsDark);
  };

  return (
        <BrowserRouter>
              <nav style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-surface)',
                  borderBottom: '1px solid var(--border-color)',
        }}>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                <Link to="/">Roster</Link>Link>
                                <Link to="/trade">Trade Builder</Link>Link>
                                <Link to="/proposals">Proposals</Link>Link>
                                <Link to="/intelligence">Intelligence</Link>Link>
                                <Link to="/power-rankings">Power Rankings</Link>Link>
                                <Link to="/portfolio">Portfolio</Link>Link>
                                <Link to="/rookies">Rookies</Link>Link>
                      </div>div>
                      <button 
                                  onClick={toggleTheme}
                                  style={{
                                                padding: '0.5rem 1rem',
                                                backgroundColor: 'var(--accent-color)',
                                                color: 'var(--text-color)',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                                fontWeight: '500'
                                  }}
                                  aria-label="Toggle dark mode"
                                >
                        {isDark ? '☀️ Light' : '🌙 Dark'}
                      </button>button>
              </nav>nav>
              <Routes>
                      <Route path="/" element={<Roster />} />
                      <Route path="/trade" element={<TradeBuilder />} />
                      <Route path="/proposals" element={<Proposals />} />
                      <Route path="/intelligence" element={<Intelligence />} />
                      <Route path="/power-rankings" element={<PowerRankings />} />
                      <Route path="/portfolio" element={<Portfolio />} />
                      <Route path="/rookies" element={<Rookies />} />
              </Routes>Routes>
        </BrowserRouter>BrowserRouter>
      );
}</BrowserRouter>
