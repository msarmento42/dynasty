from datetime import datetime

def calculate_mlb_eta(age: int, level: str) -> int:
    """
    Estimates a prospect's MLB arrival year based on age and current minor league level.
    """
    # Using 2025 as the base year, consistent with the frontend's "2025 season" comment.
    current_year = 2025

    # Base years to add based on level
    # These are rough estimates and can be refined
    level_eta_offset = {
        'Rookie': 4,
        'A': 3,
        'A+': 2,
        'AA': 1,
        'AAA': 0,
        'MLB': 0, # Already in MLB
    }

    # Default to 5 years if level is unknown or not in the map
    base_eta = current_year + level_eta_offset.get(level, 5)

    # Adjust based on age
    # Younger prospects at higher levels might arrive sooner
    # Older prospects at lower levels might take longer or have lower probability
    age_adjustment = 0
    if age < 20: # Very young
        age_adjustment = 1
    elif age >= 20 and age < 22: # Typical development age
        age_adjustment = 0
    elif age >= 22 and age < 24: # Slightly older
        age_adjustment = -1
    else: # Older prospect (24+)
        age_adjustment = -2

    # Combine base ETA with age adjustment
    # Ensure ETA is not in the past (before current_year)
    estimated_eta = base_eta + age_adjustment
    return max(current_year, estimated_eta)

if __name__ == '__main__':
    # Example usage for testing
    print(f"Prospect (Age 19, Rookie): ETA {calculate_mlb_eta(19, 'Rookie')}")
    print(f"Prospect (Age 21, AA): ETA {calculate_mlb_eta(21, 'AA')}")
    print(f"Prospect (Age 23, AAA): ETA {calculate_mlb_eta(23, 'AAA')}")
    print(f"Prospect (Age 25, A+): ETA {calculate_mlb_eta(25, 'A+')}")
    print(f"Prospect (Age 20, Unknown): ETA {calculate_mlb_eta(20, 'Unknown')}")
