import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import Roster from './pages/Roster.jsx';
import TradeBuilder from './pages/TradeBuilder.jsx';
import Proposals from './pages/Proposals.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Roster</Link>
        <Link to="/trade">Trade Builder</Link>
        <Link to="/proposals">Proposals</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Roster />} />
        <Route path="/trade" element={<TradeBuilder />} />
        <Route path="/proposals" element={<Proposals />} />
      </Routes>
    </BrowserRouter>
  );
}
