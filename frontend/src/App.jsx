import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import Roster from './pages/Roster.jsx';
import TradeBuilder from './pages/TradeBuilder.jsx';
import Proposals from './pages/Proposals.jsx';
import Intelligence from './pages/Intelligence.jsx';
import PowerRankings from './pages/PowerRankings.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Roster</Link>
        <Link to="/trade">Trade Builder</Link>
        <Link to="/proposals">Proposals</Link>
        <Link to="/intelligence">Intelligence</Link>
        <Link to="/power-rankings">Power Rankings</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Roster />} />
        <Route path="/trade" element={<TradeBuilder />} />
        <Route path="/proposals" element={<Proposals />} />
        <Route path="/intelligence" element={<Intelligence />} />
        <Route path="/power-rankings" element={<PowerRankings />} />
      </Routes>
    </BrowserRouter>
  );
}
