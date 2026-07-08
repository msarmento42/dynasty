import { useState } from 'react';

export default function TradePartnerFinder() {
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const dummyPlayers = [
    { id: '1', name: 'Player One' },
    { id: '2', name: 'Player Two' },
    { id: '3', name: 'Player Three' },
  ];
  const dummyPartners = ['Team Alpha', 'Team Beta', 'Team Gamma'];

  return (
    <section style={{ background: '#ffffff', border: '1px solid #d9dee7', borderRadius: 8, padding: 16, marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Trade Partner Finder</h2>
      <select
        value={selectedPlayer}
        onChange={(e) => setSelectedPlayer(e.target.value)}
        style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}
      >
        <option value="">Select a player</option>
        {dummyPlayers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {selectedPlayer && (
        <div>
          <strong>Suggested Trade Partners:</strong>
          <ul>
            {dummyPartners.map((partner) => (
              <li key={partner}>{partner}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
