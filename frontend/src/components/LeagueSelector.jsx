import { useEffect, useRef, useState } from 'react';

const BADGE_STYLES = {
  SF: {
    background: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #93c5fd',
  },
  '1QB': {
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
  },
  TEP: {
    background: '#ede9fe',
    color: '#6d28d9',
    border: '1px solid #c4b5fd',
  },
  PPR: {
    background: '#d1fae5',
    color: '#065f46',
    border: '1px solid #6ee7b7',
  },
  '0.5PPR': {
    background: '#fef3c7',
    color: '#92400e',
    border: '1px solid #fcd34d',
  },
  '0PPR': {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fca5a5',
  },
};

function FormatBadge({ label }) {
  const style = BADGE_STYLES[label] || BADGE_STYLES['1QB'];
  return (
    <span
      style={{
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.02em',
        padding: '2px 6px',
        ...style,
      }}
    >
      {label}
    </span>
  );
}

export default function LeagueSelector({ onSelect }) {
  const [leagues, setLeagues] = useState([]);
  const [settings, setSettings] = useState({});
  // 1. Change useState call to read from localStorage
  const [selectedId, setSelectedId] = useState(() => {
    try {
      return localStorage.getItem('selectedLeagueId') || null;
    } catch {
      return null;
    }
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // 2. Add useEffect to persist selectedId to localStorage
  useEffect(() => {
    if (selectedId) {
      localStorage.setItem('selectedLeagueId', selectedId);
    } else {
      localStorage.removeItem('selectedLeagueId');
    }
  }, [selectedId]);

  // Load leagues + settings on mount, and handle initial selection
  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        // Load basic league list
        const leaguesRes = await fetch('/fantasy/leagues');
        if (!leaguesRes.ok) throw new Error('Unable to load leagues');
        const leagueData = await leaguesRes.json();

        if (!isMounted) return;
        setLeagues(leagueData);

        // Determine the ID to select based on localStorage and fetched leagues
        let idToSelect = null;
        const isValidStoredId = selectedId && leagueData.some(l => l.league_id === selectedId);

        if (isValidStoredId) {
          // If the stored ID is valid, use it
          idToSelect = selectedId;
        } else if (leagueData.length > 0) {
          // Otherwise, if there are leagues, default to the first one
          idToSelect = leagueData[0].league_id;
        }
        // If idToSelect is null (no leagues), it remains null

        // Update selectedId state only if it's different from the determined ID
        // This prevents unnecessary re-renders if selectedId is already correct (e.g., from localStorage)
        if (idToSelect !== selectedId) {
          setSelectedId(idToSelect);
        }
        // Always notify parent component with the determined ID
        onSelect(idToSelect);

        // Load settings (non-blocking — enriches badges after load)
        try {
          const settingsRes = await fetch('/fantasy/leagues/settings');
          if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            if (isMounted) {
              const map = {};
              for (const s of settingsData) {
                map[s.league_id] = s;
              }
              setSettings(map);
            }
          }
        } catch (_) {
          // Settings fetch failed — badges just won't show, not a fatal error
        }
      } catch (err) {
        if (isMounted) setError(err.message);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [onSelect, selectedId]); // selectedId is a dependency because it's used in the load function

  function select(leagueId) {
    setSelectedId(leagueId);
    onSelect(leagueId);
    setOpen(false);
  }

  const selectedLeague = leagues.find((l) => l.league_id === selectedId);
  const selectedSettings = settings[selectedId];

  return (
    <div ref={dropdownRef} style={{ maxWidth: 400, position: 'relative' }}>
      <label htmlFor="league-select-btn" style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>
        League
      </label>

      {/* Trigger button */}
      <button
        id="league-select-btn"
        onClick={() => setOpen((v) => !v)}
        style={{
          alignItems: 'center',
          background: '#ffffff',
          border: '1px solid #ccd2dc',
          borderRadius: 6,
          cursor: 'pointer',
          display: 'flex',
          gap: 8,
          justifyContent: 'space-between',
          padding: '8px 12px',
          textAlign: 'left',
          width: '100%',
        }}
      >
        <span style={{ alignItems: 'center', display: 'flex', gap: 8, minWidth: 0 }}>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedLeague ? selectedLeague.name : 'Select league…'}
          </span>
          {selectedSettings && (
            <span style={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: 4 }}>
              <FormatBadge label={selectedSettings.format_label} />
              {selectedSettings.is_te_premium && <FormatBadge label="TEP" />}
              {selectedSettings.rec_format && selectedSettings.rec_format !== 'PPR' && (
                <FormatBadge label={selectedSettings.rec_format} />
              )}
            </span>
          )}
        </span>
        <span style={{ color: '#6b7280', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            left: 0,
            marginTop: 4,
            overflow: 'hidden',
            position: 'absolute',
            right: 0,
            top: '100%',
            zIndex: 100,
          }}
        >
          {leagues.map((league) => {
            const s = settings[league.league_id];
            const isSelected = league.league_id === selectedId;
            return (
              <button
                key={league.league_id}
                onClick={() => select(league.league_id)}
                style={{
                  alignItems: 'center',
                  background: isSelected ? '#f0f4ff' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid #f3f4f6',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 10,
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span style={{ fontWeight: isSelected ? 700 : 400 }}>{league.name}</span>
                {s ? (
                  <span style={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: 4 }}>
                    <FormatBadge label={s.format_label} />
                    {s.is_te_premium && <FormatBadge label="TEP" />}
                    {s.rec_format && s.rec_format !== 'PPR' && (
                      <FormatBadge label={s.rec_format} />
                    )}
                  </span>
                ) : (
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>loading…</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && <span style={{ color: '#b42318', display: 'block', marginTop: 6 }}>{error}</span>}
    </div>
  );
}
