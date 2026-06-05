import { useEffect, useState } from 'react';

export default function LeagueSelector({ onSelect }) {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadLeagues() {
      try {
        const response = await fetch('/fantasy/leagues');
        if (!response.ok) {
          throw new Error('Unable to load leagues');
        }
        const data = await response.json();
        if (isMounted) {
          setLeagues(data);
          if (data.length > 0) {
            setSelectedLeague(data[0].league_id);
            onSelect(data[0].league_id);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message);
        }
      }
    }

    loadLeagues();
    return () => {
      isMounted = false;
    };
  }, [onSelect]);

  function handleChange(event) {
    const leagueId = event.target.value;
    setSelectedLeague(leagueId);
    onSelect(leagueId);
  }

  return (
    <div style={{ display: 'grid', gap: 6, maxWidth: 360 }}>
      <label htmlFor="league-select" style={{ fontWeight: 700 }}>
        League
      </label>
      <select
        id="league-select"
        value={selectedLeague}
        onChange={handleChange}
        style={{ border: '1px solid #ccd2dc', borderRadius: 6, padding: '8px 10px' }}
      >
        {leagues.map((league) => (
          <option key={league.league_id} value={league.league_id}>
            {league.name}
          </option>
        ))}
      </select>
      {error && <span style={{ color: '#b42318' }}>{error}</span>}
    </div>
  );
}
