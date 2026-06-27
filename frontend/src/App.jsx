import { useState, useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import Roster from './pages/Roster.jsx';
import TradeBuilder from './pages/TradeBuilder.jsx';
import Proposals from './pages/Proposals.jsx';
import Playoffs from './pages/Playoffs.jsx';
import PlayerProfile from './pages/PlayerProfile.jsx';
import PickCalculator from './pages/PickCalculator.jsx';
import TeamNeeds from './pages/TeamNeeds.jsx';

export default function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Roster</Link>
        <Link to="/trade">Trade Builder</Link>
        <Link to="/proposals">Proposals</Link>
        <Link to="/playoffs">Playoffs</Link>
        <Link to="/picks">Pick Calculator</Link>
        <Link to="/team-needs">Team Needs</Link>
        <button
          className="dark-mode-toggle"
          onClick={() => setDarkMode((prev) => !prev)}
          aria-label="Toggle dark mode"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
      </nav>
      <Routes>
        <Route path="/" element={<Roster />} />
        <Route path="/trade" element={<TradeBuilder />} />
        <Route path="/proposals" element={<Proposals />} />
        <Route path="/playoffs" element={<Playoffs />} />
        <Route path="/players/:playerId" element={<PlayerProfile />} />
        <Route path="/picks" element={<PickCalculator />} />
        <Route path="/team-needs" element={<TeamNeeds />} />
      </Routes>
    </BrowserRouter>
  );
}
